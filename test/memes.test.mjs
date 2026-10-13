import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createFusionService } from '../src/fusions.mjs';
import { createMemoryFusionStore, createSqliteFusionStore } from '../src/fusion-store.mjs';
import { memeCatalog, memeTemplate, loadMemeTemplate, captionMeme } from '../src/meme-catalog.mjs';
import { createImageGenerator } from '../src/image-generator.mjs';
import { createApplication } from '../src/application.mjs';
import { digest } from '../src/art-direction.mjs';
import { renderMemePage } from '../src/character-page.mjs';
const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey());
const address = account => account.address.toLowerCase();
const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#73aa33' } }).png().toBuffer();
const status = code => error => error.status === code;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  let time = Date.UTC(2026, 9, 14, 12), owner = a.address;
  const store = options.store || createMemoryFusionStore(), calls = [];
  const chain = { async owners(ids) { return { owners: ids.map(id => id === '11' ? owner : b.address), blockNumber: 123n }; } };
  const direction = { hash: 'test-style', label: 'Test artist', rules: [], images: [{ bytes: png, mime: 'image/png' }, { bytes: png, mime: 'image/png' }] };
  const imageGenerator = { configured: true, mode: 'fixture', model: 'test', async generate(input) { calls.push(input); return { bytes: png, mode: 'fixture', model: 'test' }; }, ...options.imageGenerator };
  const config = { origin: 'http://localhost:3000', chain, store, now: () => time, artDirection: direction, holderDailyLimit: 4,
    loadReference: async (_, tokenId) => ({ bytes: png, mime: 'image/png', tokenId, digest: digest(png) }),
    templateLoader: async template => ({ bytes: png, mime: 'image/png', templateId: template.id, digest: digest(png) }), ...options, imageGenerator };
  const service = createFusionService(config);
  const input = { tokenId: '11', templateId: memeCatalog.templates[0].id, nonce: '1'.repeat(32), topCaption: 'My Chog', bottomCaption: 'Main character energy' };
  return { service, store, config, calls, input, transfer: () => { owner = b.address; }, advance: ms => { time += ms; } };
}
test('catalog has 100 unique fixed templates and only approved non-redirecting image references can load', async () => {
  assert.equal(memeCatalog.templates.length, 100); assert.equal(new Set(memeCatalog.templates.map(t => t.id)).size, 100);
  const template = memeCatalog.templates[0]; let requested;
  const image = await loadMemeTemplate(template, async (url, options) => { requested = url; assert.equal(options.redirect, 'manual'); return new Response(png); });
  assert.equal(requested, template.imageUrl); assert.equal(image.digest, digest(png));
  await assert.rejects(loadMemeTemplate({ ...template, imageUrl: 'http://127.0.0.1/private' }), /Unknown/);
  await assert.rejects(loadMemeTemplate(template, async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1' } })), /unavailable/);
  await assert.rejects(loadMemeTemplate(template, async () => new Response('<svg>bad</svg>')), /PNG|JPEG|WebP/);
});
test('meme requires ownership of its actual Chog and a catalog template, and ignores client URLs', async () => {
  const f = fixture();
  await assert.rejects(f.service.createMeme(address(b), f.input), status(409));
  for (const data of [{ templateId: 'unknown' }, { tokenId: '-1' }, { nonce: 'bad' }, { topCaption: '<'.repeat(81) }, { bottomCaption: '\n' }, { characterRole: {} }]) await assert.rejects(f.service.createMeme(address(a), { ...f.input, ...data }), status(400));
  const record = await f.service.createMeme(address(a), { ...f.input, imageUrl: 'http://127.0.0.1', creator: b.address }); await f.service.idle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'meme'); assert.equal(f.calls[0].parents[0].tokenId, '11'); assert.equal(f.calls[0].parents[1].templateId, f.input.templateId);
  assert.equal(f.service.getMeme(record.id).createdBy, address(a)); assert.equal(f.service.usage(address(a)).used, 1);
});
test('meme requests are idempotent, immutable and kept out of family galleries and APIs', async () => {
  const f = fixture(); const [aRecord, bRecord] = await Promise.all([f.service.createMeme(address(a), f.input), f.service.createMeme(address(a), f.input)]);
  assert.equal(aRecord.id, bRecord.id); await f.service.idle();
  assert.equal(f.calls.length, 1); assert.equal((await f.service.createMeme(address(a), f.input)).state, 'generated');
  await assert.rejects(f.service.createMeme(address(a), { ...f.input, topCaption: 'different' }), status(409));
  assert.equal(f.service.gallery().length, 0); assert.equal(f.service.list(address(a)).length, 0); assert.equal(f.service.listMemes(address(a)).length, 1);
  assert.equal(f.service.memeGallery().length, 1); assert.throws(() => f.service.get(aRecord.id), status(404)); assert.throws(() => f.service.artwork(aRecord.id), status(404));
  assert.ok(!JSON.stringify(f.service.getMeme(aRecord.id)).includes('nonce'));
});
test('transfer and cancellation during meme preparation never dispatch or consume quota', async () => {
  for (const action of ['transfer', 'cancel']) {
    const ready = deferred(), wait = deferred(); let dispatched = false;
    const f = fixture({ imageGenerator: { async prepareInput(input) { ready.resolve(); await wait.promise; return input; }, async generate() { dispatched = true; return { bytes: png }; } } });
    const r = await f.service.createMeme(address(a), f.input); await ready.promise;
    if (action === 'transfer') f.transfer(); else await f.service.cancelMeme(r.id, address(a));
    wait.resolve(); await f.service.idle();
    assert.equal(dispatched, false); assert.equal(f.service.getMeme(r.id).state, action === 'transfer' ? 'invalidated' : 'cancelled'); assert.equal(f.service.usage(address(a)).used, 0);
  }
});
test('meme prep errors are retryable but ambiguous provider failures are terminal and count once', async () => {
  let broken = true; const f = fixture({ templateLoader: async () => { if (broken) throw new Error('private network error'); return { bytes: png, mime: 'image/png' }; } });
  const r = await f.service.createMeme(address(a), f.input); await f.service.idle(); assert.equal(f.service.getMeme(r.id).state, 'approved'); assert.equal(f.service.usage(address(a)).used, 0);
  await assert.rejects(f.service.generateMeme(r.id, address(b)), status(403)); broken = false; await f.service.generateMeme(r.id, address(a)); await f.service.idle(); assert.equal(f.calls.length, 1);
  const failure = fixture({ imageGenerator: { async generate() { throw new Error('secret provider details'); } } });
  const failed = await failure.service.createMeme(address(a), failure.input); await failure.service.idle();
  assert.equal(failure.service.getMeme(failed.id).state, 'generation_failed'); assert.equal(failure.service.usage(address(a)).used, 1);
  await assert.rejects(failure.service.generateMeme(failed.id, address(a)), status(409)); assert.doesNotMatch(failure.service.getMeme(failed.id).error, /secret/);
});
test('memes and family drawings share quota and concurrency limits', async () => {
  const f = fixture({ holderDailyLimit: 1 }); await f.service.createMeme(address(a), f.input); await f.service.idle();
  const family = await f.service.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
  await assert.rejects(f.service.generate(family.id, address(a)), status(429));
  await assert.rejects(f.service.createMeme(address(a), { ...f.input, nonce: '2'.repeat(32) }), status(429));
  f.advance(86400001); await f.service.createMeme(address(a), { ...f.input, nonce: '2'.repeat(32) }); await f.service.idle(); assert.equal(f.service.usage(address(a)).used, 1);
  const wait = deferred(), occupied = fixture({ concurrency: 1, templateLoader: async () => { await wait.promise; return { bytes: png }; } });
  await occupied.service.createMeme(address(a), occupied.input); const second = await occupied.service.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
  await assert.rejects(occupied.service.generate(second.id, address(a)), status(429)); wait.resolve(); await occupied.service.idle();
});
test('captions are rendered locally as escaped text and saved public pages escape user text', async () => {
  const bytes = await captionMeme(png, '<script>alert(1)</script>', 'One very long unbroken caption'.repeat(2), true);
  const meta = await sharp(bytes).metadata(); assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
  const f = fixture(), record = await f.service.createMeme(address(a), { ...f.input, topCaption: '<script>alert(1)</script>', bottomCaption: '& goodbye' }); await f.service.idle();
  const page = renderMemePage(f.service.getMeme(record.id), f.config.origin); assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.ok(!page.includes('<script>alert(1)'));
  assert.deepEqual(f.service.memeArtwork(record.id), f.store.artwork(record.id));
});
test('SQLite persists memes and never redispatches charged generation on restart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chogchemy-memes-')), 'records.sqlite'), store = createSqliteFusionStore(path), f = fixture({ store });
  const r = await f.service.createMeme(address(a), f.input); await f.service.idle(); const bytes = f.service.memeArtwork(r.id);
  const interrupted = { ...f.store.get(r.id), id: 'b'.repeat(64), state: 'generating', artwork: null, nonce: '3'.repeat(32) }; f.store.put(interrupted); store.close();
  const reopened = createSqliteFusionStore(path);
  try { const service = createFusionService({ ...f.config, store: reopened }); assert.deepEqual(service.memeArtwork(r.id), bytes); assert.equal(service.getMeme(interrupted.id).state, 'generation_failed'); await assert.rejects(service.generateMeme(interrupted.id, address(a)), status(409)); assert.equal(f.calls.length, 1); } finally { reopened.close(); }
});
test('both image providers receive the actual NFT, template, and two style references in order', async () => {
  for (const provider of ['openai', 'orbio']) {
    const generator = createImageGenerator({ provider, apiKey: provider === 'orbio' ? 'sk-orbio-test-only' : 'test-only', fetcher: async (_, options) => {
      const payload = provider === 'orbio' ? JSON.parse(options.body) : null;
      const prompt = payload ? payload.prompt : options.body.get('prompt');
      assert.match(prompt, /Image 1 is the specific Chog/); assert.match(prompt, /Image 2 is the chosen meme template/); assert.match(prompt, /same Chog in each appearance/); assert.match(prompt, /Do not draw a generic Chog/);
      assert.match(prompt, /worried person/); assert.equal(payload ? payload.input_references.length : options.body.getAll('image[]').length, 4);
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    } });
    const image = { bytes: png, mime: 'image/png' }; await generator.generate({ kind: 'meme', parents: [image, image], artDirection: { images: [image, image] }, template: memeCatalog.templates[0], characterRole: 'the worried person' });
  }
});
test('HTTP meme generation is authenticated and origin-bound; saved pages and downloads are public', async () => {
  const f = fixture(), app = createApplication({ chain: f.config.chain, fusionStore: f.store, origin: f.config.origin, now: f.config.now, generationOptions: f.config });
  async function request(path, { cookie, data, method, origin = f.config.origin } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]); req.url = path; req.method = method || (data === undefined ? 'GET' : 'POST'); req.headers = { origin, ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'meme-http-test' };
    const response = { headers: {} }; await app(req, { setHeader(k, v) { response.headers[k.toLowerCase()] = v; }, writeHead(code, headers = {}) { response.status = code; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); }, end(body) { response.bytes = body; try { response.body = JSON.parse(body); } catch {} } }); return response;
  }
  assert.equal((await request('/api/meme-templates')).body.templates.length, 100);
  assert.equal((await request('/api/memes', { data: f.input })).status, 401);
  assert.equal((await request('/api/memes', { data: f.input, origin: 'https://evil.example' })).status, 403);
  const challenge = (await request('/api/auth/challenge', { data: { address: a.address } })).body;
  const login = await request('/api/auth/verify', { data: { id: challenge.id, signature: await a.signMessage({ message: challenge.message }) } }); const cookie = login.headers['set-cookie'].split(';')[0];
  const created = await request('/api/memes', { cookie, data: f.input }); assert.equal(created.status, 202); await app.idle();
  const record = (await request(`/api/memes/${created.body.id}`)).body; assert.equal(record.state, 'generated'); assert.equal(record.canGenerate, false);
  assert.equal((await request(record.artwork.url)).headers['content-type'], 'image/png'); assert.equal((await request(record.artwork.url, { method: 'HEAD' })).bytes, undefined);
  assert.equal((await request(`/memes/${record.id}`)).status, 200); assert.equal((await request(`/characters/${record.id}`)).status, 404);
  assert.equal((await request('/families')).status, 200); assert.ok((await request('/')).bytes.toString().includes('data-studio="memes"')); assert.ok((await request('/?fusion='+'a'.repeat(64))).bytes.toString().includes('id="new-fusion"'));
});
