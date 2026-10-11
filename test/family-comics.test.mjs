import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createFusionService } from '../src/fusions.mjs';
import { createMemoryFusionStore, createSqliteFusionStore } from '../src/fusion-store.mjs';
import { createImageGenerator } from '../src/image-generator.mjs';
import { createApplication } from '../src/application.mjs';
import { digest } from '../src/art-direction.mjs';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=', 'base64');
const comicPng = Buffer.concat([png, Buffer.from('synthetic-comic')]);
const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey()), outsider = privateKeyToAccount(generatePrivateKey());
const address = account => account.address.toLowerCase();
const status = expected => error => error.status === expected;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  let time = Date.UTC(2026, 9, 11, 12), owners = [a.address, b.address];
  const calls = [];
  const store = options.store || createMemoryFusionStore();
  const config = { store, origin: 'http://localhost:3000', now: () => time,
    chain: { async owners() { return { owners, blockNumber: 12345n }; } },
    loadReference: async (_, tokenId) => ({ tokenId, name: 'Synthetic parent', traits: [], bytes: png, mime: 'image/png' }),
    imageGenerator: { configured: true, mode: 'fixture', model: 'synthetic', async generate(input) { calls.push(input); return { bytes: input.kind === 'comic' ? comicPng : png, model: 'synthetic', mode: 'fixture' }; } }, ...options };
  const service = createFusionService(config);
  async function child() {
    const request = await service.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
    await service.generate(request.id, address(a)); await service.idle();
    return service.get(request.id, address(a));
  }
  return { service, store, config, calls, child, transfer: () => { owners = [a.address, outsider.address]; }, advance: ms => { time += ms; } };
}

test('a comic requires a saved child and the creator, and carries that exact child as its third reference', async () => {
  const f = fixture();
  const pending = await f.service.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
  await assert.rejects(f.service.generateComic(pending.id, address(a)), status(409));
  const child = await f.child();
  for (const person of [b, outsider]) await assert.rejects(f.service.generateComic(child.id, address(person)), status(403));
  await f.service.generateComic(child.id, address(a)); await f.service.idle();
  const finished = f.service.get(child.id);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].kind, 'comic');
  assert.equal(f.calls[1].parents.length, 3); assert.deepEqual(f.calls[1].parents[2].bytes, png);
  assert.equal(finished.comic.childDigest, child.artwork.digest);
  assert.equal(finished.comic.state, 'generated'); assert.deepEqual(f.service.comicArtwork(child.id), comicPng);
  assert.deepEqual(f.service.artwork(child.id), png); assert.equal(finished.state, 'generated');
  assert.equal(finished.parents[1].approvedAt, null); assert.equal(finished.comic.artwork.mode, 'fixture');
});

test('duplicate concurrent comic requests dispatch once and never replace either saved image', async () => {
  const f = fixture(), child = await f.child();
  await Promise.all([f.service.generateComic(child.id, address(a)), f.service.generateComic(child.id, address(a))]);
  await f.service.idle(); await f.service.generateComic(child.id, address(a));
  assert.equal(f.calls.length, 2); assert.deepEqual(f.service.artwork(child.id), png);
  assert.deepEqual(f.service.comicArtwork(child.id), comicPng);
});

test('visible drawing allowance counts the child and failed comic, scopes holders, and resets with enforcement', async () => {
  const f = fixture({ holderDailyLimit: 4, dailyLimit: 5 }), child = await f.child();
  assert.equal(f.service.usage(address(a)).used, 1);
  assert.equal(f.service.usage(address(a)).remaining, 3);
  assert.equal(f.service.usage(address(b)).used, 0);
  f.config.imageGenerator.generate = async () => { throw new Error('Ambiguous provider failure'); };
  await f.service.generateComic(child.id, address(a)); await f.service.idle();
  const usage = f.service.usage(address(a));
  assert.equal(usage.used, 2); assert.equal(usage.remaining, 2); assert.equal(usage.globalRemaining, 3);
  assert.equal(usage.resetsAt, Date.UTC(2026, 9, 12));
  f.advance(86400000);
  assert.equal(f.service.usage(address(a)).remaining, 4);
  assert.equal(f.service.usage(address(a)).globalRemaining, 5);
});

test('finished families can create a comic after the invitation deadline but parent transfers prevent it', async () => {
  const f = fixture(), child = await f.child(); f.advance(86400001);
  await f.service.generateComic(child.id, address(a)); await f.service.idle();
  assert.equal(f.service.get(child.id).comic.state, 'generated');
  const changed = fixture(), other = await changed.child(); changed.transfer();
  await assert.rejects(changed.service.generateComic(other.id, address(a)), status(409));
  assert.equal(changed.service.get(other.id).state, 'generated'); assert.equal(changed.calls.length, 1);
});

test('parent transfers during preparation prevent dispatch without destroying the child', async () => {
  const f = fixture(), child = await f.child(), gate = deferred();
  f.config.loadReference = async () => { await gate.promise; return { bytes: png, mime: 'image/png' }; };
  const service = createFusionService(f.config);
  await service.generateComic(child.id, address(a)); f.transfer(); gate.resolve(); await service.idle();
  assert.equal(f.calls.length, 1); assert.equal(service.get(child.id).comic.state, 'ready');
  assert.match(service.get(child.id).comic.error, /changed ownership/); assert.deepEqual(service.artwork(child.id), png);
});

test('cancellation while preparing prevents a charged call and leaves the comic retryable', async () => {
  const f = fixture(), child = await f.child(), gate = deferred();
  const service = createFusionService({ ...f.config, loadReference: async () => { await gate.promise; return { bytes: png, mime: 'image/png' }; } });
  await service.generateComic(child.id, address(a)); await service.cancelComic(child.id, address(a)); gate.resolve(); await service.idle();
  assert.equal(service.get(child.id).comic.state, 'cancelled'); assert.equal(f.calls.length, 1);
  await service.generateComic(child.id, address(a)); await service.idle(); assert.equal(f.calls.length, 2);
});

test('comic preparation detects damaged child bytes and does not consume a provider attempt', async () => {
  const f = fixture(), child = await f.child();
  f.store.complete(f.store.get(child.id), comicPng);
  await f.service.generateComic(child.id, address(a)); await f.service.idle();
  assert.equal(f.calls.length, 1); assert.equal(f.service.get(child.id).comic.state, 'ready');
  assert.match(f.service.get(child.id).comic.error, /could not be verified/);
  assert.equal(f.store.get(child.id).comic.providerStartedAt, undefined);
});

test('malformed oversized comic references cannot dispatch or consume quota during compression', async () => {
  const f = fixture(), child = await f.child(); let dispatches = 0;
  const imageGenerator = createImageGenerator({ provider: 'orbio', apiKey: 'sk-orbio-test-only', fetcher: async () => { dispatches++; throw new Error('Must not call'); } });
  const service = createFusionService({ ...f.config, imageGenerator, loadReference: async () => ({ bytes: Buffer.alloc(1600000), mime: 'image/png' }) });
  await service.generateComic(child.id, address(a)); await service.idle();
  assert.equal(dispatches, 0); assert.equal(service.get(child.id).comic.state, 'ready');
  assert.match(service.get(child.id).comic.error, /Could not resize/);
  assert.equal(f.store.get(child.id).comic.providerStartedAt, undefined);
});

test('oversized family references are compacted before dispatch, preserving the saved child and reference order', async () => {
  const f = fixture(), child = await f.child();
  const smallPng = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ff0099' } }).png().toBuffer();
  const largeChild = await sharp(randomBytes(1100 * 1100 * 3), { raw: { width: 1100, height: 1100, channels: 3 } }).png().toBuffer();
  const record = f.store.get(child.id); record.artwork.digest = digest(largeChild);
  f.store.complete(record, largeChild);
  let dispatched = 0;
  const generator = createImageGenerator({ provider: 'orbio', apiKey: 'sk-orbio-test-only', fetcher: async (_, options) => {
    dispatched++; assert.ok(Buffer.byteLength(options.body) < 4000000);
    const payload = JSON.parse(options.body); assert.equal(payload.input_references.length, 4);
    const references = payload.input_references.map(r => Buffer.from(r.image_url.url.split(',')[1], 'base64'));
    const metadata = await Promise.all(references.map(bytes => sharp(bytes).metadata()));
    assert.deepEqual(metadata.map(m => m.format), ['jpeg', 'jpeg', 'jpeg', 'jpeg']);
    assert.equal(metadata[2].width, 1024); assert.equal(metadata[2].height, 1024);
    assert.equal(metadata[0].width, 1); assert.equal(metadata[3].width, 1);
    return new Response(JSON.stringify({ data: [{ b64_json: comicPng.toString('base64') }] }));
  } });
  const direction = { label: 'Test artist', hash: record.artDirectionHash, images: [{ bytes: smallPng, mime: 'image/png' }] };
  const input = { kind: 'comic', parents: [{ bytes: smallPng, mime: 'image/png' }, { bytes: smallPng, mime: 'image/png' }, { bytes: largeChild, mime: 'image/png' }], artDirection: direction };
  assert.throws(() => generator.validateInput(input), /exceed/);
  const service = createFusionService({ ...f.config, artDirection: direction, imageGenerator: generator, loadReference: async (_, tokenId) => ({ tokenId, bytes: smallPng, mime: 'image/png' }) });
  await service.generateComic(child.id, address(a)); await service.idle();
  const finished = service.get(child.id);
  assert.equal(dispatched, 1); assert.equal(finished.comic.state, 'generated');
  assert.equal(finished.comic.childDigest, digest(largeChild));
  assert.deepEqual(service.artwork(child.id), largeChild);
  assert.deepEqual(service.comicArtwork(child.id), comicPng);
  const small = { ...input, parents: input.parents.map(p => ({ ...p, bytes: png })) };
  assert.equal(await generator.prepareInput(small), small);
});

test('comic calls share global and creator limits with fusions, including failures', async () => {
  const f = fixture({ dailyLimit: 2 }), child = await f.child();
  await f.service.generateComic(child.id, address(a)); await f.service.idle();
  const next = await f.service.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
  await assert.rejects(f.service.generate(next.id, address(a)), status(429));
  const failing = fixture({ holderDailyLimit: 2 }), saved = await failing.child();
  const broken = createFusionService({ ...failing.config, imageGenerator: { configured: true, model: 'test', async generate() { throw new Error('private-provider-error'); } } });
  await broken.generateComic(saved.id, address(a)); await broken.idle();
  assert.equal(broken.get(saved.id).comic.state, 'failed');
  assert.doesNotMatch(broken.get(saved.id).comic.error, /private-provider-error/);
  await assert.rejects(broken.generateComic(saved.id, address(a)), status(409));
  const another = await broken.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
  await assert.rejects(broken.generate(another.id, address(a)), status(429));
  assert.deepEqual(broken.artwork(saved.id), png);
});

test('comic preparation occupies the same concurrency slots as fusion generation', async () => {
  const f = fixture({ concurrency: 1 }), child = await f.child(), gate = deferred();
  const service = createFusionService({ ...f.config, loadReference: async () => { await gate.promise; return { bytes: png, mime: 'image/png' }; } });
  await service.generateComic(child.id, address(a));
  const next = await service.create(address(a), { parentA: '11', parentB: '22', requirePartnerApproval: false });
  await assert.rejects(service.generate(next.id, address(a)), status(429));
  gate.resolve(); await service.idle();
});

test('SQLite preserves both images and comic provenance through restarts, without replaying interrupted charges', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chogchemy-comic-')), 'families.sqlite');
  const store = createSqliteFusionStore(path), f = fixture({ store }), child = await f.child();
  await f.service.generateComic(child.id, address(a)); await f.service.idle(); store.close();
  const reopened = createSqliteFusionStore(path), service = createFusionService({ ...f.config, store: reopened });
  assert.deepEqual(service.artwork(child.id), png); assert.deepEqual(service.comicArtwork(child.id), comicPng);
  assert.equal(service.get(child.id).comic.childDigest, digest(png));
  const record = reopened.get(child.id); record.comic.state = 'generating'; reopened.put(record);
  const recovered = createFusionService({ ...f.config, store: reopened });
  assert.equal(recovered.get(child.id).comic.state, 'failed');
  await assert.rejects(recovered.generateComic(child.id, address(a)), status(409));
  assert.equal(f.calls.length, 2);
  record.comic.state = 'preparing'; reopened.put(record);
  assert.equal(createFusionService({ ...f.config, store: reopened }).get(child.id).comic.state, 'ready'); reopened.close();
});

test('both provider adapters send the saved child before artist references with a three-panel comic prompt', async () => {
  for (const provider of ['openai', 'orbio']) {
    const imageGenerator = createImageGenerator({ provider, apiKey: provider === 'orbio' ? 'sk-orbio-test-only' : 'test-only', fetcher: async (_, options) => {
      const body = provider === 'orbio' ? JSON.parse(options.body) : options.body;
      const prompt = provider === 'orbio' ? body.prompt : body.get('prompt');
      assert.match(prompt, /exactly THREE/); assert.match(prompt, /Image 3 is their already-created child/);
      assert.match(prompt, /The wedding/); assert.match(prompt, /The new arrival/); assert.match(prompt, /Family life/);
      assert.match(prompt, /Do not draw any lettering/);
      const images = provider === 'orbio' ? body.input_references : body.getAll('image[]');
      assert.equal(images.length, 4);
      const childBytes = provider === 'orbio' ? Buffer.from(images[2].image_url.url.split(',')[1], 'base64') : Buffer.from(await images[2].arrayBuffer());
      assert.deepEqual(childBytes, comicPng);
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    } });
    const parent = { bytes: png, mime: 'image/png', tokenId: '11' };
    await imageGenerator.generate({ kind: 'comic', parents: [parent, parent, { ...parent, bytes: comicPng }], artDirection: { label: 'Test artist', images: [parent] } });
  }
});

test('HTTP comic creation is authenticated, origin-bound, and serves public saved pages and PNGs', async () => {
  const f = fixture(), child = await f.child();
  const app = createApplication({ ...f.config, fusionStore: f.store, generationOptions: { imageGenerator: f.config.imageGenerator, loadReference: f.config.loadReference } });
  async function request(path, { method = 'GET', cookie, data, origin = f.config.origin } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]); req.url = path; req.method = method;
    req.headers = { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'test-comic' };
    const result = { headers: {} };
    await app(req, { setHeader(k, v) { result.headers[k.toLowerCase()] = v; }, writeHead(status, headers = {}) { result.status = status; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); }, end(bytes) { result.bytes = bytes; result.text = bytes?.toString(); try { result.body = JSON.parse(bytes); } catch {} } });
    return result;
  }
  const action = `/api/fusions/${child.id}/comic`;
  assert.equal((await request(action, { method: 'POST' })).status, 401);
  assert.equal((await request(action, { method: 'POST', origin: 'https://other.example' })).status, 403);
  assert.equal((await request(`/comics/${child.id}.png`)).status, 404);
  const challenge = (await request('/api/auth/challenge', { method: 'POST', data: { address: a.address } })).body;
  const login = await request('/api/auth/verify', { method: 'POST', data: { id: challenge.id, signature: await a.signMessage({ message: challenge.message }) } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await request(action, { method: 'POST', cookie })).status, 202); await app.idle();
  const image = await request(`/comics/${child.id}.png`); assert.equal(image.status, 200); assert.deepEqual(image.bytes, comicPng);
  const head = await request(`/comics/${child.id}.png`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.bytes, undefined); assert.equal(head.headers['content-length'], comicPng.length);
  const page = await request(`/characters/${child.id}`);
  assert.match(page.text, /Our Chog Family|OUR CHOG FAMILY/); assert.match(page.text, /Download comic/); assert.match(page.text, /TEST COMIC/);
  assert.match(page.text, /approvals above apply to the original child artwork/);
  assert.match(page.text, /Saved child SHA-256/); assert.match(page.text, /Record details/);
  assert.doesNotMatch(page.text, /providerRequestId|private-provider-error/);
  assert.equal((await request(`/artwork/${child.id}.png`)).status, 200);
});
