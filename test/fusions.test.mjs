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

const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey());
const lower = account => account.address.toLowerCase();
function fixture(store = createMemoryFusionStore()) {
  let time = Date.now(), calls = 0, unavailable = false, afterRead = () => {};
  const ownership = new Map([['11', alice.address], ['22', bob.address], ['33', outsider.address], ['44', alice.address]]);
  const chain = { async owners(ids) {
    calls++; if (unavailable) throw new Error('RPC secret');
    const result = { owners: ids.map(id => { if (!ownership.has(id)) throw new Error('Unknown token'); return ownership.get(id); }), blockNumber: 100n + BigInt(calls) };
    afterRead(); return result;
  } };
  const options = { store, chain, origin: 'http://localhost:3000', now: () => time };
  const service = createFusionService(options);
  const create = () => service.create(lower(alice), { parentA: '11', parentB: '22' });
  async function approve(id, account) {
    const { message } = await service.message(id, lower(account));
    return service.approve(id, lower(account), await account.signMessage({ message }));
  }
  return { service, options, store, chain, create, approve, calls: () => calls, advance: ms => { time += ms; }, transfer: (id, account) => ownership.set(id, account.address), breakRpc: () => { unavailable = true; }, afterRead: fn => { afterRead = fn; } };
}
const errorStatus = status => error => error.status === status;

test('two holders approve the exact same immutable parents and art direction', async () => {
  const f = fixture(), request = await f.create();
  assert.equal(request.state, 'awaiting_approvals');
  assert.equal(request.parents[0].owner, lower(alice)); assert.equal(request.parents[1].owner, lower(bob));
  const first = await f.approve(request.id, alice);
  assert.equal(first.state, 'awaiting_approvals'); assert.ok(first.parents[0].approvedAt); assert.equal(first.parents[1].approvedAt, null);
  const second = await f.approve(request.id, bob);
  assert.equal(second.state, 'approved'); assert.equal(second.generationAvailable, false);
  assert.doesNotMatch(JSON.stringify(second), /signature/);
  assert.equal(f.calls(), 5); // Creation + preparing and accepting each approval.
  const stored = f.store.get(request.id);
  assert.match(stored.parents[0].approval.signature, /^0x/);
  assert.match(request.invitationUrl, new RegExp(`fusion=${request.id}#fusion$`));
});
test('creation rejects unauthorised, duplicate, malformed, and same-holder parents', async () => {
  const f = fixture();
  await assert.rejects(f.service.create(lower(bob), { parentA: '11', parentB: '22' }), errorStatus(403));
  for (const input of [null, {}, { parentA: '11', parentB: '11' }, { parentA: '-1', parentB: '22' }, { parentA: '11', parentB: String(2n ** 256n) }, { parentA: '11', parentB: '44' }]) await assert.rejects(f.service.create(lower(alice), input), errorStatus(400));
});
test('outsiders cannot request an approval message, sign, cancel, or recheck', async () => {
  const f = fixture(), r = await f.create();
  for (const action of ['message', 'approve', 'cancel', 'recheck']) await assert.rejects(f.service[action](r.id, lower(outsider), '0x00'), errorStatus(403));
  assert.equal(f.calls(), 1);
});
test('wrong signers and altered token IDs fail signature verification', async () => {
  const f = fixture(), r = await f.create();
  const { message } = await f.service.message(r.id, lower(alice));
  for (const signature of [await bob.signMessage({ message }), await alice.signMessage({ message: message.replace('token 11', 'token 33') }), '0x00', undefined]) await assert.rejects(f.service.approve(r.id, lower(alice), signature), errorStatus(403));
  assert.equal(f.service.get(r.id).parents[0].approvedAt, null);
});
test('an approval cannot be replayed into another invitation or accepted twice', async () => {
  const f = fixture(), a = await f.create(), b = await f.create();
  const { message } = await f.service.message(a.id, lower(alice));
  const signature = await alice.signMessage({ message });
  await assert.rejects(f.service.approve(b.id, lower(alice), signature), errorStatus(403));
  await f.service.approve(a.id, lower(alice), signature);
  await assert.rejects(f.service.approve(a.id, lower(alice), signature), errorStatus(409));
});
test('expired invitations reject approval and expire in recent requests', async () => {
  const f = fixture(), r = await f.create();
  const { message } = await f.service.message(r.id, lower(alice));
  const signature = await alice.signMessage({ message }); f.advance(24 * 60 * 60 * 1000 + 1);
  await assert.rejects(f.service.approve(r.id, lower(alice), signature), errorStatus(409));
  assert.equal(f.service.get(r.id).state, 'expired'); assert.equal(f.service.list(lower(bob))[0].state, 'expired');
});
test('a deadline reached while the RPC is in flight also rejects approval', async () => {
  const f = fixture(), r = await f.create();
  const { message } = await f.service.message(r.id, lower(alice));
  f.afterRead(() => f.advance(24 * 60 * 60 * 1000 + 1));
  await assert.rejects(f.service.approve(r.id, lower(alice), await alice.signMessage({ message })), errorStatus(409));
  assert.equal(f.service.get(r.id).state, 'expired'); assert.equal(f.service.get(r.id).parents[0].approvedAt, null);
});
test('a parent transfer invalidates a pending invitation and its old signatures', async () => {
  const f = fixture(), r = await f.create();
  const { message } = await f.service.message(r.id, lower(alice)); f.transfer('22', outsider);
  await assert.rejects(f.service.approve(r.id, lower(alice), await alice.signMessage({ message })), errorStatus(409));
  assert.equal(f.service.get(r.id).state, 'invalidated');
  f.transfer('22', bob);
  await assert.rejects(f.service.message(r.id, lower(alice)), errorStatus(409));
});
test('ownership is rechecked even after both holders sign', async () => {
  const f = fixture(), r = await f.create();
  await f.approve(r.id, alice); await f.approve(r.id, bob); f.transfer('11', outsider);
  await assert.rejects(f.service.recheck(r.id, lower(bob)), errorStatus(409));
  assert.equal(f.service.get(r.id).state, 'invalidated');
});
test('either holder can cancel an approved invitation', async () => {
  const f = fixture(), r = await f.create();
  await f.approve(r.id, alice); await f.approve(r.id, bob);
  assert.equal((await f.service.cancel(r.id, lower(bob))).state, 'cancelled');
  await assert.rejects(f.service.recheck(r.id, lower(alice)), errorStatus(409));
});
test('simultaneous holder approvals preserve both signatures', async () => {
  const f = fixture(), r = await f.create();
  const [a, b] = await Promise.all([f.service.message(r.id, lower(alice)), f.service.message(r.id, lower(bob))]);
  const [sa, sb] = await Promise.all([alice.signMessage({ message: a.message }), bob.signMessage({ message: b.message })]);
  await Promise.all([f.service.approve(r.id, lower(alice), sa), f.service.approve(r.id, lower(bob), sb)]);
  assert.equal(f.service.get(r.id).state, 'approved');
});
test('cancellation cannot be undone by a concurrent approval', async () => {
  const f = fixture(), r = await f.create();
  const { message } = await f.service.message(r.id, lower(alice)); const signature = await alice.signMessage({ message });
  const result = await Promise.allSettled([f.service.cancel(r.id, lower(bob)), f.service.approve(r.id, lower(alice), signature)]);
  assert.equal(result[0].status, 'fulfilled'); assert.equal(result[1].status, 'rejected'); assert.equal(f.service.get(r.id).state, 'cancelled');
});
test('RPC errors fail closed without storing an approval', async () => {
  const f = fixture(), r = await f.create();
  const { message } = await f.service.message(r.id, lower(alice)); const signature = await alice.signMessage({ message });
  f.breakRpc();
  await assert.rejects(f.service.approve(r.id, lower(alice), signature), error => error.status === 502 && !error.message.includes('RPC secret'));
  assert.equal(f.service.get(r.id).parents[0].approvedAt, null);
});
test('SQLite preserves invitations and exact signed messages across a restart', async () => {
  // Retain this small test database in the OS temp directory; no user files are removed.
  const path = join(mkdtempSync(join(tmpdir(), 'chogchemy-test-')), 'requests.sqlite');
  const store = createSqliteFusionStore(path), f = fixture(store), r = await f.create();
  const before = await f.service.message(r.id, lower(bob)); await f.approve(r.id, alice); store.close();
  const reopened = createSqliteFusionStore(path);
  try {
    const service = createFusionService({ ...f.options, store: reopened });
    assert.ok(service.get(r.id).parents[0].approvedAt);
    const after = await service.message(r.id, lower(bob)); assert.equal(after.message, before.message);
    const result = await service.approve(r.id, lower(bob), await bob.signMessage({ message: before.message }));
    assert.equal(result.state, 'approved');
  } finally { reopened.close(); }
});
test('per-holder active invitation limits prevent unbounded creation', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.create();
  await assert.rejects(f.create(), errorStatus(429));
});

test('HTTP API supports public invitations and only authenticated holder approvals', async () => {
  const f = fixture(), app = createApplication({ chain: f.chain, fusionStore: f.store, origin: f.options.origin, now: f.options.now });
  async function request(url, { cookie, data } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.url = url; req.method = data === undefined ? 'GET' : 'POST'; req.headers = { origin: f.options.origin, ...(cookie ? { cookie } : {}) }; req.socket = { remoteAddress: 'test' };
    const result = { headers: {} };
    await app(req, { setHeader(k, v) { result.headers[k.toLowerCase()] = v; }, writeHead(s) { result.status = s; }, end(text) { result.body = JSON.parse(text); } });
    return result;
  }
  async function login(account) {
    const c = await request('/api/auth/challenge', { data: { address: account.address } });
    const r = await request('/api/auth/verify', { data: { id: c.body.id, signature: await account.signMessage({ message: c.body.message }) } });
    assert.equal(r.status, 200); return r.headers['set-cookie'].split(';')[0];
  }
  const cookieA = await login(alice), cookieB = await login(bob);
  const created = await request('/api/fusions', { cookie: cookieA, data: { parentA: '11', parentB: '22' } });
  assert.equal(created.status, 201); const id = created.body.id;
  assert.equal((await request(`/api/fusions/${id}`)).status, 200);
  assert.equal((await request(`/api/fusions/${id}/message`, { data: {} })).status, 401);
  for (const [account, cookie] of [[alice, cookieA], [bob, cookieB]]) {
    const message = await request(`/api/fusions/${id}/message`, { cookie, data: {} }); assert.equal(message.status, 200);
    const signed = await request(`/api/fusions/${id}/approve`, { cookie, data: { signature: await account.signMessage({ message: message.body.message }) } }); assert.equal(signed.status, 200);
  }
  const final = await request(`/api/fusions/${id}`); assert.equal(final.body.state, 'approved');
  assert.doesNotMatch(JSON.stringify(final.body), /signature/);
});
