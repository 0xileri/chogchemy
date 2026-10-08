import { createPublicClient, http, parseAbi } from 'viem';
import { monad } from 'viem/chains';
import { createOwnerDiscovery } from './owner-discovery.mjs';

export const collection = {
  address: '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763',
  chainId: 143,
  name: 'Chog Genesis',
  marketplace: 'https://opensea.io/collection/chog-genesis',
};
const abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
]);
export function createChain() {
  const client = createPublicClient({ chain: monad, transport: http(process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz', { timeout: 12000, retryCount: 1 }) });
  const read = (functionName, args) => client.readContract({ address: collection.address, abi, functionName, args });
  const discovery = createOwnerDiscovery({ client, address: collection.address, abi });
  const ready = async () => {
    if (await client.getChainId() !== collection.chainId) throw new Error('RPC is connected to the wrong network.');
  };
  return {
    async owners(tokenIds) {
      await ready();
      const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      const owners = await Promise.all(tokenIds.map(tokenId => client.readContract({ address: collection.address, abi, functionName: 'ownerOf', args: [BigInt(tokenId)], blockNumber })));
      return { owners, blockNumber };
    },
    async balance(address) { await ready(); return read('balanceOf', [address]); },
    async ownedTokenIds(address, balance) {
      if (!balance) return [];
      await ready();
      let enumerable = false;
      try { enumerable = await read('supportsInterface', ['0x780e9d63']); } catch { /* Try direct discovery if enumeration is absent. */ }
      if (!enumerable) return discovery.ownedTokenIds(address, { balance });
      const ids = [];
      // Keep calls sequential to respect the public RPC's limits.
      for (let index = 0n; index < balance && index < 12n; index++) ids.push(String(await read('tokenOfOwnerByIndex', [address, index])));
      return ids;
    },
    async token(tokenId) {
      await ready();
      const owner = await read('ownerOf', [BigInt(tokenId)]);
      let tokenURI = null;
      try { tokenURI = await read('tokenURI', [BigInt(tokenId)]); } catch { /* Ownership can still be checked without optional metadata. */ }
      return { owner, tokenURI };
    },
  };
}
