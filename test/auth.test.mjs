import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApplication, validTokenId } from '../src/application.mjs';

// Ephemeral test accounts only. Nothing is broadcast or connected to a real wallet.
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
function fixture(overrides = {}) {
  let time = Date.now(), currentOwner = owner.address, calls = 0;
  const chain = {
    async balance(address) { assert.equal(address, owner.address.toLowerCase()); return 1n; },
    async ownedTokenIds() { return null; },
    async token() { calls++; return { owner: currentOwner, tokenURI: 'ipfs://example/1557.json' }; },
    ...overrides,
  };
  const app = createApplication({ chain, origin: 'http://localhost:3000', now: () => time });
  async function request(path, { method = 'GET', data, cookie, origin = 'http://localhost:3000', raw, range } = {}) {
    const req = Readable.from(raw !== undefined ? [Buffer.from(raw)] : data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.url = path; req.method = method; req.headers = { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(range ? { range } : {}) }; req.socket = { remoteAddress: 'test' };
    const result = { headers: {}, status: 0, body: null };
    const res = {
      setHeader(key, value) { result.headers[key.toLowerCase()] = value; },
      writeHead(status, headers = {}) { result.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
      end(value) { result.bytes = value; try { result.body = JSON.parse(value); } catch { result.body = value?.toString(); } },
    };
    await app(req, res); return result;
  }
  async function login() {
    const challenge = await request('/api/auth/challenge', { method: 'POST', data: { address: owner.address } });
    assert.equal(challenge.status, 200);
    const signature = await owner.signMessage({ message: challenge.body.message });
    const verified = await request('/api/auth/verify', { method: 'POST', data: { id: challenge.body.id, signature } });
    assert.equal(verified.status, 200);
    return { cookie: verified.headers['set-cookie'].split(';')[0], challenge: challenge.body, signature, verified };
  }
  return { request, login, advance: ms => { time += ms; }, transfer: () => { currentOwner = stranger.address; }, calls: () => calls };
}

test('a signed challenge creates an HttpOnly session and allows holder lookup', async () => {
  const f = fixture(), { cookie, verified } = await f.login();
  assert.match(verified.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
  const list = await f.request('/api/chogs', { cookie });
  assert.equal(list.status, 200); assert.equal(list.body.balance, '1'); assert.equal(list.body.tokenIds, null);
  const token = await f.request('/api/chog?id=1557', { cookie });
  assert.equal(token.status, 200); assert.equal(token.body.tokenId, '1557');
  assert.equal(token.body.owner, owner.address);
});
test('wallet address alone cannot access holder APIs', async () => {
  const f = fixture();
  assert.equal((await f.request(`/api/chogs?address=${owner.address}`)).status, 401);
  assert.equal((await f.request('/api/chog?id=1557')).status, 401);
  assert.equal(f.calls(), 0);
});

test('verified wallets behind one proxy have independent request limits', async () => {
  const f = fixture(), first = await f.login();
  const challenge = await f.request('/api/auth/challenge', { method: 'POST', data: { address: stranger.address } });
  const verified = await f.request('/api/auth/verify', { method: 'POST', data: {
    id: challenge.body.id, signature: await stranger.signMessage({ message: challenge.body.message }),
  } });
  assert.equal(verified.status, 200);
  const secondCookie = verified.headers['set-cookie'].split(';')[0];
  for (let i = 0; i < 90; i++) assert.equal((await f.request('/api/session', { cookie: first.cookie })).status, 200);
  assert.equal((await f.request('/api/session', { cookie: first.cookie })).status, 429);
  assert.equal((await f.request('/api/session', { cookie: secondCookie })).status, 200);
  assert.equal((await f.request('/api/config')).status, 200);
  f.advance(60001);
  assert.equal((await f.request('/api/session', { cookie: first.cookie })).status, 200);
});

test('drawing allowance is private to the signed-in wallet and resets at the next UTC day', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/drawing-usage')).status, 401);
  const { cookie } = await f.login();
  const response = await f.request(`/api/drawing-usage?address=${stranger.address}`, { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(response.body).sort(), ['globalRemaining', 'limit', 'remaining', 'resetsAt', 'used']);
  assert.equal(response.body.used, 0); assert.equal(response.body.remaining, response.body.limit);
  assert.equal(response.body.resetsAt % 86400000, 0);
});

test('automatic discovery returns only the signed-in wallet inventory and keeps manual lookup if discovery fails', async () => {
  const f = fixture({ async ownedTokenIds(address, balance) { assert.equal(address, owner.address.toLowerCase()); assert.equal(balance, 1n); return ['1557']; } });
  const { cookie } = await f.login();
  assert.deepEqual((await f.request(`/api/chogs?address=${stranger.address}`, { cookie })).body.tokenIds, ['1557']);
  const unavailable = fixture({ async ownedTokenIds() { throw new Error('index unavailable'); } });
  const session = await unavailable.login();
  const result = await unavailable.request('/api/chogs', { cookie: session.cookie });
  assert.equal(result.status, 200); assert.equal(result.body.balance, '1'); assert.equal(result.body.tokenIds, null);
});
test('a stranger cannot sign the owner challenge', async () => {
  const f = fixture();
  const challenge = await f.request('/api/auth/challenge', { method: 'POST', data: { address: owner.address } });
  const signature = await stranger.signMessage({ message: challenge.body.message });
  const result = await f.request('/api/auth/verify', { method: 'POST', data: { id: challenge.body.id, signature } });
  assert.equal(result.status, 401); assert.equal(result.headers['set-cookie'], undefined);
});
test('a signature cannot be replayed', async () => {
  const f = fixture(), { challenge, signature } = await f.login();
  assert.equal((await f.request('/api/auth/verify', { method: 'POST', data: { id: challenge.id, signature } })).status, 401);
});
test('expired challenges cannot create sessions', async () => {
  const f = fixture();
  const challenge = await f.request('/api/auth/challenge', { method: 'POST', data: { address: owner.address } });
  const signature = await owner.signMessage({ message: challenge.body.message });
  f.advance(300001);
  assert.equal((await f.request('/api/auth/verify', { method: 'POST', data: { id: challenge.body.id, signature } })).status, 401);
});
test('ownership is checked again after a token transfer', async () => {
  const f = fixture(), { cookie } = await f.login();
  assert.equal((await f.request('/api/chog?id=1557', { cookie })).status, 200);
  f.transfer();
  assert.equal((await f.request('/api/chog?id=1557', { cookie })).status, 403);
  assert.equal(f.calls(), 2);
});
test('logout and session expiry both remove access', async () => {
  const f = fixture(), { cookie } = await f.login();
  assert.equal((await f.request('/api/logout', { method: 'POST', data: {}, cookie })).status, 200);
  assert.equal((await f.request('/api/chogs', { cookie })).status, 401);
  const next = await f.login(); f.advance(1800001);
  assert.equal((await f.request('/api/chogs', { cookie: next.cookie })).status, 401);
});
test('cross-origin and origin-less POST requests are rejected', async () => {
  const f = fixture();
  for (const origin of ['https://untrusted.example', null]) assert.equal((await f.request('/api/auth/challenge', { method: 'POST', data: { address: owner.address }, origin })).status, 403);
});
test('malformed input returns a controlled error', async () => {
  const f = fixture();
  for (const data of [{}, null, { address: 123 }, { address: 'bad' }]) assert.equal((await f.request('/api/auth/challenge', { method: 'POST', data })).status, 400);
  for (const raw of ['{', 'x'.repeat(4097)]) assert.equal((await f.request('/api/auth/challenge', { method: 'POST', raw })).status, 400);
  const { cookie } = await f.login();
  for (const id of ['-1', '1.5', '01', 'bad', String(2n ** 256n)]) assert.equal((await f.request(`/api/chog?id=${id}`, { cookie })).status, 400);
  assert.equal(f.calls(), 0);
  assert.equal(validTokenId(String(2n ** 256n - 1n)), true);
});
test('RPC failures return an actionable error without exposing provider secrets', async () => {
  const f = fixture({ async balance() { throw new Error('provider-secret'); } });
  const { cookie } = await f.login();
  const response = await f.request('/api/chogs', { cookie });
  assert.equal(response.status, 502); assert.doesNotMatch(response.body.error, /provider-secret/);
});
test('static routes serve the app and reject unexpected paths', async () => {
  const f = fixture();
  for (const path of ['/', '/demo', '/demo/', '/app.js', '/wallet.js', '/style.css']) assert.equal((await f.request(path)).status, 200);
  for (const path of ['/toString', '/missing', '/.env', '/package.json']) assert.equal((await f.request(path)).status, 404);
});

test('the public demo has its own canonical page and needs no holder session or chain lookup', async () => {
  const f = fixture();
  const demo = await f.request('/demo');
  assert.equal(demo.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(demo.body, /href="http:\/\/localhost:3000\/demo"/);
  assert.doesNotMatch(demo.body, /__APP_ORIGIN__/);
  const head = await f.request('/demo', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.bytes, undefined);
  assert.equal(head.headers['content-length'], demo.bytes.length);
  assert.equal(f.calls(), 0);
});

test('branding images use binary MIME types and HEAD metadata while source files stay private', async () => {
  const f = fixture();
  const page = await f.request('/');
  assert.doesNotMatch(page.body, /__APP_ORIGIN__/);
  assert.match(page.body, /content="http:\/\/localhost:3000\/brand\/chogchemy-banner-v2.png"/);
  for (const name of ['logo', 'icon', 'banner']) {
    const path = `/brand/chogchemy-${name}-v1.png`, image = await f.request(path);
    assert.equal(image.status, 200); assert.equal(image.headers['content-type'], 'image/png');
    assert.deepEqual(image.bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.headers['content-length'], image.bytes.length);
    const head = await f.request(path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.bytes, undefined);
    assert.equal(head.headers['content-length'], image.bytes.length);
  }
  for (const path of ['/brand/BRAND-GUIDE.md', '/brand/PROMPTS.md', '/assets/brand/chogchemy-logo-v1.png', '/brand/../.env']) assert.equal((await f.request(path)).status, 404);
  assert.equal(f.calls(), 0);
});
test('challenge requests are rate limited', async () => {
  const f = fixture();
  for (let i = 0; i < 90; i++) assert.equal((await f.request('/api/config')).status, 200);
  assert.equal((await f.request('/api/auth/challenge', { method: 'POST', data: { address: owner.address } })).status, 429);
  f.advance(60001); assert.equal((await f.request('/api/config')).status, 200);
});

test('the public walkthrough serves MP4 bytes and supports seeking without wallet or RPC access', async () => {
  const f = fixture();
  const page = await f.request('/watch');
  assert.equal(page.status, 200); assert.match(page.body, /src="\/demo-video.mp4"/); assert.doesNotMatch(page.body, /__APP_ORIGIN__/);
  const full = await f.request('/demo-video.mp4');
  assert.equal(full.status, 200); assert.equal(full.headers['content-type'], 'video/mp4');
  assert.equal(full.bytes.subarray(4, 8).toString(), 'ftyp');
  const size = full.bytes.length;
  const head = await f.request('/demo-video.mp4', { method: 'HEAD', range: 'bytes=0-15' });
  assert.equal(head.status, 200); assert.equal(head.bytes, undefined); assert.equal(head.headers['content-length'], size);
  for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=-16', size - 16, size - 1], [`bytes=${size - 8}-`, size - 8, size - 1], [`bytes=${size - 8}-${size + 100}`, size - 8, size - 1]]) {
    const part = await f.request('/demo-video.mp4', { range });
    assert.equal(part.status, 206); assert.equal(part.headers['content-range'], `bytes ${start}-${end}/${size}`);
    assert.equal(part.headers['content-length'], end - start + 1); assert.deepEqual(part.bytes, full.bytes.subarray(start, end + 1));
  }
  for (const range of [`bytes=${size}-`, 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=0-3,7-9', 'bytes=bad']) {
    const response = await f.request('/demo-video.mp4', { range });
    assert.equal(response.status, 416); assert.equal(response.headers['content-range'], `bytes */${size}`);
  }
  assert.equal(f.calls(), 0);
});
