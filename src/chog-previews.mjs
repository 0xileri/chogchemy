import { loadParentReference } from './reference-assets.mjs';
import { collection } from './chain.mjs';

export function createChogPreviews({ chain, loadReference = loadParentReference, now = Date.now, maxBytes = 64 * 1024 * 1024, ttl = 300000 }) {
  const cache = new Map(), pending = new Map();
  let bytes = 0;
  function evict(id) { const entry = cache.get(id); if (entry) { bytes -= entry.reference.bytes.length; cache.delete(id); } }
  async function get(id) {
    const cached = cache.get(id);
    if (cached?.expires > now()) return cached.reference;
    evict(id);
    if (pending.has(id)) return pending.get(id);
    if (pending.size >= 4) throw new Error('Preview studio is busy.');
    const job = (async () => {
      const reference = await loadReference(chain, id);
      if (!reference.bytes?.length || reference.bytes.length > Math.min(maxBytes, 12 * 1024 * 1024)) throw new Error('Preview image is too large.');
      for (const [key, value] of cache) if (value.expires <= now()) evict(key);
      while (cache.size && (bytes + reference.bytes.length > maxBytes || cache.size >= 40)) evict(cache.keys().next().value);
      cache.set(id, { reference, expires: now() + ttl }); bytes += reference.bytes.length;
      return reference;
    })().finally(() => pending.delete(id));
    pending.set(id, job); return job;
  }
  return {
    async preview(id) {
      const reference = await get(id);
      return { tokenId: id, name: reference.name, traits: reference.traits, collection,
        imageUrl: `/api/chog-image?id=${id}&v=${reference.digest}` };
    },
    async image(id, version) {
      const reference = await get(id);
      if (version !== reference.digest) throw new Error('Preview changed. Reload it.');
      return { bytes: reference.bytes, mime: reference.mime };
    },
  };
}
