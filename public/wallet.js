const $ = id => document.getElementById(id);
let provider = null, address = null, config = null, revision = 0, busy = false;
const status = text => { $('wallet-status').textContent = text; };
async function api(path, body) {
  const response = await fetch(path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) clearWallet();
    const error = new Error(data.error || 'Request failed. Please retry.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function clearWallet() {
  revision++; address = null;
  $('holder-tools').hidden = true; $('verified-chog').hidden = true;
  $('chog-art').replaceChildren(); $('owned-chogs').replaceChildren(); $('token-id').value = '';
  $('connect-wallet').textContent = 'Connect wallet'; $('connect-wallet').disabled = false;
  status('Wallet disconnected. The sample lab below is open to everyone.');
  window.dispatchEvent(new CustomEvent('chogchemy:wallet', { detail: { address: null } }));
}
async function disconnect() {
  clearWallet();
  try { await api('/api/logout', {}); } catch { status('Local connection cleared. Refresh before reconnecting if the server is unavailable.'); }
}
function attachProvider(next) {
  if (provider === next) return;
  if (provider?.removeListener) for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.removeListener(event, onWalletChange);
  provider = next;
  if (provider?.on) for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on(event, onWalletChange);
}
function onWalletChange() {
  // Changes during connection are handled by the checks immediately before/after signing.
  if (busy && !address) { revision++; return; }
  void disconnect();
}
async function contextMatches(expectedAddress) {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });
  return accounts[0]?.toLowerCase() === expectedAddress && BigInt(chainId) === 143n;
}
async function connect() {
  if (busy) return;
  if (address) { document.getElementById('holder').scrollIntoView({ behavior: 'smooth' }); return; }
  busy = true; $('connect-wallet').disabled = true;
  let authenticated = false;
  try {
    if (!window.ethereum?.request) throw new Error('Open this page in a browser with an Ethereum-compatible wallet extension, such as MetaMask or Rabby.');
    attachProvider(window.ethereum);
    config ||= await api('/api/config');
    if (location.origin !== config.origin) throw new Error(`Open ${config.origin} to connect your wallet.`);
    status('Choose your wallet account.');
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts[0]) throw new Error('No wallet account selected.');
    const expectedAddress = accounts[0].toLowerCase();
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (BigInt(chainId) !== 143n) {
      status('Switch your wallet to Monad mainnet.');
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] }); }
      catch (error) {
        if (error.code !== 4902 && error.data?.originalError?.code !== 4902) throw error;
        await provider.request({ method: 'wallet_addEthereumChain', params: [config.chain] });
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] });
      }
    }
    if (!await contextMatches(expectedAddress)) throw new Error('Wallet account or network changed. Connect again.');
    const attempt = revision;
    const challenge = await api('/api/auth/challenge', { address: expectedAddress });
    if (attempt !== revision) throw new Error('Wallet changed. Connect again.');
    status('Sign the login message in your wallet. This does not approve a fusion or move NFTs.');
    const hex = '0x' + Array.from(new TextEncoder().encode(challenge.message), b => b.toString(16).padStart(2, '0')).join('');
    const signature = await provider.request({ method: 'personal_sign', params: [hex, expectedAddress] });
    if (attempt !== revision || !await contextMatches(expectedAddress)) throw new Error('Wallet changed while signing. Connect again.');
    const session = await api('/api/auth/verify', { id: challenge.id, signature }); authenticated = true;
    if (attempt !== revision || !await contextMatches(expectedAddress)) throw new Error('Wallet changed while signing. Connect again.');
    address = session.address; $('holder-tools').hidden = false;
    $('connect-wallet').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
    window.dispatchEvent(new CustomEvent('chogchemy:wallet', { detail: { address } }));
    status('Wallet verified on Monad. Checking your Chog collection…');
    await refreshChogs();
  } catch (error) {
    if (!address) {
      clearWallet();
      if (authenticated) try { await api('/api/logout', {}); } catch { /* Server session will expire. */ }
    }
    status(error.code === 4001 ? 'You cancelled the wallet request. Connect again when ready.' : error.message);
  } finally { busy = false; $('connect-wallet').disabled = false; }
}
async function refreshChogs() {
  if (!address) return;
  const attempt = ++revision;
  $('refresh-chogs').disabled = true; $('verified-chog').hidden = true;
  $('owned-chogs').replaceChildren(); $('balance-status').textContent = 'Reading Chog Genesis on Monad…';
  try {
    if (!await contextMatches(address)) { await disconnect(); return; }
    const result = await api('/api/chogs');
    if (attempt !== revision) return;
    $('balance-status').textContent = result.balance === '0' ? 'No Chog Genesis NFTs found in this wallet. You can still try the sample lab.' : `You own ${result.balance} Chog Genesis NFT${result.balance === '1' ? '' : 's'}. ${result.tokenIds === null ? 'Enter a token ID below to preview one.' : 'Choose a token to check its current ownership.'}`;
    for (const tokenId of result.tokenIds || []) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Chog #${tokenId}`;
      button.addEventListener('click', () => { $('token-id').value = tokenId; void lookup(); }); $('owned-chogs').append(button);
    }
    if (result.tokenIds?.length === result.limit && BigInt(result.balance) > BigInt(result.limit)) $('balance-status').textContent += ` Showing the first ${result.limit}; look up others by ID.`;
    status('Wallet verified. Ownership is checked again whenever you look up a Chog.');
  } catch (error) { if (attempt === revision) { $('balance-status').textContent = ''; status(error.message); } }
  finally { $('refresh-chogs').disabled = false; }
}
function safeMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  if (value.startsWith('ipfs://')) value = 'https://ipfs.io/ipfs/' + value.slice(7).replace(/^ipfs\//, '');
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
async function readMetadata(uri) {
  if (typeof uri !== 'string') throw new Error('Metadata unavailable.');
  if (uri.startsWith('data:application/json;base64,') && uri.length < 1000000) return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.split(',')[1]), c => c.charCodeAt(0))));
  if (uri.startsWith('data:application/json,')) { if (uri.length > 1000000) throw new Error('Metadata too large.'); return JSON.parse(decodeURIComponent(uri.split(',').slice(1).join(','))); }
  const url = safeMediaUrl(uri);
  if (!url) throw new Error('Metadata URL is unsupported.');
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw new Error('Metadata unavailable.');
  const reader = response.body.getReader(); let length = 0, chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1000000) { await reader.cancel(); throw new Error('Metadata too large.'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function lookup() {
  if (!address) { status('Connect your wallet first.'); return; }
  const tokenId = $('token-id').value.trim();
  if (!/^(0|[1-9][0-9]{0,77})$/.test(tokenId)) { status('Enter a numeric token ID from your NFT’s OpenSea URL.'); return; }
  const attempt = ++revision;
  $('verified-chog').hidden = true; status(`Checking ownership of token #${tokenId}…`);
  try {
    if (!await contextMatches(address)) { await disconnect(); return; }
    const token = await api(`/api/chog?id=${encodeURIComponent(tokenId)}`);
    if (attempt !== revision) return;
    $('chog-name').textContent = `Chog Genesis · Token #${token.tokenId}`;
    $('chog-proof').textContent = `Owned by ${token.owner.slice(0, 6)}…${token.owner.slice(-4)} · Checked ${new Date(token.checkedAt).toLocaleTimeString()}`;
    $('chog-link').href = `https://opensea.io/item/monad/${token.collection.address}/${token.tokenId}`;
    $('chog-traits').textContent = 'Loading artwork and traits…'; $('chog-art').textContent = '✳'; $('verified-chog').hidden = false;
    status('Ownership confirmed. You can use this token as Parent A in an invitation.');
    window.dispatchEvent(new CustomEvent('chogchemy:token', { detail: { tokenId: token.tokenId } }));
    try {
      const metadata = await readMetadata(token.tokenURI);
      if (attempt !== revision) return;
      if (typeof metadata?.name === 'string') $('chog-name').textContent = metadata.name.slice(0, 200);
      const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
      $('chog-traits').textContent = attributes.filter(x => x && typeof x.trait_type === 'string' && ['string', 'number'].includes(typeof x.value)).slice(0, 20).map(x => `${x.trait_type}: ${x.value}`).join(' · ').slice(0, 2000) || 'No traits provided.';
      const imageUrl = safeMediaUrl(metadata?.image);
      if (imageUrl) { const image = document.createElement('img'); image.alt = $('chog-name').textContent; image.referrerPolicy = 'no-referrer'; image.src = imageUrl; image.addEventListener('error', () => { if (attempt === revision) $('chog-art').textContent = 'Artwork unavailable · View on OpenSea'; }); $('chog-art').replaceChildren(image); }
      else $('chog-art').textContent = 'Artwork unavailable · View on OpenSea';
    } catch { if (attempt === revision) { $('chog-traits').textContent = 'Ownership confirmed. This metadata host could not be loaded in your browser; view artwork on OpenSea.'; $('chog-art').textContent = 'Artwork unavailable'; } }
  } catch (error) { if (attempt === revision) status(error.message); }
}
$('connect-wallet').addEventListener('click', connect);
$('disconnect-wallet').addEventListener('click', disconnect);
$('refresh-chogs').addEventListener('click', refreshChogs);
$('lookup-chog').addEventListener('submit', event => { event.preventDefault(); void lookup(); });
// Start disconnected on every page load; never restore identity from browser storage.
clearWallet();

export { api };
export function getWalletAddress() { return address; }
export async function signWalletMessage(message) {
  if (!address || !provider) throw new Error('Connect and verify your wallet first.');
  const expected = address, attempt = revision;
  if (!await contextMatches(expected)) { await disconnect(); throw new Error('Wallet changed. Reconnect before approving.'); }
  const hex = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('');
  const signature = await provider.request({ method: 'personal_sign', params: [hex, expected] });
  if (attempt !== revision || !await contextMatches(expected)) throw new Error('Wallet changed during approval. Reconnect and try again.');
  return signature;
}
