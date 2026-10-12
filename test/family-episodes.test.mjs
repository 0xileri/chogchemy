import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createFusionService } from '../src/fusions.mjs';
import { createMemoryFusionStore, createSqliteFusionStore } from '../src/fusion-store.mjs';
import { createApplication } from '../src/application.mjs';
import { collection } from '../src/chain.mjs';
import { loadArtDirection, digest } from '../src/art-direction.mjs';
import { familyComicPrompt, createImageGenerator } from '../src/image-generator.mjs';
import { episodeStories } from '../src/family-episodes.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=', 'base64');
const firstComic = Buffer.concat([png, Buffer.from('first-comic')]);
const episodePng = Buffer.concat([png, Buffer.from('later-episode')]);
const creatorAccount = privateKeyToAccount(generatePrivateKey()); // Disposable test identity, never a real holder.
const a = creatorAccount.address.toLowerCase(), b = '0x' + '2'.repeat(40), stranger = '0x' + '3'.repeat(40), id = 'a'.repeat(64);
const fail = n => e => e.status === n;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function fixture(options = {}) {
  let time = Date.UTC(2026, 9, 12, 12), owners = [a, b];
  const store = options.store || createMemoryFusionStore(), calls = [];
  const direction = loadArtDirection();
  store.complete({ id, origin: 'http://localhost:3000', state: 'generated', chainId: collection.chainId, collection: collection.address, createdBy: a, createdAt: time - 1000, expires: time - 1, checkedAt: time, checkedBlock: '123', artDirection: direction.label, artDirectionHash: direction.hash, approvalPolicy: 'creator', creatorVerifiedAt: time, parents: [{ tokenId: '11', owner: a }, { tokenId: '22', owner: b }], artwork: { digest: digest(png), createdAt: time, mode: 'fixture' }, comic: { state: 'generated', title: 'Our Chog Family', requestedAt: time, checkedAt: time, checkedBlock: '123', styleLabel: direction.label, styleHash: direction.hash, childDigest: digest(png), artwork: { digest: digest(firstComic), createdAt: time, mode: 'fixture' } } }, png);
  store.completeComic(store.get(id), firstComic);
  const config = { store, origin: 'http://localhost:3000', now: () => time, holderDailyLimit: 4, dailyLimit: 10,
    chain: { async owners() { return { owners, blockNumber: 123n }; } },
    loadReference: async (_, tokenId) => ({ tokenId, bytes: png, mime: 'image/png', name: 'Synthetic parent', traits: [] }),
    imageGenerator: { configured: true, mode: 'fixture', model: 'synthetic', async generate(input) { calls.push(input); return { bytes: episodePng, model: 'synthetic', mode: 'fixture' }; } }, ...options };
  const service = createFusionService(config);
  return { store, service, config, calls, advance: ms => { time += ms; }, transfer: () => { owners = [a, stranger]; } };
}

test('episodes require a saved first comic and its creator, and accept only the three curated stories', async () => {
  const f = fixture();
  for (const person of [b, stranger]) await assert.rejects(f.service.generateEpisode(id, person, { story: 'adventure' }), fail(403));
  for (const story of [undefined, 'freeform', '<script>', 123]) await assert.rejects(f.service.generateEpisode(id, a, { story }), fail(400));
  const record = f.store.get(id); record.comic = null; f.store.put(record);
  await assert.rejects(f.service.generateEpisode(id, a, { story: 'adventure' }), fail(409));
  assert.equal(f.calls.length, 0);
});

test('one saved episode per story is idempotent, preserves original images and carries the same child reference', async () => {
  const f = fixture();
  await Promise.all([f.service.generateEpisode(id, a, { story: 'birthday' }), f.service.generateEpisode(id, a, { story: 'birthday' })]); await f.service.idle();
  await f.service.generateEpisode(id, a, { story: 'birthday' }); await f.service.idle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].story.id, 'birthday');
  assert.deepEqual(f.calls[0].parents[2].bytes, png);
  assert.deepEqual(f.service.artwork(id), png); assert.deepEqual(f.service.comicArtwork(id), firstComic);
  const view = f.service.get(id), item = view.episodes[0];
  assert.equal(item.number, 2); assert.equal(item.state, 'generated'); assert.equal(item.childDigest, digest(png));
  assert.deepEqual(f.service.episodeArtwork(id, item.id), episodePng); assert.equal(view.canGenerateEpisode, false);
  assert.equal(f.service.get(id, a).canGenerateEpisode, true);
  assert.doesNotMatch(JSON.stringify(view), /requestedBy|preparationId|providerRequestId/);
});

test('episodes share quotas and concurrency with earlier drawings and do not consume the other holder allowance', async () => {
  const f = fixture({ holderDailyLimit: 2 });
  await f.service.generateEpisode(id, a, { story: 'school' }); await f.service.idle();
  await f.service.generateEpisode(id, a, { story: 'birthday' }); await f.service.idle();
  assert.equal(f.service.usage(a).used, 2); assert.equal(f.service.usage(b).used, 0);
  await assert.rejects(f.service.generateEpisode(id, a, { story: 'adventure' }), fail(429));
  f.advance(86400000); await f.service.generateEpisode(id, a, { story: 'adventure' }); await f.service.idle();
  assert.equal(f.service.get(id).episodes.length, 3); assert.equal(f.calls.length, 3);
  const busy = fixture({ concurrency: 1 }), gate = deferred();
  busy.config.loadReference = async () => { await gate.promise; return { bytes: png, mime: 'image/png' }; };
  const service = createFusionService(busy.config);
  await service.generateEpisode(id, a, { story: 'school' });
  await assert.rejects(service.generateEpisode(id, a, { story: 'birthday' }), fail(409));
  assert.equal((await service.generateComic(id, a)).comic.state, 'generated');
  const otherId = 'd'.repeat(64), other = { ...busy.store.get(id), id: otherId, episodes: [] };
  busy.store.complete(other, png); busy.store.completeComic(other, firstComic);
  await assert.rejects(service.generateEpisode(otherId, a, { story: 'school' }), fail(429));
  gate.resolve(); await service.idle(); assert.equal(busy.calls.length, 1);
});

test('prior child and comic attempts and new episodes all count toward the same global limit', async () => {
  const f = fixture({ dailyLimit: 3 });
  const record = f.store.get(id);
  record.generation = { providerStartedAt: f.config.now() - 1000 };
  record.comic.providerStartedAt = f.config.now() - 900; f.store.put(record);
  await f.service.generateEpisode(id, a, { story: 'adventure' }); await f.service.idle();
  assert.equal(f.service.usage(a).used, 3); assert.equal(f.service.usage(a).globalRemaining, 0);
  await assert.rejects(f.service.generateEpisode(id, a, { story: 'school' }), fail(429));
});

test('an old cancelled preparation cannot change a replacement attempt for the same story', async () => {
  const f = fixture(), old = deferred(), next = deferred(); let loads = 0;
  const service = createFusionService({ ...f.config, loadReference: async () => {
    const value = await (loads++ < 2 ? old.promise : next.promise);
    if (value === 'fail') throw new Error('Old preparation failed');
    return { bytes: png, mime: 'image/png' };
  } });
  await service.generateEpisode(id, a, { story: 'school' });
  const episodeId = service.get(id).episodes[0].id;
  await service.cancelEpisode(id, a, { episodeId });
  await service.generateEpisode(id, a, { story: 'school' });
  old.resolve('fail'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.get(id).episodes[0].state, 'preparing');
  next.resolve(); await service.idle();
  assert.equal(f.calls.length, 1); assert.equal(service.get(id).episodes[0].state, 'generated');
});

test('transfers, damaged child bytes and cancelled preparation never dispatch an episode', async () => {
  const changed = fixture(); changed.transfer();
  await assert.rejects(changed.service.generateEpisode(id, a, { story: 'school' }), fail(409));
  const f = fixture(), gate = deferred();
  const service = createFusionService({ ...f.config, loadReference: async () => { await gate.promise; return { bytes: png, mime: 'image/png' }; } });
  await service.generateEpisode(id, a, { story: 'adventure' }); f.transfer(); gate.resolve(); await service.idle();
  assert.equal(f.calls.length, 0); assert.match(service.get(id).episodes[0].error, /changed ownership/);
  const broken = fixture(); broken.store.complete(broken.store.get(id), firstComic);
  await broken.service.generateEpisode(id, a, { story: 'birthday' }); await broken.service.idle();
  assert.equal(broken.calls.length, 0); assert.match(broken.service.get(id).episodes[0].error, /could not be verified/);
  const cancelled = fixture(), preparation = deferred();
  const cancellation = createFusionService({ ...cancelled.config, loadReference: async () => { await preparation.promise; return { bytes: png, mime: 'image/png' }; } });
  await cancellation.generateEpisode(id, a, { story: 'school' }); const item = cancellation.get(id).episodes[0];
  await assert.rejects(cancellation.cancelEpisode(id, b, { episodeId: item.id }), fail(403));
  await cancellation.cancelEpisode(id, a, { episodeId: item.id }); preparation.resolve(); await cancellation.idle();
  assert.equal(cancelled.calls.length, 0); assert.equal(cancellation.get(id).episodes[0].state, 'cancelled');
});

test('a failed dispatched episode counts toward quota and cannot be repeated while other stories remain available', async () => {
  const f = fixture(); f.config.imageGenerator.generate = async () => { throw new Error('secret-provider-failure'); };
  await f.service.generateEpisode(id, a, { story: 'school' }); await f.service.idle();
  assert.equal(f.service.get(id).episodes[0].state, 'failed'); assert.equal(f.service.usage(a).used, 1);
  assert.doesNotMatch(JSON.stringify(f.service.get(id)), /secret-provider/);
  await assert.rejects(f.service.generateEpisode(id, a, { story: 'school' }), fail(409));
  f.config.imageGenerator.generate = async input => { f.calls.push(input); return { bytes: episodePng, mode: 'fixture' }; };
  await f.service.generateEpisode(id, a, { story: 'birthday' }); await f.service.idle();
  assert.equal(f.service.get(id).episodes[1].state, 'generated');
});

test('SQLite migration preserves earlier comics and episode images, and restart never replays dispatched calls', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chog-episodes-')), 'test.sqlite');
  const f = fixture({ store: createSqliteFusionStore(path) });
  await f.service.generateEpisode(id, a, { story: 'adventure' }); await f.service.idle();
  const record = f.store.get(id), episodeId = record.episodes[0].id;
  record.episodes.push({ id: 'b'.repeat(64), state: 'preparing', storyId: 'school' }, { id: 'c'.repeat(64), state: 'generating', storyId: 'birthday', providerStartedAt: f.config.now() }); f.store.put(record); f.store.close();
  const store = createSqliteFusionStore(path), service = createFusionService({ ...f.config, store });
  assert.deepEqual(service.artwork(id), png); assert.deepEqual(service.comicArtwork(id), firstComic); assert.deepEqual(service.episodeArtwork(id, episodeId), episodePng);
  assert.deepEqual(service.get(id).episodes.map(e => e.state), ['generated', 'ready', 'failed']); assert.equal(service.usage(a).used, 2);
  await service.idle(); assert.equal(f.calls.length, 1); store.close();
});

test('both image providers receive the selected episode scenes without repeating the wedding recipe', async () => {
  for (const story of episodeStories) {
    const prompt = familyComicPrompt([], { label: 'Artist style' }, story);
    for (const scene of story.scenes) assert.ok(prompt.includes(scene));
    assert.doesNotMatch(prompt, /The wedding|new arrival/); assert.match(prompt, /saved child design/);
  }
  for (const provider of ['openai', 'orbio']) {
    let calls = 0;
    const generator = createImageGenerator({ provider, apiKey: provider === 'orbio' ? 'sk-orbio-test-only' : 'test-only', fetcher: async (_, options) => {
      calls++; const prompt = provider === 'orbio' ? JSON.parse(options.body).prompt : options.body.get('prompt');
      assert.match(prompt, /birthday cake/); assert.doesNotMatch(prompt, /The wedding/);
      return new Response(JSON.stringify({ data: [{ b64_json: episodePng.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
    } });
    await generator.generate({ kind: 'comic', story: episodeStories[2], artDirection: { label: 'Artist style', images: [] }, parents: [1, 2, 3].map(tokenId => ({ tokenId: String(tokenId), bytes: png, mime: 'image/png' })) });
    assert.equal(calls, 1);
  }
});

test('HTTP episode actions need a signed creator session and saved episodes are public with escaped records', async () => {
  const f = fixture();
  const app = createApplication({ origin: f.config.origin, now: f.config.now, chain: f.config.chain, fusionStore: f.store, generationOptions: { imageGenerator: f.config.imageGenerator, loadReference: f.config.loadReference, holderDailyLimit: 4 } });
  async function request(path, { method = 'GET', data, cookie, origin = f.config.origin } = {}) {
    const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []);
    req.url = path; req.method = method; req.headers = { origin, ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'test' };
    const result = { headers: {} };
    await app(req, { setHeader(key, value) { result.headers[key.toLowerCase()] = value; }, writeHead(code, headers = {}) { result.status = code; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); }, end(bytes) { result.bytes = bytes; try { result.body = JSON.parse(bytes); } catch { result.body = bytes?.toString(); } } });
    return result;
  }
  assert.equal((await request(`/api/fusions/${id}/episode`, { method: 'POST', data: { story: 'school' } })).status, 401);
  const challenge = await request('/api/auth/challenge', { method: 'POST', data: { address: a } });
  const signature = await creatorAccount.signMessage({ message: challenge.body.message });
  const signed = await request('/api/auth/verify', { method: 'POST', data: { id: challenge.body.id, signature } });
  const cookie = signed.headers['set-cookie'].split(';')[0];
  assert.equal((await request(`/api/fusions/${id}/episode`, { method: 'POST', cookie, origin: 'https://other.example', data: { story: 'school' } })).status, 403);
  assert.equal((await request(`/api/fusions/${id}/episode`, { method: 'POST', cookie, data: { story: 'school' } })).status, 202);
  await app.idle();
  const view = (await request(`/api/fusions/${id}`)).body, episode = view.episodes[0];
  const artwork = await request(episode.artwork.url); assert.equal(artwork.status, 200); assert.deepEqual(artwork.bytes, episodePng);
  const head = await request(episode.artwork.url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.bytes, undefined);
  const page = await request(`/characters/${id}`); assert.match(page.body, /Episode 2 · The first school day/); assert.match(page.body, new RegExp(`episode-${episode.id}`)); assert.match(page.body, /TEST EPISODE/);
  assert.equal((await request(`/episodes/${'b'.repeat(64)}/${episode.id}.png`)).status, 404);
  const record = f.store.get(id); record.episodes[0].title = '<script>bad()</script>'; record.episodes[0].chapters = ['<img onerror=bad()>']; f.store.put(record);
  const escaped = await request(`/characters/${id}`); assert.doesNotMatch(escaped.body, /<script>bad|<img onerror/); assert.match(escaped.body, /&lt;script&gt;/);
});
