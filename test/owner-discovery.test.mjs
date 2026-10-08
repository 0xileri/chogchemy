import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerDiscovery } from '../src/owner-discovery.mjs';

const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
function fixture() {
  let time = 1000, block = 100n, scans = 0, fail = false, maximum = 3n, supply = 3n;
  const owners = new Map([[1n, alice], [2n, bob], [3n, alice]]), seenBlocks = [];
  const client = {
    async getBlockNumber() { scans++; return block; },
    async multicall(options) {
      seenBlocks.push(options.blockNumber);
      if (options.contracts[0].functionName === 'totalSupply') return [supply, maximum];
      if (fail) throw new Error('RPC failed');
      return options.contracts.map(c => owners.has(c.args[0]) ? { status: 'success', result: owners.get(c.args[0]) } : { status: 'failure', error: new Error('Nonexistent token') });
    },
  };
  const discovery = createOwnerDiscovery({ client, address: alice, abi: [], now: () => time, cacheMs: 30000, batchSize: 2 });
  return { discovery, owners, seenBlocks, scans: () => scans, advance() { time += 30001; block++; }, fail() { fail = true; }, recover() { fail = false; }, maximum: value => { maximum = value; }, supply: value => { supply = value; } };
}
test('discovers tokens for a non-enumerable collection from one consistent block', async () => {
  const f = fixture();
  assert.deepEqual(await f.discovery.ownedTokenIds(alice), ['1', '3']);
  assert.deepEqual(await f.discovery.ownedTokenIds(bob), ['2']);
  assert.deepEqual(await f.discovery.ownedTokenIds('0x3333333333333333333333333333333333333333'), []);
  assert.ok(f.seenBlocks.every(block => block === 100n)); assert.equal(f.scans(), 1);
});
test('concurrent wallet searches share a scan and cache expires', async () => {
  const f = fixture();
  await Promise.all([f.discovery.ownedTokenIds(alice), f.discovery.ownedTokenIds(bob)]); assert.equal(f.scans(), 1);
  f.advance(); await f.discovery.ownedTokenIds(alice); assert.equal(f.scans(), 2);
});
test('balance mismatch refreshes a cached snapshot after a transfer', async () => {
  const f = fixture(); await f.discovery.ownedTokenIds(alice);
  f.owners.set(3n, bob);
  assert.deepEqual(await f.discovery.ownedTokenIds(bob, { balance: 2n }), ['2', '3']); assert.equal(f.scans(), 2);
});
test('partial results fail closed and are not cached as a complete inventory', async () => {
  const f = fixture(); f.owners.delete(3n);
  await assert.rejects(f.discovery.ownedTokenIds(alice), /completely discovered/);
  f.owners.set(3n, alice); assert.deepEqual(await f.discovery.ownedTokenIds(alice), ['1', '3']); assert.equal(f.scans(), 2);
});
test('RPC failures are retryable on a subsequent refresh', async () => {
  const f = fixture(); f.fail(); await assert.rejects(f.discovery.ownedTokenIds(alice), /RPC failed/);
  f.recover(); assert.deepEqual(await f.discovery.ownedTokenIds(alice), ['1', '3']);
});
test('unsupported or unexpectedly large collections do not trigger unbounded RPC work', async () => {
  const f = fixture(); f.maximum(5001n); await assert.rejects(f.discovery.ownedTokenIds(alice), /bounded discovery/);
  assert.equal(f.seenBlocks.length, 1);
});
test('discovery limits returned tokens without changing the complete cached snapshot', async () => {
  const f = fixture(); assert.deepEqual(await f.discovery.ownedTokenIds(alice, { limit: 1 }), ['1']);
  assert.deepEqual(await f.discovery.ownedTokenIds(alice), ['1', '3']); assert.equal(f.scans(), 1);
});
