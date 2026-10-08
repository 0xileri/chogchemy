import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createChogPreviews } from '../src/chog-previews.mjs';
import { createApplication } from '../src/application.mjs';
import { digest } from '../src/art-direction.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=', 'base64');
const reference = id => ({ tokenId: id, name: `Chog ${id}`, traits: [{ type: 'Color', value: 'Green' }], bytes: png, mime: 'image/png', digest: digest(png) });
test('preview metadata and image share a bounded reference cache', async () => {
  let calls = 0, time = 1000;
  const previews = createChogPreviews({ chain: {}, now: () => time, ttl: 1000, loadReference: async (_, id) => { calls++; return reference(id); } });
  const [a, b] = await Promise.all([previews.preview('11'), previews.preview('11')]);
  assert.equal(calls, 1); assert.equal(a.imageUrl, b.imageUrl); assert.doesNotMatch(JSON.stringify(a), /tokenURI|bytes|imageURI/);
  assert.deepEqual((await previews.image('11', digest(png))).bytes, png); assert.equal(calls, 1);
  time += 1001; await previews.preview('11'); assert.equal(calls, 2);
});
test('old artwork versions and oversized references cannot be served', async () => {
  const previews = createChogPreviews({ chain: {}, loadReference: async (_, id) => reference(id) });
  await assert.rejects(previews.image('11', '0'.repeat(64)), /changed/);
  const oversized = createChogPreviews({ chain: {}, maxBytes: 10, loadReference: async (_, id) => reference(id) });
  await assert.rejects(oversized.preview('11'), /too large/);
});
test('cache evicts old images at its byte limit', async () => {
  let calls = 0;
  const previews = createChogPreviews({ chain: {}, maxBytes: png.length, loadReference: async (_, id) => { calls++; return reference(id); } });
  await previews.preview('11'); await previews.preview('22'); await previews.preview('11'); assert.equal(calls, 3);
});
test('failed gateway requests are retryable and concurrent downloads are bounded', async () => {
  let release, calls = 0; const wait = new Promise(resolve => { release = resolve; });
  const previews = createChogPreviews({ chain: {}, loadReference: async (_, id) => { calls++; await wait; return reference(id); } });
  const pending = ['1', '2', '3', '4'].map(id => previews.preview(id));
  await assert.rejects(previews.preview('5'), /busy/); release(); await Promise.all(pending); assert.equal(calls, 4);
  let broken = true; const retry = createChogPreviews({ chain: {}, loadReference: async (_, id) => { if (broken) throw new Error('Gateway down'); return reference(id); } });
  await assert.rejects(retry.preview('1')); broken = false; assert.equal((await retry.preview('1')).tokenId, '1');
});

test('authenticated users can preview a partner Chog without treating it as their own NFT', async () => {
  const account = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
  let loads = 0;
  const app = createApplication({ origin: 'http://localhost:3000', chain: { token: async () => ({ owner: other.address, tokenURI: 'ipfs://example' }) }, previewOptions: { loadReference: async (_, id) => { loads++; if (id === '99') throw new Error('sensitive gateway details'); return reference(id); } } });
  async function request(path, { data, cookie, method } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.url = path; req.method = method || (data === undefined ? 'GET' : 'POST'); req.headers = { origin: 'http://localhost:3000', ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'preview-test' };
    const response = { headers: {} };
    await app(req, { setHeader(k, v) { response.headers[k.toLowerCase()] = v; }, writeHead(status, headers = {}) { response.status = status; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); }, end(body) { response.bytes = body; try { response.body = JSON.parse(body); } catch {} } });
    return response;
  }
  assert.equal((await request('/api/chog-preview?id=22')).status, 401);
  assert.equal((await request(`/api/chog-image?id=22&v=${digest(png)}`)).status, 401); assert.equal(loads, 0);
  const challenge = (await request('/api/auth/challenge', { data: { address: account.address } })).body;
  const login = await request('/api/auth/verify', { data: { id: challenge.id, signature: await account.signMessage({ message: challenge.message }) } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const preview = await request('/api/chog-preview?id=22', { cookie }); assert.equal(preview.status, 200); assert.equal(preview.body.name, 'Chog 22');
  const image = await request(preview.body.imageUrl, { cookie }); assert.equal(image.status, 200); assert.deepEqual(image.bytes, png);
  assert.equal(image.headers['content-type'], 'image/png'); assert.match(image.headers['cache-control'], /private/); assert.equal(image.headers['x-content-type-options'], 'nosniff');
  assert.equal((await request(preview.body.imageUrl, { cookie, method: 'HEAD' })).bytes, undefined);
  assert.equal((await request('/api/chog?id=22', { cookie })).status, 403);
  assert.equal((await request('/api/chog-preview?id=-1', { cookie })).status, 400);
  const failure = await request('/api/chog-preview?id=99', { cookie }); assert.equal(failure.status, 502); assert.doesNotMatch(failure.body.error, /sensitive/);
});
