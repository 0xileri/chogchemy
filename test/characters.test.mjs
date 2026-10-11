import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApplication } from '../src/application.mjs';
import { createMemoryFusionStore } from '../src/fusion-store.mjs';
import { collection } from '../src/chain.mjs';

const origin = 'https://chogchemy.example';
const id = 'a'.repeat(64), ownerA = '0x' + '1'.repeat(40), ownerB = '0x' + '2'.repeat(40);
const now = Date.UTC(2026, 9, 11, 12);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5H0AAAAASUVORK5CYII=', 'base64');
function fixture(overrides = {}) {
  const store = createMemoryFusionStore();
  const record = { id, origin, state: 'generated', chainId: collection.chainId, collection: collection.address,
    createdBy: ownerA, createdAt: now - 2000, expires: now - 1000, checkedAt: now - 1500, checkedBlock: '12345',
    artDirection: 'Chogchemy house style v1', approvalPolicy: 'creator', creatorVerifiedAt: now - 2000,
    parents: [{ tokenId: '11', owner: ownerA, approval: null }, { tokenId: '22', owner: ownerB, approval: null }],
    artwork: { digest: 'b'.repeat(64), createdAt: now, mode: 'ai', model: 'test-model' },
    generation: { providerStartedAt: now - 500, providerRequestId: 'private-provider-request', error: 'private-error' },
    artDirectionSnapshot: { references: ['private-reference-file'] }, ...overrides };
  store.complete(record, png);
  let rpcCalls = 0;
  const app = createApplication({ origin, now: () => now, fusionStore: store, chain: { async owners() { rpcCalls++; throw new Error('No RPC expected'); } } });
  async function request(path, method = 'GET') {
    const req = Readable.from([]); req.url = path; req.method = method;
    req.headers = { host: 'untrusted-host.example' }; req.socket = { remoteAddress: 'test' };
    const result = { headers: {} };
    await app(req, { setHeader(key, value) { result.headers[key.toLowerCase()] = value; },
      writeHead(status, headers = {}) { result.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
      end(bytes) { result.bytes = bytes; result.text = bytes?.toString(); } });
    return result;
  }
  return { request, rpcCalls: () => rpcCalls };
}

test('finished character pages are public historical records with canonical artwork previews', async () => {
  const f = fixture(), page = await f.request(`/characters/${id}?fusion=ignored`);
  assert.equal(page.status, 200); assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['content-length'], page.bytes.length);
  assert.match(page.text, new RegExp(`rel="canonical" href="${origin}/characters/${id}"`));
  assert.match(page.text, new RegExp(`property="og:image" content="${origin}/artwork/${id}\\.png"`));
  assert.match(page.text, /Chog Genesis #11/); assert.match(page.text, /Chog Genesis #22/);
  assert.match(page.text, /Partner has not signed/); assert.match(page.text, /historical holders and approvals/);
  assert.match(page.text, /not a newly minted NFT/); assert.match(page.text, /2026-10-11 12:00:00 UTC/);
  assert.doesNotMatch(page.text, /untrusted-host|ignored|private-provider-request|private-error|private-reference-file/);
  const head = await f.request(`/characters/${id}`, 'HEAD'); assert.equal(head.status, 200);
  assert.equal(head.bytes, undefined); assert.equal(head.headers['content-length'], page.bytes.length);
  const image = await f.request(`/artwork/${id}.png`); assert.equal(image.status, 200); assert.deepEqual(image.bytes, png);
  const data = JSON.parse((await f.request(`/api/fusions/${id}`)).text);
  assert.equal(data.characterUrl, `${origin}/characters/${id}`);
  assert.equal(f.rpcCalls(), 0);
});

test('unfinished, missing, malformed and other-origin records have a useful 404 without a shareable character', async () => {
  for (const overrides of [{ state: 'approved', expires: now + 10000, artwork: null }, { state: 'awaiting_approvals', expires: now + 10000, artwork: null }, { origin: 'https://another.example' }, { artwork: null }]) {
    const f = fixture(overrides), page = await f.request(`/characters/${id}`);
    assert.equal(page.status, 404); assert.match(page.text, /This character/); assert.match(page.text, /name="robots" content="noindex"/);
    assert.doesNotMatch(page.text, /Chog Genesis #11|private-provider-request/);
  }
  const f = fixture({ state: 'approved', expires: now + 10000, artwork: null });
  assert.equal(JSON.parse((await f.request(`/api/fusions/${id}`)).text).characterUrl, null);
  for (const path of ['/characters/not-an-id', `/characters/${'c'.repeat(64)}`, `/characters/${id}/extra`, '/characters/%3Cscript%3E']) {
    assert.equal((await f.request(path)).status, 404);
    assert.equal((await f.request(path, 'HEAD')).bytes, undefined);
  }
  assert.equal((await f.request(`/characters/${id}`, 'POST')).status, 404);
});

test('public approval labels reflect optional signatures, both signatures and same-wallet parents', async () => {
  const signed = { signature: 'private-signature', at: now - 1000 };
  const partner = fixture({ parents: [{ tokenId: '11', owner: ownerA, approval: null }, { tokenId: '22', owner: ownerB, approval: signed }] });
  const partnerPage = (await partner.request(`/characters/${id}`)).text;
  assert.match(partnerPage, /Creator verified · Partner signed/); assert.doesNotMatch(partnerPage, /private-signature/);
  const both = fixture({ approvalPolicy: 'both_holders', parents: [{ tokenId: '11', owner: ownerA, approval: signed }, { tokenId: '22', owner: ownerB, approval: signed }] });
  const bothPage = (await both.request(`/characters/${id}`)).text;
  assert.match(bothPage, /Both holders signed/); assert.match(bothPage, /required signed approval from both/);
  const same = fixture({ parents: [{ tokenId: '11', owner: ownerA, approval: null }, { tokenId: '22', owner: ownerA, approval: null }] });
  const samePage = (await same.request(`/characters/${id}`)).text;
  assert.match(samePage, /Creator verified · Both Chogs owned/); assert.doesNotMatch(samePage, /Partner has not signed/);
});

test('stored art direction cannot inject markup into public pages', async () => {
  const f = fixture({ artDirection: '<img src=x onerror="alert(1)"> & artist\'s style' });
  const page = await f.request(`/characters/${id}`);
  assert.equal(page.status, 200); assert.match(page.text, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; artist&#39;s style/);
  assert.doesNotMatch(page.text, /<img src=x/);
});

test('synthetic outputs stay clearly labelled and sharing scripts are served without authentication', async () => {
  const f = fixture({ artwork: { digest: 'b'.repeat(64), createdAt: now, mode: 'fixture', model: 'synthetic-test' } });
  const page = await f.request(`/characters/${id}`);
  assert.match(page.text, /<title>TEST ARTWORK/); assert.match(page.text, /Synthetic output, not a real AI fusion/);
  for (const path of ['/character.js', '/share.js']) {
    const script = await f.request(path); assert.equal(script.status, 200); assert.match(script.headers['content-type'], /text\/javascript/);
  }
});
