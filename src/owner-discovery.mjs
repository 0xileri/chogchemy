// Discover this small, fixed collection without depending on an NFT indexer.
// A shared snapshot bounds RPC work across connected wallets. It is a discovery
// hint only: selecting a token and approving/generating still recheck ownership.
export function createOwnerDiscovery({ client, address, abi, now = Date.now, cacheMs = 30000, batchSize = 200 }) {
  let cached = null, pending = null;
  async function scan() {
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const [supply, maximum] = await client.multicall({ blockNumber, allowFailure: false, contracts: ['totalSupply', 'maxSupply'].map(functionName => ({ address, abi, functionName })) });
    if (typeof supply !== 'bigint' || typeof maximum !== 'bigint' || maximum < 1n || maximum > 5000n || supply < 0n || supply > maximum) throw new Error('Collection does not support bounded discovery.');
    const byOwner = new Map(); let found = 0n;
    // Include both boundary IDs to support this collection's starting index.
    for (let first = 0; first <= Number(maximum); first += batchSize) {
      const count = Math.min(batchSize, Number(maximum) + 1 - first);
      const results = await client.multicall({ blockNumber, batchSize: 0, allowFailure: true, contracts: Array.from({ length: count }, (_, i) => ({ address, abi, functionName: 'ownerOf', args: [BigInt(first + i)] })) });
      if (results.length !== count) throw new Error('Incomplete discovery response.');
      for (const [index, result] of results.entries()) {
        if (result.status !== 'success') continue; // Unminted/burned boundary IDs revert.
        if (typeof result.result !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(result.result) || /^0x0{40}$/.test(result.result)) throw new Error('Invalid owner response.');
        found++;
        const owner = result.result.toLowerCase();
        if (!byOwner.has(owner)) byOwner.set(owner, []);
        byOwner.get(owner).push(String(first + index));
      }
    }
    // Never present a partial scan as a complete wallet inventory.
    if (found !== supply) throw new Error('Collection token range could not be completely discovered.');
    return { byOwner, blockNumber, at: now() };
  }
  async function snapshot() {
    if (cached && now() - cached.at < cacheMs) return cached;
    if (!pending) {
      pending = scan().then(result => { cached = result; return result; }).finally(() => { pending = null; });
    }
    return pending;
  }
  return {
    async ownedTokenIds(owner, { limit = 12, balance = null } = {}) {
      let result = await snapshot();
      if (balance !== null && BigInt(result.byOwner.get(owner.toLowerCase())?.length || 0) !== balance) {
        cached = null; result = await snapshot();
      }
      return (result.byOwner.get(owner.toLowerCase()) || []).slice(0, limit);
    },
  };
}
