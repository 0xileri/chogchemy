import { digest, imageMime } from './art-direction.mjs';

export class ReferenceError extends Error {
  constructor(message) { super(message); this.publicMessage = message; }
}
const fail = message => { throw new ReferenceError(message); };
const allowedHosts = new Set(['ipfs.io', 'dweb.link', 'gateway.pinata.cloud', 'nftstorage.link']);
export function referenceUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) fail('A parent has an unsupported artwork URL.');
  if (value.startsWith('ipfs://')) value = 'https://ipfs.io/ipfs/' + value.slice(7).replace(/^ipfs\//, '');
  let url; try { url = new URL(value); } catch { fail('A parent has an invalid artwork URL.'); }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password || url.port) fail('A parent artwork host is not supported. Configure a trusted gateway before generating.');
  if (!/^\/ipfs\/[A-Za-z0-9]{32,120}(\/|$)/.test(url.pathname)) fail('Parent references must use an IPFS gateway path.');
  return url.href;
}
export async function limitedBytes(response, max) {
  if (!response.body || Number(response.headers.get('content-length') || 0) > max) fail('An artwork response is too large.');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); fail('An artwork response is too large.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
async function remoteAttempt(value, max, fetcher) {
  let url = referenceUrl(value);
  for (let hops = 0; hops < 4; hops++) {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: '*/*' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) fail('An artwork gateway returned an invalid redirect.');
      url = referenceUrl(new URL(location, url).href); continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new ReferenceError('A parent artwork gateway is unavailable. Retry before generation starts.');
      error.retryable = response.status === 429 || response.status >= 500; throw error;
    }
    return limitedBytes(response, max);
  }
  fail('An artwork gateway returned too many redirects.');
}
async function remote(value, max, fetcher) {
  const initial = referenceUrl(value), alternate = new URL(initial);
  alternate.hostname = alternate.hostname === 'gateway.pinata.cloud' ? 'ipfs.io' : 'gateway.pinata.cloud';
  for (const url of [initial, alternate.href]) {
    try { return await remoteAttempt(url, max, fetcher); }
    catch (error) { if (error instanceof ReferenceError && !error.retryable) throw error; }
  }
  fail('The trusted artwork gateways are busy. Try again before generation starts.');
}
function inlineJson(uri) {
  if (uri.length > 1400000) fail('Parent metadata is too large.');
  if (uri.startsWith('data:application/json;base64,')) return Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64');
  if (uri.startsWith('data:application/json,')) return Buffer.from(decodeURIComponent(uri.slice('data:application/json,'.length)));
  return null;
}
export async function loadParentReference(chain, tokenId, fetcher = fetch) {
  try {
    const token = await chain.token(tokenId);
    if (typeof token.tokenURI !== 'string') fail('A parent Chog has no image metadata.');
    const metadataBytes = inlineJson(token.tokenURI) || await remote(token.tokenURI, 1024 * 1024, fetcher);
    if (metadataBytes.length > 1024 * 1024) fail('Parent metadata is too large.');
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    if (!metadata || typeof metadata.image !== 'string') fail('A parent metadata record has no image.');
    let bytes;
    if (/^data:image\/(png|jpeg|webp);base64,/.test(metadata.image)) {
      if (metadata.image.length > 17 * 1024 * 1024) fail('A parent image is too large.');
      bytes = Buffer.from(metadata.image.split(',')[1], 'base64');
    } else bytes = await remote(metadata.image, 12 * 1024 * 1024, fetcher);
    if (bytes.length > 12 * 1024 * 1024) fail('A parent image is too large.');
    const mime = imageMime(bytes);
    const traits = (Array.isArray(metadata.attributes) ? metadata.attributes : []).filter(x => x && typeof x.trait_type === 'string' && ['string', 'number'].includes(typeof x.value)).slice(0, 20).map(x => ({ type: x.trait_type.slice(0, 100), value: String(x.value).slice(0, 100) }));
    return { tokenId, bytes, mime, digest: digest(bytes), name: typeof metadata.name === 'string' ? metadata.name.slice(0, 200) : `Chog #${tokenId}`, traits, tokenURI: token.tokenURI, imageURI: metadata.image.startsWith('data:') ? 'inline image' : metadata.image };
  } catch (error) {
    if (error instanceof ReferenceError) throw error;
    fail('Could not load a parent reference image. Check the metadata gateway and retry before generation starts.');
  }
}
