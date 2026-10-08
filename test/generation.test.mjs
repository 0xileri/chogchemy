import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createFusionService } from '../src/fusions.mjs';
import { createMemoryFusionStore, createSqliteFusionStore } from '../src/fusion-store.mjs';
import { loadArtDirection, digest } from '../src/art-direction.mjs';
import { loadParentReference, referenceUrl, limitedBytes } from '../src/reference-assets.mjs';
import { createImageGenerator } from '../src/image-generator.mjs';
import { createApplication } from '../src/application.mjs';
import { Readable } from 'node:stream';

// A tiny synthetic PNG used only as a deterministic test result, never as AI artwork.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=', 'base64');
const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey()), stranger = privateKeyToAccount(generatePrivateKey());
const address = account => account.address.toLowerCase();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const status = expected => error => error.status === expected;
function fixture(options = {}) {
  let calls = 0, time = Date.UTC(2026, 9, 8, 12), owners = [a.address, b.address];
  const store = options.store || createMemoryFusionStore();
  const imageGenerator = { configured: true, mode: 'fixture', model: 'test', async generate() { calls++; return { bytes: png, mode: 'fixture', model: 'test' }; }, ...options.imageGenerator };
  const chain = { async owners() { return { owners, blockNumber: 100n }; } };
  const config = { store, chain, origin: 'http://localhost:3000', now: () => time, loadReference: async (_, tokenId) => ({ tokenId, bytes: png, mime: 'image/png', name: 'Test', traits: [], digest: digest(png) }), ...options, imageGenerator: options.imageGenerator === null ? null : imageGenerator };
  const service = createFusionService(config);
  async function create(approved = true) {
    const r = await service.create(address(a), { parentA: '11', parentB: '22' });
    if (approved) for (const account of [a, b]) { const { message } = await service.message(r.id, address(account)); await service.approve(r.id, address(account), await account.signMessage({ message })); }
    return service.get(r.id, address(a));
  }
  return { service, store, config, create, calls: () => calls, transfer: () => { owners = [a.address, stranger.address]; }, advance: ms => { time += ms; } };
}

test('generation requires both consent signatures and an invited authenticated holder', async () => {
  const f = fixture(), r = await f.create(false);
  await assert.rejects(f.service.generate(r.id, address(stranger)), status(403));
  await assert.rejects(f.service.generate(r.id, address(a)), status(409));
  assert.equal(f.calls(), 0);
});
test('one generation is shared by concurrent calls and subsequent reloads', async () => {
  const f = fixture(), r = await f.create();
  assert.equal(r.generationAvailable, true);
  await Promise.all([f.service.generate(r.id, address(a)), f.service.generate(r.id, address(b))]);
  await f.service.idle();
  const done = await f.service.generate(r.id, address(a));
  assert.equal(f.calls(), 1); assert.equal(done.state, 'generated'); assert.equal(done.artwork.digest, digest(png));
  assert.deepEqual(f.service.artwork(r.id), png); assert.equal(f.service.gallery()[0].id, r.id);
  assert.doesNotMatch(JSON.stringify(done), /signature|providerRequestId|tokenURI/);
});
test('parent transfer while references load blocks the provider', async () => {
  const ready = deferred(), wait = deferred();
  const f = fixture({ loadReference: async (_, tokenId) => { ready.resolve(); await wait.promise; return { tokenId, bytes: png }; } });
  const r = await f.create(); await f.service.generate(r.id, address(a)); await ready.promise;
  f.transfer(); wait.resolve(); await f.service.idle();
  assert.equal(f.calls(), 0); assert.equal(f.service.get(r.id).state, 'invalidated');
});
test('holder cancellation during preparation prevents generation', async () => {
  const wait = deferred(); const f = fixture({ loadReference: async () => { await wait.promise; return { bytes: png }; } });
  const r = await f.create(); await f.service.generate(r.id, address(a));
  await f.service.cancel(r.id, address(b)); wait.resolve(); await f.service.idle();
  assert.equal(f.calls(), 0); assert.equal(f.service.get(r.id).state, 'cancelled');
});
test('expiry reached during preparation prevents generation', async () => {
  const wait = deferred(); const f = fixture({ loadReference: async () => { await wait.promise; return { bytes: png }; } });
  const r = await f.create(); await f.service.generate(r.id, address(a)); f.advance(86400001); wait.resolve(); await f.service.idle();
  assert.equal(f.calls(), 0); assert.equal(f.service.get(r.id).state, 'expired');
});
test('generation already dispatched cannot be cancelled and may finish after consent deadline', async () => {
  const started = deferred(), wait = deferred(); const f = fixture({ imageGenerator: { async generate() { started.resolve(); await wait.promise; return { bytes: png, mode: 'fixture' }; } } });
  const r = await f.create(); await f.service.generate(r.id, address(a)); await started.promise;
  await assert.rejects(f.service.cancel(r.id, address(b)), status(409)); f.advance(86400001); wait.resolve(); await f.service.idle();
  assert.equal(f.service.get(r.id).state, 'generated');
});
test('reference failure is safe to retry and does not consume the daily provider quota', async () => {
  let broken = true;
  const f = fixture({ dailyLimit: 1, loadReference: async () => { if (broken) throw new Error('secret'); return { bytes: png }; } });
  const r = await f.create(); await f.service.generate(r.id, address(a)); await f.service.idle();
  assert.equal(f.service.get(r.id).state, 'approved'); assert.doesNotMatch(f.service.get(r.id).generation.error, /secret/);
  broken = false; await f.service.generate(r.id, address(b)); await f.service.idle(); assert.equal(f.calls(), 1);
});
test('ambiguous provider failure is terminal, hides details, and is counted toward quota', async () => {
  const f = fixture({ dailyLimit: 1, imageGenerator: { async generate() { throw new Error('Bearer secret'); } } });
  const r = await f.create(); await f.service.generate(r.id, address(a)); await f.service.idle();
  assert.equal(f.service.get(r.id).state, 'generation_failed'); assert.doesNotMatch(f.service.get(r.id).generation.error, /secret/);
  await assert.rejects(f.service.generate(r.id, address(a)), status(409));
  const next = await f.create(); await assert.rejects(f.service.generate(next.id, address(a)), status(429));
});
test('global and holder daily quotas survive service restart and reset at UTC midnight', async () => {
  const f = fixture({ holderDailyLimit: 1 }); const r = await f.create(); await f.service.generate(r.id, address(a)); await f.service.idle();
  const next = await f.create(), restarted = createFusionService(f.config);
  await assert.rejects(restarted.generate(next.id, address(b)), status(429));
  // Move close to the next midnight without exceeding the invitation lifetime.
  f.advance(12 * 60 * 60 * 1000 + 1);
  await restarted.generate(next.id, address(b)); await restarted.idle(); assert.equal(restarted.get(next.id).state, 'generated');
});
test('concurrency limit applies while references are still loading', async () => {
  const wait = deferred(); const f = fixture({ concurrency: 1, loadReference: async () => { await wait.promise; return { bytes: png }; } });
  const first = await f.create(), second = await f.create(); await f.service.generate(first.id, address(a));
  await assert.rejects(f.service.generate(second.id, address(b)), status(429)); wait.resolve(); await f.service.idle();
});
test('SQLite saves artwork and ancestry together and serves them after restart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chogchemy-art-')), 'test.sqlite');
  let store = createSqliteFusionStore(path); const f = fixture({ store }); const r = await f.create();
  await f.service.generate(r.id, address(a)); await f.service.idle(); store.close();
  store = createSqliteFusionStore(path);
  try { const service = createFusionService({ ...f.config, store }); assert.deepEqual(service.artwork(r.id), png); assert.equal(service.gallery()[0].parents[1].tokenId, '22'); }
  finally { store.close(); }
});
test('restart recovers preparation but never redispatches a potentially charged request', async () => {
  const f = fixture(); const r = await f.create(), other = await f.create();
  for (const [request, state] of [[r, 'preparing'], [other, 'generating']]) { const record = f.store.get(request.id); record.state = state; record.generation = { providerStartedAt: state === 'generating' ? Date.now() : null }; f.store.put(record); }
  const restarted = createFusionService(f.config);
  assert.equal(restarted.get(r.id).state, 'approved'); assert.equal(restarted.get(other.id).state, 'generation_failed'); assert.equal(f.calls(), 0);
});
test('changing the style prevents generation under old approvals', async () => {
  const f = fixture(), r = await f.create();
  const service = createFusionService({ ...f.config, artDirection: { ...loadArtDirection(), hash: 'different' } });
  await assert.rejects(service.generate(r.id, address(a)), status(409)); assert.equal(f.calls(), 0);
});
test('missing image key leaves consent untouched', async () => {
  const f = fixture({ imageGenerator: null }), r = await f.create();
  await assert.rejects(f.service.generate(r.id, address(a)), status(503)); assert.equal(f.service.get(r.id).state, 'approved');
});
test('artist reference contents and rules are covered by the style hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'chogchemy-style-')); mkdirSync(join(root, 'assets/artist'), { recursive: true });
  const config = { version: '1', label: 'Artist', rules: ['Draw one character'], references: ['sample.png'] };
  writeFileSync(join(root, 'art-direction.json'), JSON.stringify(config)); writeFileSync(join(root, 'assets/artist/sample.png'), png);
  const first = loadArtDirection(root); writeFileSync(join(root, 'assets/artist/sample.png'), Buffer.concat([png, Buffer.from('changed')]));
  assert.notEqual(loadArtDirection(root).hash, first.hash);
  config.references = ['../../private.png']; writeFileSync(join(root, 'art-direction.json'), JSON.stringify(config)); assert.throws(() => loadArtDirection(root), /stay in/);
});
test('reference loading supports inline metadata and rejects private URLs and redirect targets', async () => {
  const metadata = { name: 'Test', image: `data:image/png;base64,${png.toString('base64')}`, attributes: [{ trait_type: 'Color', value: 'green' }] };
  const reference = await loadParentReference({ token: async () => ({ tokenURI: `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}` }) }, '11');
  assert.deepEqual(reference.bytes, png); assert.equal(reference.traits[0].value, 'green');
  for (const value of ['http://127.0.0.1/private', 'https://ipfs.io@127.0.0.1/private', 'https://ipfs.io/api/private', 'https://example.com/image.png']) assert.throws(() => referenceUrl(value));
  await assert.rejects(loadParentReference({ token: async () => ({ tokenURI: `ipfs://${'a'.repeat(40)}/test.json` }) }, '11', async () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } })), /not supported/);
  await assert.rejects(limitedBytes(new Response('12345'), 4), /too large/);
});
test('provider sends both parents and artist references, requests one PNG, and never retries failures', async () => {
  let calls = 0;
  const generator = createImageGenerator({ apiKey: 'test-only', fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(options.body.getAll('image[]').length, 3); assert.equal(options.body.get('n'), '1'); assert.equal(options.body.get('output_format'), 'png');
    assert.equal(options.body.has('input_fidelity'), false);
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  } });
  const parent = { bytes: png, mime: 'image/png', tokenId: '11' };
  assert.deepEqual((await generator.generate({ parents: [parent, parent], artDirection: { rules: ['Draw'], images: [parent] } })).bytes, png); assert.equal(calls, 1);
  let failures = 0; const broken = createImageGenerator({ apiKey: 'test-only', fetcher: async () => { failures++; return new Response('sensitive provider details', { status: 500 }); } });
  await assert.rejects(broken.generate({ parents: [parent, parent], artDirection: { rules: [], images: [] } }), /HTTP 500/); assert.equal(failures, 1);
  assert.throws(() => createImageGenerator({ apiKey: 'sk-orbio-test-only' }), /Orbio key/);
});

test('IPFS gateway rate limiting falls back to another trusted host for metadata and image', async () => {
  const hosts = [];
  const reference = await loadParentReference({ token: async () => ({ tokenURI: `ipfs://${'a'.repeat(40)}/token.json` }) }, '11', async url => {
    const parsed = new URL(url); hosts.push(parsed.hostname);
    if (parsed.hostname === 'ipfs.io') return new Response('', { status: 429 });
    if (parsed.pathname.endsWith('.json')) return Response.json({ image: `ipfs://${'b'.repeat(40)}/image.png` });
    return new Response(png);
  });
  assert.deepEqual(reference.bytes, png); assert.deepEqual(hosts, ['ipfs.io', 'gateway.pinata.cloud', 'ipfs.io', 'gateway.pinata.cloud']);
});

test('HTTP generation needs a session and serves the saved PNG and gallery publicly', async () => {
  const f = fixture(), r = await f.create();
  const app = createApplication({ chain: f.config.chain, fusionStore: f.store, origin: f.config.origin, now: f.config.now, generationOptions: { imageGenerator: f.config.imageGenerator, loadReference: f.config.loadReference } });
  async function request(path, { cookie, data, method } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.url = path; req.method = method || (data === undefined ? 'GET' : 'POST'); req.headers = { origin: f.config.origin, ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'http-test' };
    const response = { headers: {} };
    await app(req, { setHeader(k, v) { response.headers[k.toLowerCase()] = v; }, writeHead(status, headers = {}) { response.status = status; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); }, end(body) { response.bytes = body; try { response.body = JSON.parse(body); } catch {} } });
    return response;
  }
  assert.equal((await request(`/api/fusions/${r.id}/generate`, { data: {} })).status, 401);
  assert.equal((await request(`/artwork/${r.id}.png`)).status, 404);
  const challenge = (await request('/api/auth/challenge', { data: { address: a.address } })).body;
  const login = await request('/api/auth/verify', { data: { id: challenge.id, signature: await a.signMessage({ message: challenge.message }) } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await request(`/api/fusions/${r.id}/generate`, { cookie, data: {} })).status, 202);
  await app.idle();
  assert.equal(f.store.get(r.id).state, 'generated');
  const image = await request(`/artwork/${r.id}.png`); assert.equal(image.headers['content-type'], 'image/png'); assert.deepEqual(image.bytes, png);
  assert.equal((await request(`/artwork/${r.id}.png`, { method: 'HEAD' })).bytes, undefined);
  assert.equal((await request('/api/gallery')).body.artworks[0].id, r.id);
  assert.equal((await request('/healthz')).status, 200);
});

test('Orbio receives one image request with both parents and artist references at its own endpoint', async () => {
  let calls = 0;
  const generator = createImageGenerator({ provider: 'orbio', apiKey: 'sk-orbio-test-only', fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://api.orbio.so/api/v1/images');
    assert.equal(options.headers.Authorization, 'Bearer sk-orbio-test-only');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'openai/gpt-image-2'); assert.equal(payload.n, 1); assert.equal(payload.output_format, 'png');
    assert.equal(payload.input_references.length, 3);
    for (const reference of payload.input_references) assert.equal(reference.image_url.url, `data:image/png;base64,${png.toString('base64')}`);
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  } });
  const parent = { tokenId: '11', bytes: png, mime: 'image/png' };
  const result = await generator.generate({ parents: [parent, parent], artDirection: { rules: ['Draw one character'], images: [parent] } });
  assert.equal(result.provider, 'orbio'); assert.deepEqual(result.bytes, png); assert.equal(calls, 1);
});

test('Orbio provider never uses the OpenAI key or retries a rejected or malformed response', async () => {
  assert.throws(() => createImageGenerator({ provider: 'orbio', apiKey: 'sk-proj-test-only' }), /Orbio gateway key/);
  assert.throws(() => createImageGenerator({ provider: 'unknown' }), /IMAGE_PROVIDER/);
  const missing = createImageGenerator({ provider: 'orbio', apiKey: '' }); assert.equal(missing.configured, false);
  let calls = 0; const parent = { bytes: png, mime: 'image/png' }, input = { parents: [parent, parent], artDirection: { rules: [], images: [] } };
  const rejected = createImageGenerator({ provider: 'orbio', apiKey: 'sk-orbio-test-only', fetcher: async () => { calls++; return new Response('secret account details', { status: 402 }); } });
  await assert.rejects(rejected.generate(input), error => error.message === 'Image provider returned HTTP 402.'); assert.equal(calls, 1);
  const malformed = createImageGenerator({ provider: 'orbio', apiKey: 'sk-orbio-test-only', fetcher: async () => Response.json({ data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] }) });
  await assert.rejects(malformed.generate(input), /PNG|Reference images/);
});

test('oversized Orbio reference payload is rejected before dispatch and quota reservation', async () => {
  let calls = 0;
  const generator = createImageGenerator({ provider: 'orbio', apiKey: 'sk-orbio-test-only', fetcher: async () => { calls++; throw new Error('Must not dispatch'); } });
  const f = fixture({ imageGenerator: generator, loadReference: async () => ({ bytes: Buffer.alloc(1600000), mime: 'image/png' }) });
  const r = await f.create(); await f.service.generate(r.id, address(a)); await f.service.idle();
  assert.equal(calls, 0); assert.equal(f.service.get(r.id).state, 'approved');
  assert.equal(f.store.get(r.id).generation.providerStartedAt, undefined);
  assert.match(f.service.get(r.id).generation.error, /Orbio request limit/);
});
