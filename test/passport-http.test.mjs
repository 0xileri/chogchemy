import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApplication } from '../src/application.mjs';
import { createMemoryFusionStore } from '../src/fusion-store.mjs';
import { collection } from '../src/chain.mjs';
import { digest } from '../src/art-direction.mjs';
import { currentCommunityPrompt } from '../src/community-prompts.mjs';

// All requests run against the handler in memory. These ephemeral test accounts
// do not connect to a wallet, network, provider, or production service.
const owner = privateKeyToAccount(generatePrivateKey()), stranger = privateKeyToAccount(generatePrivateKey());
const origin = 'http://localhost:3000', start = Date.UTC(2026, 9, 14, 12);
const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#b5dc66' } }).png().toBuffer();
const nftReference = { bytes: png, mime: 'image/png', digest: digest(png), name: 'Test Chog #1786', traits: [] };
function record(id = '1', changes = {}) {
  return { id: id.repeat(64), kind: 'meme', origin, collection: collection.address, chainId: collection.chainId, createdBy: owner.address.toLowerCase(),
    state: 'generated', createdAt: start - 1000, expires: start + 86400000, checkedAt: start - 1000, checkedBlock: '100',
    parents: [{ tokenId: '1786', owner: owner.address.toLowerCase() }], templateId: '181913649', topCaption: '', bottomCaption: '',
    artwork: { createdAt: start, digest: digest(png), mode: 'ai', model: 'test-only' }, scene: { digest: digest(png), createdAt: start },
    generation: { providerStartedAt: start - 1000 }, artDirection: 'Test style', artDirectionHash: 'test-style', ...changes };
}
function fixture(records = [record()], { ownersFail = false, previewFail = false, liveGate = null } = {}) {
  const store = createMemoryFusionStore(); for (const item of records) store.complete(item, png, png);
  let clock = start, currentOwner = owner.address, ownerReads = 0, previewReads = 0, providerCalls = 0;
  const chain = {
    async owners(ids) { ownerReads++; if (liveGate) await liveGate; if (ownersFail) throw new Error('private RPC detail'); return { owners: ids.map(() => currentOwner), blockNumber: 101n }; },
    async balance() { return 1n; }, async ownedTokenIds() { return ['1786']; },
    async token() { return { owner: currentOwner, tokenURI: null }; },
  };
  const app = createApplication({ origin, chain, fusionStore: store, now: () => clock,
    generationOptions: { artDirection: { hash: 'test-style', label: 'Test style', images: [], rules: [] }, imageGenerator: { configured: true, mode: 'fixture', model: 'test-only', async generate() { providerCalls++; throw new Error('Generation must not run in read/export tests.'); } } },
    previewOptions: { loadReference: async () => { previewReads++; if (liveGate) await liveGate; if (previewFail) throw new Error('private metadata detail'); return nftReference; } },
  });
  async function request(path, { method = 'GET', data, cookie, requestOrigin = null, headers = {}, socket = 'passport-http-test' } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.url = path; req.method = method; req.headers = { ...(requestOrigin ? { origin: requestOrigin } : {}), ...(cookie ? { cookie } : {}), ...headers }; req.socket = { remoteAddress: socket };
    const response = { status: 0, headers: {}, body: null, bytes: undefined };
    await app(req, {
      setHeader(key, value) { response.headers[key.toLowerCase()] = value; },
      writeHead(status, values = {}) { response.status = status; for (const [key, value] of Object.entries(values)) this.setHeader(key, value); },
      end(value) { response.bytes = value; if (value !== undefined) { try { response.body = JSON.parse(value); } catch { response.body = Buffer.isBuffer(value) ? value.toString() : value; } } },
    });
    return response;
  }
  async function login(account = owner) {
    const challenge = await request('/api/auth/challenge', { method: 'POST', requestOrigin: origin, data: { address: account.address } });
    assert.equal(challenge.status, 200);
    const verified = await request('/api/auth/verify', { method: 'POST', requestOrigin: origin, data: { id: challenge.body.id, signature: await account.signMessage({ message: challenge.body.message }) } });
    assert.equal(verified.status, 200); return verified.headers['set-cookie'].split(';')[0];
  }
  return { store, app, request, login, calls: () => ({ ownerReads, previewReads, providerCalls }), transfer() { currentOwner = stranger.address; clock += 30001; } };
}

test('public passport pages, API and original NFT preview need no holder session; HEAD never sends artwork bytes', async () => {
  const f = fixture();
  const api = await f.request('/api/chogs/1786/passport');
  assert.equal(api.status, 200); assert.equal(api.body.ownership.owner, owner.address.toLowerCase());
  assert.equal(api.body.preview.imageUrl, '/passport-image/1786?v=' + digest(png));
  assert.equal(api.body.entries[0].creator, owner.address.toLowerCase());
  const page = await f.request('/chogs/1786'); assert.equal(page.status, 200); assert.match(page.body, /Chog #1786/);
  assert.match(page.body, /Continue this Chog/); assert.match(page.body, /\/passport-image\/1786\?v=/);
  assert.equal(page.headers['cache-control'], 'no-store');
  const head = await f.request('/chogs/1786', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.bytes, undefined); assert.equal(head.headers['content-length'], page.bytes.length);
  const image = await f.request(api.body.preview.imageUrl); assert.equal(image.status, 200); assert.deepEqual(image.bytes, png);
  assert.equal(image.headers['content-type'], 'image/png');
  const imageHead = await f.request(api.body.preview.imageUrl, { method: 'HEAD' });
  assert.equal(imageHead.status, 200); assert.equal(imageHead.bytes, undefined); assert.equal(imageHead.headers['content-length'], png.length);
  assert.equal((await f.request('/api/chog-preview?id=1786')).status, 401);
  assert.deepEqual(f.calls(), { ownerReads: 1, previewReads: 1, providerCalls: 0 });
});

test('public passport excludes fixtures, foreign collections/origins/chains and unsuccessful records', async () => {
  const prompt = currentCommunityPrompt(start);
  const records = [record('1', { challengeId: prompt.id }), record('2', { artwork: { ...record().artwork, mode: 'fixture' }, challengeId: prompt.id }),
    record('3', { origin: 'https://foreign.test', challengeId: prompt.id }), record('4', { collection: '0x' + '0'.repeat(40), challengeId: prompt.id }),
    record('5', { chainId: 1, challengeId: prompt.id }), record('6', { state: 'generation_failed', challengeId: prompt.id }),
    record('7', { artwork: { ...record().artwork, mode: undefined }, challengeId: prompt.id })];
  const f = fixture(records), passport = await f.request('/api/chogs/1786/passport'), community = await f.request('/api/community-prompt');
  assert.equal(passport.body.counts.total, 1); assert.deepEqual(passport.body.entries.map(item => item.id), ['1'.repeat(64)]);
  assert.equal(community.body.total, 1); assert.deepEqual(community.body.entries.map(item => item.id), ['1'.repeat(64)]);
  assert.doesNotMatch(JSON.stringify(passport.body), /"scene"|"nonce"|providerRequestId|artDirectionSnapshot/);
});

test('public weekly prompt GET and HEAD show only explicit completed entries, with a truthful zero state', async () => {
  const f = fixture([record()]);
  const page = await f.request('/community'); assert.equal(page.status, 200); assert.match(page.body, /No entries yet/);
  const head = await f.request('/community', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.bytes, undefined);
  assert.equal(head.headers['content-length'], page.bytes.length);
  const api = await f.request('/api/community-prompt'); assert.equal(api.status, 200); assert.equal(api.body.total, 0);
  assert.equal(api.body.prompt.id, currentCommunityPrompt(start).id);
  assert.deepEqual(f.calls(), { ownerReads: 0, previewReads: 0, providerCalls: 0 });
});

test('transfer changes the public current owner while saved creator credit and original records stay intact', async () => {
  const original = record(), f = fixture([original]);
  await f.request('/api/chogs/1786/passport'); f.transfer();
  const result = await f.request('/api/chogs/1786/passport');
  assert.equal(result.body.ownership.owner, stranger.address.toLowerCase());
  assert.equal(result.body.entries[0].creator, owner.address.toLowerCase());
  assert.deepEqual(f.store.get(original.id), original);
});

test('ownership and metadata failures preserve saved public history without leaking provider errors', async () => {
  const f = fixture([record()], { ownersFail: true, previewFail: true });
  const result = await f.request('/api/chogs/1786/passport'); assert.equal(result.status, 200);
  assert.equal(result.body.ownership.status, 'unavailable'); assert.equal(result.body.ownership.owner, null);
  assert.equal(result.body.preview, null); assert.equal(result.body.counts.total, 1);
  const page = await f.request('/chogs/1786'); assert.equal(page.status, 200);
  assert.match(page.body, /Current ownership is temporarily unavailable/); assert.match(page.body, /Drake Hotline Bling/);
  assert.doesNotMatch(page.body, /private RPC detail|private metadata detail|Current owner checked on Monad/);
});

test('bad public token and image versions fail before an RPC or metadata read', async () => {
  const f = fixture();
  for (const path of ['/chogs/01786', '/api/chogs/01786/passport', '/chogs/' + String(2n ** 256n), '/passport-image/1786?v=bad', '/passport-image/01786?v=' + 'd'.repeat(64)]) assert.equal((await f.request(path)).status, 400);
  assert.deepEqual(f.calls(), { ownerReads: 0, previewReads: 0, providerCalls: 0 });
  assert.equal((await f.request('/passport.css')).status, 200);
});

test('free caption exports remain origin-bound, session-protected and limited to the original creator', async () => {
  const original = record(), f = fixture([original]), path = `/api/memes/${original.id}/recaption`;
  const data = { captions: [{ boxId: 'reject', text: 'The alarm at 6 AM' }, { boxId: 'approve', text: 'Five more minutes' }] };
  assert.equal((await f.request(path, { method: 'POST', requestOrigin: origin, data })).status, 401);
  for (const requestOrigin of [null, 'https://foreign.test']) assert.equal((await f.request(path, { method: 'POST', requestOrigin, data })).status, 403);
  const otherCookie = await f.login(stranger);
  assert.equal((await f.request(path, { method: 'POST', requestOrigin: origin, data, cookie: otherCookie })).status, 403);
  const cookie = await f.login();
  const before = await f.request('/api/drawing-usage', { cookie });
  const result = await f.request(path, { method: 'POST', requestOrigin: origin, data, cookie });
  assert.equal(result.status, 200); assert.equal(result.headers['content-type'], 'image/png');
  assert.ok(Buffer.isBuffer(result.bytes)); assert.equal(result.headers['content-length'], result.bytes.length);
  assert.equal(result.headers['x-chogchemy-caption-source'], 'saved_scene');
  const metadata = await sharp(result.bytes).metadata(); assert.equal(metadata.width, 1024);
  assert.deepEqual(f.store.get(original.id), original); assert.deepEqual(f.store.artwork(original.id), png);
  assert.deepEqual((await f.request('/api/drawing-usage', { cookie })).body, before.body);
  assert.equal(f.calls().providerCalls, 0);
});

test('anonymous public prompt throttling cannot be bypassed with forged forwarded headers', async () => {
  const f = fixture([]);
  for (let n = 0; n < 90; n++) assert.equal((await f.request('/api/community-prompt', { headers: { 'x-forwarded-for': `forged-${n}` } })).status, 200);
  assert.equal((await f.request('/api/community-prompt', { headers: { 'x-forwarded-for': 'another-forged-client' } })).status, 429);
  assert.deepEqual(f.calls(), { ownerReads: 0, previewReads: 0, providerCalls: 0 });
});

test('slow NFT reads never block the public page and the real API deadline returns saved history while lookups continue', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }), f = fixture([record()], { liveGate: gate });
  let ssrTimer, apiTimer;
  try {
    const page = await Promise.race([f.request('/chogs/1786'), new Promise((_, reject) => { ssrTimer = setTimeout(() => reject(new Error('The public page waited for live NFT reads.')), 150); })]);
    assert.equal(page.status, 200); assert.match(page.body, /Drake Hotline Bling/); assert.match(page.body, /Your saved history below is ready/);
    const response = await Promise.race([f.request('/api/chogs/1786/passport'), new Promise((_, reject) => { apiTimer = setTimeout(() => reject(new Error('The public API exceeded its lookup deadline.')), 6500); })]);
    assert.equal(response.status, 200); assert.equal(response.body.counts.memes, 1); assert.equal(response.body.ownership.status, 'unavailable');
    assert.deepEqual(response.body.livePending, { ownership: true, preview: true });
    assert.deepEqual(f.calls(), { ownerReads: 1, previewReads: 1, providerCalls: 0 });
    release(); const loaded = await f.request('/api/chogs/1786/passport');
    assert.equal(loaded.body.ownership.owner, owner.address.toLowerCase()); assert.ok(loaded.body.preview.imageUrl.startsWith('/passport-image/1786?v='));
    assert.deepEqual(loaded.body.entries, response.body.entries);
  } finally { clearTimeout(ssrTimer); clearTimeout(apiTimer); release(); }
});
