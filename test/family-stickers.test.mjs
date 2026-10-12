import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import sharp from 'sharp';
import { createFusionService } from '../src/fusions.mjs';
import { createMemoryFusionStore, createSqliteFusionStore } from '../src/fusion-store.mjs';
import { createApplication } from '../src/application.mjs';
import { collection } from '../src/chain.mjs';
import { digest, loadArtDirection } from '../src/art-direction.mjs';
import { createImageGenerator, familyStickerPrompt } from '../src/image-generator.mjs';
import { createStickerAssets, cutBackground, stickerReactions, crc32 } from '../src/sticker-assets.mjs';
import { fixtureStickerSheet } from '../scripts/fixture-art.mjs';

const child = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=', 'base64');
const actor = privateKeyToAccount(generatePrivateKey()), a = actor.address.toLowerCase(), b = '0x' + '2'.repeat(40), id = 'a'.repeat(64);
const status = n => e => e.status === n;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const sheet = await fixtureStickerSheet();
function fixture(options = {}) {
  let time = Date.UTC(2026, 9, 12, 12), owners = [a, b];
  const store = options.store || createMemoryFusionStore(), direction = loadArtDirection(), calls = [];
  store.complete({ id, origin: 'http://localhost:3000', state: 'generated', createdBy: a, chainId: collection.chainId, collection: collection.address, createdAt: time, expires: time - 1, checkedAt: time, checkedBlock: '123', creatorVerifiedAt: time, approvalPolicy: 'creator', artDirection: direction.label, artDirectionHash: direction.hash, parents: [{ tokenId: '11', owner: a }, { tokenId: '22', owner: b }], artwork: { digest: digest(child), createdAt: time, mode: 'fixture' } }, child);
  const config = { store, origin: 'http://localhost:3000', now: () => time, holderDailyLimit: 4, dailyLimit: 10,
    chain: { async owners() { return { owners, blockNumber: 123n }; } },
    loadReference: async (_, tokenId) => ({ tokenId, name: 'Synthetic parent', traits: [], bytes: child, mime: 'image/png' }),
    imageGenerator: { configured: true, model: 'synthetic', mode: 'fixture', async generate(input) { calls.push(input); return { bytes: sheet, mode: 'fixture', model: 'synthetic' }; } }, ...options };
  const service = createFusionService(config);
  return { store, config, service, calls, transfer: () => { owners = [a, '0x' + '3'.repeat(40)]; }, advance: ms => { time += ms; } };
}

test('one sheet produces six transparent 512px PNGs and a ZIP, while enclosed white features remain intact', async () => {
  const assets = await createStickerAssets(sheet, { fixture: true });
  assert.deepEqual(Object.keys(assets), [...stickerReactions.map(r => r.id), 'zip']);
  for (const reaction of stickerReactions) {
    const decoded = await sharp(assets[reaction.id]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 512); assert.equal(decoded.info.height, 512); assert.equal(decoded.data[3], 0);
    assert.ok(decoded.data.some((v, i) => i % 4 === 3 && v === 255));
  }
  const raw = Buffer.alloc(20 * 20 * 4, 255);
  for (let y = 3; y < 17; y++) for (let x = 3; x < 17; x++) if (x === 3 || x === 16 || y === 3 || y === 16) { const p = (y * 20 + x) * 4; raw[p] = raw[p + 1] = raw[p + 2] = 0; }
  const result = cutBackground(raw, 20, 20);
  assert.equal(result.data[3], 0); assert.equal(result.data[(10 * 20 + 10) * 4 + 3], 255);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(assets.zip.readUInt32LE(0), 0x04034b50);
  assert.ok(assets.zip.includes(Buffer.from('TEST STICKERS: synthetic artwork')));
});

test('sticker packs need a saved child and its creator, with no requirement to generate a comic first', async () => {
  const f = fixture();
  await assert.rejects(f.service.generateStickers(id, b), status(403));
  const record = f.store.get(id); record.state = 'approved'; record.expires = f.config.now() + 10000; f.store.put(record);
  await assert.rejects(f.service.generateStickers(id, a), status(409));
  record.state = 'generated'; f.store.put(record);
  await f.service.generateStickers(id, a); await f.service.idle();
  assert.equal(f.service.get(id).stickers.state, 'generated'); assert.equal(f.service.get(id).comic, null);
});

test('concurrent and repeated clicks dispatch once, reference the same saved child, and retain earlier artwork', async () => {
  const f = fixture();
  await Promise.all([f.service.generateStickers(id, a), f.service.generateStickers(id, a)]); await f.service.idle();
  await f.service.generateStickers(id, a); await f.service.idle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'stickers'); assert.deepEqual(f.calls[0].parents[2].bytes, child);
  const view = f.service.get(id), pack = view.stickers.artwork;
  assert.equal(pack.items.length, 6); assert.deepEqual(f.service.artwork(id), child); assert.equal(f.service.usage(a).used, 1); assert.equal(f.service.usage(b).used, 0);
  assert.equal(f.service.get(id, a).canGenerateStickers, false); assert.doesNotMatch(JSON.stringify(view), /preparationId|requestedBy|providerRequestId/);
  for (const item of pack.items) assert.equal(digest(f.service.stickerAsset(id, item.id)), item.digest);
  assert.equal(digest(f.service.stickerAsset(id, 'zip')), pack.zipDigest);
  await assert.rejects(Promise.resolve().then(() => f.service.stickerAsset(id, 'source')), status(404));
});

test('ownership changes, damaged children and cancelled preparation do not dispatch paid sticker requests', async () => {
  const changed = fixture(); changed.transfer(); await assert.rejects(changed.service.generateStickers(id, a), status(409));
  const f = fixture(), gate = deferred();
  const service = createFusionService({ ...f.config, loadReference: async () => { await gate.promise; return { bytes: child, mime: 'image/png' }; } });
  await service.generateStickers(id, a); f.transfer(); gate.resolve(); await service.idle();
  assert.equal(f.calls.length, 0); assert.equal(service.get(id).stickers.state, 'ready');
  const broken = fixture(); broken.store.complete(broken.store.get(id), Buffer.concat([child, Buffer.from('damage')]));
  await broken.service.generateStickers(id, a); await broken.service.idle(); assert.equal(broken.calls.length, 0);
  const cancelled = fixture(), prep = deferred();
  const cancellation = createFusionService({ ...cancelled.config, loadReference: async () => { await prep.promise; return { bytes: child, mime: 'image/png' }; } });
  await cancellation.generateStickers(id, a); await assert.rejects(cancellation.cancelStickers(id, b), status(403)); await cancellation.cancelStickers(id, a); prep.resolve(); await cancellation.idle();
  assert.equal(cancelled.calls.length, 0); assert.equal(cancellation.get(id).stickers.state, 'cancelled');
});

test('a cancelled older preparation cannot modify its replacement sticker request', async () => {
  const f = fixture(), old = deferred(), next = deferred(); let loads = 0;
  const service = createFusionService({ ...f.config, loadReference: async () => { const value = await (loads++ < 2 ? old.promise : next.promise); if (value === 'fail') throw new Error('Old failed'); return { bytes: child, mime: 'image/png' }; } });
  await service.generateStickers(id, a); await service.cancelStickers(id, a); await service.generateStickers(id, a);
  old.resolve('fail'); await new Promise(resolve => setImmediate(resolve)); assert.equal(service.get(id).stickers.state, 'preparing');
  next.resolve(); await service.idle(); assert.equal(f.calls.length, 1); assert.equal(service.get(id).stickers.state, 'generated');
});

test('stickers share global, creator and concurrency limits with every earlier drawing type', async () => {
  const f = fixture({ dailyLimit: 3 }), record = f.store.get(id);
  record.generation = { providerStartedAt: f.config.now() - 10 }; record.comic = { providerStartedAt: f.config.now() - 9 }; record.episodes = [{ providerStartedAt: f.config.now() - 8 }]; f.store.put(record);
  await assert.rejects(f.service.generateStickers(id, a), status(429)); f.advance(86400000);
  await f.service.generateStickers(id, a); await f.service.idle(); assert.equal(f.service.usage(a).used, 1);
  const busy = fixture({ concurrency: 1 }), gate = deferred();
  const service = createFusionService({ ...busy.config, loadReference: async () => { await gate.promise; return { bytes: child, mime: 'image/png' }; } });
  await service.generateStickers(id, a); const other = { ...busy.store.get(id), id: 'b'.repeat(64), stickers: null }; busy.store.complete(other, child);
  await assert.rejects(service.generateStickers(other.id, a), status(429)); gate.resolve(); await service.idle();
});

test('provider failures and unusable sheets count as one attempt, remain terminal and preserve the child', async () => {
  for (const output of ['error', 'blank']) {
    const f = fixture(); f.config.imageGenerator.generate = async () => { if (output === 'error') throw new Error('private-provider-failure'); return { bytes: await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'white' } }).png().toBuffer(), mode: 'fixture' }; };
    await f.service.generateStickers(id, a); await f.service.idle();
    assert.equal(f.service.get(id).stickers.state, 'failed'); assert.equal(f.service.usage(a).used, 1); assert.deepEqual(f.service.artwork(id), child);
    assert.doesNotMatch(JSON.stringify(f.service.get(id)), /private-provider/); await assert.rejects(f.service.generateStickers(id, a), status(409));
  }
});

test('SQLite preserves all seven downloads and never replays a potentially charged sticker request after restart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chog-stickers-')), 'test.sqlite'), f = fixture({ store: createSqliteFusionStore(path) });
  await f.service.generateStickers(id, a); await f.service.idle(); const zip = f.service.stickerAsset(id, 'zip');
  const second = { ...f.store.get(id), id: 'b'.repeat(64), stickers: { state: 'generating', providerStartedAt: f.config.now() } }; f.store.complete(second, child);
  const third = { ...second, id: 'c'.repeat(64), stickers: { state: 'preparing' } }; f.store.complete(third, child); f.store.close();
  const store = createSqliteFusionStore(path), service = createFusionService({ ...f.config, store });
  assert.deepEqual(service.stickerAsset(id, 'zip'), zip); for (const r of stickerReactions) assert.ok(service.stickerAsset(id, r.id).length);
  assert.equal(service.get(second.id).stickers.state, 'failed'); assert.equal(service.get(third.id).stickers.state, 'ready'); await service.idle(); assert.equal(f.calls.length, 1); store.close();
});

test('both provider adapters receive one six-cell sticker request with the saved child before artist references', async () => {
  assert.match(familyStickerPrompt([], { label: 'Artist' }), /TWO columns and THREE rows/);
  for (const provider of ['openai', 'orbio']) {
    let count = 0;
    const generator = createImageGenerator({ provider, apiKey: provider === 'orbio' ? 'sk-orbio-test-only' : 'test-only', fetcher: async (_, options) => {
      count++; const payload = provider === 'orbio' ? JSON.parse(options.body) : null, prompt = payload?.prompt || options.body.get('prompt');
      assert.match(prompt, /SIX separate reaction/); assert.match(prompt, /Cell 6, row 3, column 2/); assert.match(prompt, /saved child design/);
      assert.equal(payload ? payload.n : Number(options.body.get('n')), 1);
      assert.equal(payload ? payload.input_references.length : options.body.getAll('image[]').length, 4);
      return new Response(JSON.stringify({ data: [{ b64_json: sheet.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
    } });
    await generator.generate({ kind: 'stickers', parents: [1, 2, 3].map(tokenId => ({ tokenId: String(tokenId), bytes: child, mime: 'image/png' })), artDirection: { label: 'Artist', images: [{ bytes: child, mime: 'image/png' }] } }); assert.equal(count, 1);
  }
});

test('HTTP sticker mutations require a signed session; saved PNGs, ZIP and family pages are public', async () => {
  const f = fixture(), app = createApplication({ chain: f.config.chain, origin: f.config.origin, now: f.config.now, fusionStore: f.store, generationOptions: { imageGenerator: f.config.imageGenerator, loadReference: f.config.loadReference, holderDailyLimit: 4 } });
  async function request(path, { method = 'GET', data, cookie, origin = f.config.origin } = {}) {
    const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []); req.url = path; req.method = method; req.headers = { origin, ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'test' };
    const result = { headers: {} }; await app(req, { setHeader(key, value) { result.headers[key.toLowerCase()] = value; }, writeHead(code, headers = {}) { result.status = code; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); }, end(bytes) { result.bytes = bytes; try { result.body = JSON.parse(bytes); } catch { result.body = bytes?.toString(); } } }); return result;
  }
  assert.equal((await request(`/api/fusions/${id}/stickers`, { method: 'POST' })).status, 401);
  const challenge = await request('/api/auth/challenge', { method: 'POST', data: { address: a } }), signature = await actor.signMessage({ message: challenge.body.message });
  const login = await request('/api/auth/verify', { method: 'POST', data: { id: challenge.body.id, signature } }), cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await request(`/api/fusions/${id}/stickers`, { method: 'POST', cookie, origin: 'https://other.example' })).status, 403);
  assert.equal((await request(`/api/fusions/${id}/stickers`, { method: 'POST', cookie })).status, 202); await app.idle();
  const view = (await request(`/api/fusions/${id}`)).body, pack = view.stickers.artwork;
  const png = await request(pack.items[0].url); assert.equal(png.status, 200); assert.equal(png.headers['content-type'], 'image/png');
  const zip = await request(pack.zipUrl); assert.equal(zip.status, 200); assert.equal(zip.headers['content-type'], 'application/zip'); assert.match(zip.headers['content-disposition'], /attachment/);
  const head = await request(pack.zipUrl, { method: 'HEAD' }); assert.equal(head.bytes, undefined); assert.equal(head.headers['content-length'], zip.bytes.length);
  for (const path of [`/stickers/${id}/source.png`, `/stickers/${id}/gm.zip`, `/stickers/${id}/pack.png`, `/stickers/${'d'.repeat(64)}/gm.png`]) assert.equal((await request(path)).status, 404);
  const page = await request(`/characters/${id}`); assert.match(page.body, /TEST STICKERS/); assert.match(page.body, /Download all six/); assert.match(page.body, /not minted NFTs/);
  const record = f.store.get(id); record.stickers.artwork.items[0].name = '<img onerror=bad()>'; f.store.put(record);
  assert.doesNotMatch((await request(`/characters/${id}`)).body, /<img onerror/);
});
