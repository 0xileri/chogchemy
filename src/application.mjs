import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAddress, verifyMessage } from 'viem';
import { collection, createChain } from './chain.mjs';
import { createFusionService, FusionError } from './fusions.mjs';
import { createMemoryFusionStore } from './fusion-store.mjs';
import { createChogPreviews } from './chog-previews.mjs';
import { renderCharacterPage, renderCharacterNotFound, renderMemePage, renderMemeNotFound } from './character-page.mjs';
import { memeCatalog } from './meme-catalog.mjs';

const staticFiles = {
  '/watch': ['watch.html', 'text/html'], '/demo-video.mp4': ['chogchemy-demo-v1.mp4', 'video/mp4'],
  '/demo': ['demo.html', 'text/html'], '/demo/': ['demo.html', 'text/html'],
  '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
  '/wallet.js': ['wallet.js', 'text/javascript'], '/fusion.js': ['fusion.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
  '/character.js': ['character.js', 'text/javascript'], '/share.js': ['share.js', 'text/javascript'],
  '/motion.js': ['motion.js', 'text/javascript'], '/motion.css': ['motion.css', 'text/css'],
  '/caption-suggestions.js': ['caption-suggestions.js', 'text/javascript'],
  '/memes.js': ['memes.js', 'text/javascript'], '/memes.css': ['memes.css', 'text/css'], '/families': ['families.html', 'text/html'], '/families/': ['families.html', 'text/html'],
  '/brand/chogchemy-logo-v1.png': ['../assets/brand/chogchemy-logo-v1.png', 'image/png'],
  '/brand/chogchemy-icon-v1.png': ['../assets/brand/chogchemy-icon-v1.png', 'image/png'],
  '/brand/chogchemy-banner-v1.png': ['../assets/brand/chogchemy-banner-v1.png', 'image/png'],
};
const tokenPattern = /^(0|[1-9][0-9]{0,77})$/;
export function validTokenId(value) { return typeof value === 'string' && tokenPattern.test(value) && BigInt(value) < 2n ** 256n; }

export function createApplication({ chain = createChain(), fusionStore = createMemoryFusionStore(), origin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`, now = Date.now, generationOptions = {}, previewOptions = {} } = {}) {
  const challenges = new Map(), sessions = new Map(), limits = new Map();
  const appOrigin = new URL(origin).origin;
  const fusions = createFusionService({ ...generationOptions, store: fusionStore, chain, origin: appOrigin, now });
  const previews = createChogPreviews({ ...previewOptions, chain, now });
  const secure = appOrigin.startsWith('https:') ? '; Secure' : '';
  const cookie = (value, age = 1800) => `chogchemy_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure}`;
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const cleanup = () => {
    for (const map of [challenges, sessions, limits]) for (const [key, entry] of map) if (entry.expires <= now()) map.delete(key);
  };
  const getSession = req => {
    const id = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('chogchemy_session='))?.slice(18);
    const session = sessions.get(id);
    return session?.expires > now() ? { ...session, id } : null;
  };
  async function body(req) {
    let bytes = 0, chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) throw new Error('Request too large.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error('Invalid JSON.'); }
  }
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, appOrigin);
      if (url.pathname === '/healthz' && req.method === 'GET') { send(res, 200, { ok: true }); return; }
      const memePage = url.pathname.match(/^\/memes\/([a-f0-9]{64})$/);
      if (memePage && ['GET', 'HEAD'].includes(req.method)) {
        let request = null;
        try { request = fusions.getMeme(memePage[1]); } catch (error) { if (!(error instanceof FusionError && error.status === 404)) throw error; }
        const ready = request?.state === 'generated' && request.artwork;
        const data = Buffer.from(ready ? renderMemePage(request, appOrigin) : renderMemeNotFound(appOrigin));
        res.writeHead(ready ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      const memeImage = url.pathname.match(/^\/meme-artwork\/([a-f0-9]{64})\.png$/);
      if (memeImage && ['GET', 'HEAD'].includes(req.method)) {
        const bytes = fusions.memeArtwork(memeImage[1]);
        if (!bytes) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      if (url.pathname.startsWith('/characters/') && ['GET', 'HEAD'].includes(req.method)) {
        const match = url.pathname.match(/^\/characters\/([a-f0-9]{64})$/);
        let request = null;
        if (match) {
          try { request = fusions.get(match[1]); }
          catch (error) { if (!(error instanceof FusionError && error.status === 404)) throw error; }
        }
        const found = request?.state === 'generated' && Boolean(request.artwork);
        const data = Buffer.from(found ? renderCharacterPage(request, appOrigin) : renderCharacterNotFound(appOrigin));
        res.writeHead(found ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      const artworkRoute = url.pathname.match(/^\/(artwork|comics)\/([a-f0-9]{64})\.png$/);
      const stickerRoute = url.pathname.match(/^\/stickers\/([a-f0-9]{64})\/(gm|crying|celebrating|hugs|sleepy|send-help|pack)\.(png|zip)$/);
      if (stickerRoute && ['GET', 'HEAD'].includes(req.method)) {
        const [, id, name, extension] = stickerRoute;
        if ((name === 'pack') !== (extension === 'zip')) { send(res, 404, { error: 'Sticker download not found.' }); return; }
        const bytes = fusions.stickerAsset(id, name === 'pack' ? 'zip' : name);
        if (!bytes) { send(res, 404, { error: 'Sticker download not found.' }); return; }
        res.writeHead(200, { 'Content-Type': extension === 'zip' ? 'application/zip' : 'image/png', 'Content-Length': bytes.length, ...(extension === 'zip' ? { 'Content-Disposition': 'attachment; filename="chogchemy-stickers.zip"' } : {}), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      const episodeRoute = url.pathname.match(/^\/episodes\/([a-f0-9]{64})\/([a-f0-9]{64})\.png$/);
      if (episodeRoute && ['GET', 'HEAD'].includes(req.method)) {
        const bytes = fusions.episodeArtwork(episodeRoute[1], episodeRoute[2]);
        if (!bytes) { send(res, 404, { error: 'Episode not found.' }); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      if (artworkRoute && ['GET', 'HEAD'].includes(req.method)) {
        const bytes = artworkRoute[1] === 'comics' ? fusions.comicArtwork(artworkRoute[2]) : fusions.artwork(artworkRoute[2]);
        if (!bytes) { send(res, 404, { error: 'Artwork not found.' }); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      if (!url.pathname.startsWith('/api/')) {
        const file = url.pathname === '/' && url.searchParams.has('fusion') ? staticFiles['/families'] : Object.hasOwn(staticFiles, url.pathname) ? staticFiles[url.pathname] : null;
        if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
        let data = await readFile(new URL(`../public/${file[0]}`, import.meta.url));
        if (file[1] === 'text/html') data = Buffer.from(data.toString('utf8').replaceAll('__APP_ORIGIN__', appOrigin.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')));
        if (file[1] === 'video/mp4') {
          const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
          if (req.method === 'GET' && req.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            let start = NaN, end = data.length - 1;
            if (match && (match[1] || match[2])) {
              start = match[1] ? Number(match[1]) : Math.max(0, data.length - Number(match[2]));
              if (match[1] && match[2]) end = Math.min(Number(match[2]), end);
            }
            if (!Number.isSafeInteger(start) || start < 0 || start >= data.length || end < start) {
              res.writeHead(416, { ...headers, 'Content-Range': `bytes */${data.length}`, 'Content-Length': 0 }); res.end(); return;
            }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
            res.end(data.subarray(start, end + 1)); return;
          }
          res.writeHead(200, { ...headers, 'Content-Length': data.length }); res.end(req.method === 'HEAD' ? undefined : data); return;
        }
        res.writeHead(200, { 'Content-Type': file[1].startsWith('text/') ? `${file[1]}; charset=utf-8` : file[1], 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      cleanup();
      if (req.headers.origin && req.headers.origin !== appOrigin) { send(res, 403, { error: 'Origin not allowed.' }); return; }
      if (req.method === 'POST' && req.headers.origin !== appOrigin) { send(res, 403, { error: 'Open the app at its configured address to continue.' }); return; }
      const key = req.socket.remoteAddress || 'unknown';
      const rate = limits.get(key) || { count: 0, expires: now() + 60000 };
      rate.count++; limits.set(key, rate);
      if (rate.count > 90 || challenges.size > 1000 || sessions.size > 1000) { send(res, 429, { error: 'Too many requests. Try again in a minute.' }); return; }
      const session = getSession(req);
      if (req.method === 'GET' && url.pathname === '/api/config') { send(res, 200, { collection, origin: appOrigin, chain: { chainId: '0x8f', chainName: 'Monad', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: ['https://rpc.monad.xyz'], blockExplorerUrls: ['https://monadvision.com'] } }); return; }
      if (req.method === 'GET' && url.pathname === '/api/session') { send(res, 200, { address: session?.address || null }); return; }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        if (session) sessions.delete(session.id);
        res.setHeader('Set-Cookie', cookie('', 0)); send(res, 200, { ok: true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/challenge') {
        const input = await body(req);
        if (!input || typeof input.address !== 'string' || !isAddress(input.address, { strict: false })) { send(res, 400, { error: 'Invalid wallet address.' }); return; }
        const id = randomBytes(32).toString('hex'), issued = now(), expires = issued + 300000;
        const address = input.address.toLowerCase();
        const message = `${new URL(appOrigin).host} wants you to sign in to Chogchemy.\n\nWallet: ${address}\nPurpose: Verify your wallet to look up your Chog Genesis NFTs.\nThis does not authorize a fusion or any transaction.\n\nURI: ${appOrigin}\nChain ID: 143\nNonce: ${id}\nIssued At: ${new Date(issued).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
        challenges.set(id, { address, message, expires }); send(res, 200, { id, message }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
        const input = await body(req), challenge = challenges.get(input?.id);
        challenges.delete(input?.id);
        if (!challenge || challenge.expires <= now()) { send(res, 401, { error: 'Sign-in expired or already used. Connect again.' }); return; }
        let valid = false;
        try { valid = await verifyMessage({ address: challenge.address, message: challenge.message, signature: input.signature }); } catch { /* Malformed or incorrect signatures fail closed. */ }
        if (!valid) { send(res, 401, { error: 'The wallet signature did not match.' }); return; }
        if (session) sessions.delete(session.id);
        const id = randomBytes(32).toString('hex'); sessions.set(id, { address: challenge.address, expires: now() + 1800000 });
        res.setHeader('Set-Cookie', cookie(id)); send(res, 200, { address: challenge.address }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/gallery') { send(res, 200, { artworks: fusions.gallery() }); return; }
      if (req.method === 'GET' && url.pathname === '/api/meme-templates') { send(res, 200, memeCatalog); return; }
      if (req.method === 'GET' && url.pathname === '/api/meme-gallery') { send(res, 200, { memes: fusions.memeGallery() }); return; }
      const memeRoute = url.pathname.match(/^\/api\/memes\/([a-f0-9]{64})(?:\/(generate|cancel))?$/);
      if (req.method === 'GET' && memeRoute && !memeRoute[2]) { send(res, 200, fusions.getMeme(memeRoute[1], session?.address)); return; }
      const fusionRoute = url.pathname.match(/^\/api\/fusions\/([a-f0-9]{64})(?:\/(message|approve|recheck|cancel|generate|comic|cancel-comic|episode|cancel-episode|stickers|cancel-stickers))?$/);
      if (req.method === 'GET' && fusionRoute && !fusionRoute[2]) { send(res, 200, fusions.get(fusionRoute[1], session?.address)); return; }
      if (!session) { send(res, 401, { error: 'Connect and verify your wallet first.' }); return; }
      if (url.pathname === '/api/memes' && req.method === 'GET') { send(res, 200, { memes: fusions.listMemes(session.address) }); return; }
      if (url.pathname === '/api/memes' && req.method === 'POST') { send(res, 202, await fusions.createMeme(session.address, await body(req))); return; }
      if (memeRoute && req.method === 'POST') {
        if (memeRoute[2] === 'generate') { send(res, 202, await fusions.generateMeme(memeRoute[1], session.address)); return; }
        if (memeRoute[2] === 'cancel') { send(res, 200, await fusions.cancelMeme(memeRoute[1], session.address)); return; }
      }
      if (req.method === 'GET' && url.pathname === '/api/drawing-usage') { send(res, 200, fusions.usage(session.address)); return; }
      if (['GET', 'HEAD'].includes(req.method) && ['/api/chog-preview', '/api/chog-image'].includes(url.pathname)) {
        const tokenId = url.searchParams.get('id');
        if (!validTokenId(tokenId)) { send(res, 400, { error: 'Enter a valid numeric token ID.' }); return; }
        try {
          if (url.pathname === '/api/chog-preview') { send(res, 200, await previews.preview(tokenId)); return; }
          const version = url.searchParams.get('v');
          if (!/^[a-f0-9]{64}$/.test(version || '')) { send(res, 400, { error: 'Reload the artwork preview.' }); return; }
          const image = await previews.image(tokenId, version);
          res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.bytes.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
          res.end(req.method === 'HEAD' ? undefined : image.bytes); return;
        } catch { send(res, 502, { error: 'Artwork preview is temporarily unavailable. Check the token ID or try again.' }); return; }
      }
      if (url.pathname === '/api/fusions' && req.method === 'GET') { send(res, 200, { requests: fusions.list(session.address) }); return; }
      if (url.pathname === '/api/fusions' && req.method === 'POST') { send(res, 201, await fusions.create(session.address, await body(req))); return; }
      if (fusionRoute && req.method === 'POST') {
        const [, id, action] = fusionRoute;
        if (action === 'message') { send(res, 200, await fusions.message(id, session.address)); return; }
        if (action === 'approve') { const input = await body(req); send(res, 200, await fusions.approve(id, session.address, input?.signature)); return; }
        if (action === 'recheck') { send(res, 200, await fusions.recheck(id, session.address)); return; }
        if (action === 'cancel') { send(res, 200, await fusions.cancel(id, session.address)); return; }
        if (action === 'generate') { send(res, 202, await fusions.generate(id, session.address)); return; }
        if (action === 'comic') { send(res, 202, await fusions.generateComic(id, session.address)); return; }
        if (action === 'cancel-comic') { send(res, 200, await fusions.cancelComic(id, session.address)); return; }
        if (action === 'episode') { send(res, 202, await fusions.generateEpisode(id, session.address, await body(req))); return; }
        if (action === 'cancel-episode') { send(res, 200, await fusions.cancelEpisode(id, session.address, await body(req))); return; }
        if (action === 'stickers') { send(res, 202, await fusions.generateStickers(id, session.address)); return; }
        if (action === 'cancel-stickers') { send(res, 200, await fusions.cancelStickers(id, session.address)); return; }
      }
      if (req.method === 'GET' && url.pathname === '/api/chogs') {
        try {
          const balance = await chain.balance(session.address);
          let tokenIds = null;
          try { tokenIds = await chain.ownedTokenIds(session.address, balance); } catch { /* Manual token ID lookup works without enumeration support. */ }
          send(res, 200, { address: session.address, balance: String(balance), tokenIds, limit: 12 });
        } catch { send(res, 502, { error: 'Could not reach the Monad collection. Retry in a moment or configure MONAD_RPC_URL.' }); }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/chog') {
        const tokenId = url.searchParams.get('id');
        if (!validTokenId(tokenId)) { send(res, 400, { error: 'Enter a valid numeric token ID.' }); return; }
        try {
          const token = await chain.token(tokenId);
          if (token.owner.toLowerCase() !== session.address) { send(res, 403, { error: 'This Chog is not owned by your verified wallet.' }); return; }
          send(res, 200, { tokenId, owner: token.owner, tokenURI: token.tokenURI, collection, checkedAt: new Date(now()).toISOString() });
        } catch { send(res, 502, { error: 'Could not read this Chog. Check its token ID and retry; the RPC may be unavailable.' }); }
        return;
      }
      send(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof FusionError) { send(res, error.status, { error: error.message }); return; }
      send(res, error.message === 'Invalid JSON.' || error.message === 'Request too large.' ? 400 : 500, { error: ['Invalid JSON.', 'Request too large.'].includes(error.message) ? error.message : 'Something went wrong. Please retry.' });
    }
  };
  handler.idle = () => fusions.idle();
  return handler;
}
