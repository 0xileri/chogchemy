import { collection } from './chain.mjs';
import { memeTemplate } from './meme-catalog.mjs';
import { communityPromptById, currentCommunityPrompt } from './community-prompts.mjs';

const tokenValid = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const idValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const addressValid = value => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
const saved = item => item?.state === 'generated' && item.artwork?.mode === 'ai';
const time = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }

export function createChogPassportService({ store, chain, origin, now = Date.now, getPreview, limit = 60, ownershipTtl = 30000, liveWaitMs = 4500 }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Invalid passport page limit.');
  if (!Number.isSafeInteger(ownershipTtl) || ownershipTtl < 0 || ownershipTtl > 60000) throw new TypeError('Invalid ownership cache lifetime.');
  if (!Number.isSafeInteger(liveWaitMs) || liveWaitMs < 0 || liveWaitMs > 5000) throw new TypeError('Invalid passport lookup deadline.');
  const ownershipCache = new Map(), pendingOwners = new Map(), previewCache = new Map(), pendingPreviews = new Map();
  const unavailableOwner = () => ({ status: 'unavailable', owner: null, checkedAt: null, blockNumber: null });
  async function currentOwner(tokenId) {
    for (const [id, entry] of ownershipCache) if (entry.expires <= now()) ownershipCache.delete(id);
    const cached = ownershipCache.get(tokenId);
    if (cached) return structuredClone(cached.ownership);
    if (pendingOwners.has(tokenId)) return structuredClone(await pendingOwners.get(tokenId));
    if (pendingOwners.size >= 4) return unavailableOwner();
    const job = (async () => {
      let ownership = unavailableOwner();
      try {
        const snapshot = await chain.owners([tokenId]);
        if (addressValid(snapshot?.owners?.[0]) && /^\d+$/.test(String(snapshot.blockNumber))) ownership = { status: 'verified', owner: snapshot.owners[0].toLowerCase(), checkedAt: now(), blockNumber: String(snapshot.blockNumber) };
      } catch { /* Historical creations stay readable when the RPC is unavailable. */ }
      while (ownershipCache.size >= 64) ownershipCache.delete(ownershipCache.keys().next().value);
      ownershipCache.set(tokenId, { ownership, expires: now() + Math.min(ownershipTtl, ownership.status === 'verified' ? ownershipTtl : 5000) });
      return ownership;
    })();
    pendingOwners.set(tokenId, job);
    try { return structuredClone(await job); } finally { pendingOwners.delete(tokenId); }
  }
  async function originalPreview(tokenId) {
    if (!getPreview) return null;
    for (const [id, entry] of previewCache) if (entry.expires <= now()) previewCache.delete(id);
    const cached = previewCache.get(tokenId);
    if (cached) return structuredClone(cached.preview);
    if (pendingPreviews.has(tokenId)) return structuredClone(await pendingPreviews.get(tokenId));
    if (pendingPreviews.size >= 4) return null;
    const job = (async () => {
      let preview = null;
      try {
        const value = await getPreview(tokenId);
        if (value && typeof value.imageUrl === 'string' && new RegExp(`^/passport-image/${tokenId}\\?v=[a-f0-9]{64}$`).test(value.imageUrl)) preview = { name: typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 120) : `Chog #${tokenId}`, imageUrl: value.imageUrl, traits: Array.isArray(value.traits) ? value.traits : [] };
      } catch { /* NFT metadata may arrive later; the saved history is still useful. */ }
      while (previewCache.size >= 64) previewCache.delete(previewCache.keys().next().value);
      previewCache.set(tokenId, { preview, expires: now() + (preview ? 300000 : 5000) });
      return preview;
    })();
    pendingPreviews.set(tokenId, job);
    try { return structuredClone(await job); } finally { pendingPreviews.delete(tokenId); }
  }
  function liveSnapshot(tokenId) {
    const ownerEntry = ownershipCache.get(tokenId), previewEntry = previewCache.get(tokenId);
    return { ownership: ownerEntry?.expires > now() ? structuredClone(ownerEntry.ownership) : unavailableOwner(),
      preview: previewEntry?.expires > now() ? structuredClone(previewEntry.preview) : null,
      livePending: { ownership: pendingOwners.has(tokenId), preview: pendingPreviews.has(tokenId) } };
  }
  const belongs = record => record.origin === origin && record.collection === collection.address && record.chainId === collection.chainId && idValid(record.id) && addressValid(record.createdBy);
  const relevant = () => store.all().filter(belongs);
  function memeEntry(record) {
    const template = memeTemplate(record.templateId);
    return { id: record.id, recordId: record.id, kind: 'meme', title: template?.name || 'Chog meme', tokenId: record.parents[0].tokenId,
      creator: record.createdBy, createdAt: time(record.artwork.createdAt) ?? time(record.createdAt),
      pageUrl: `/memes/${record.id}`, imageUrl: `/meme-artwork/${record.id}.png`, challengeId: record.challengeId || null,
      topCaption: record.topCaption || '', bottomCaption: record.bottomCaption || '' };
  }
  function appearances(tokenId) {
    const entries = [];
    for (const record of relevant()) {
      if (!saved(record) || !Array.isArray(record.parents) || !record.parents.some(p => p.tokenId === tokenId)) continue;
      if (record.kind === 'meme') {
        if (record.parents.length === 1 && tokenValid(record.parents[0].tokenId)) entries.push(memeEntry(record));
        continue;
      }
      const parents = record.parents.filter(p => tokenValid(p.tokenId)).map(p => ({ tokenId: p.tokenId, holderAtCreation: p.owner, signedApproval: Boolean(p.approval?.at) }));
      const base = { recordId: record.id, creator: record.createdBy, parents };
      entries.push({ ...base, id: `${record.id}:child`, kind: 'family', title: `Family child of ${parents.map(p => '#' + p.tokenId).join(' + ')}`,
        createdAt: time(record.artwork.createdAt) ?? time(record.createdAt), pageUrl: `/characters/${record.id}`, imageUrl: `/artwork/${record.id}.png` });
      if (saved(record.comic)) entries.push({ ...base, id: `${record.id}:comic`, kind: 'comic', title: record.comic.title || 'Our Chog family',
        createdAt: time(record.comic.artwork.createdAt) ?? time(record.comic.requestedAt), pageUrl: `/characters/${record.id}#family-comic`, imageUrl: `/comics/${record.id}.png` });
      for (const episode of record.episodes || []) if (saved(episode) && idValid(episode.id)) entries.push({ ...base, id: `${record.id}:${episode.id}`, kind: 'episode', title: episode.title || 'Family episode',
        createdAt: time(episode.artwork.createdAt) ?? time(episode.requestedAt), pageUrl: `/characters/${record.id}#episode-${episode.id}`, imageUrl: `/episodes/${record.id}/${episode.id}.png` });
      if (saved(record.stickers) && record.stickers.artwork.items?.some(item => item.id === 'gm')) entries.push({ ...base, id: `${record.id}:stickers`, kind: 'stickers', title: 'Family chat stickers',
        createdAt: time(record.stickers.artwork.createdAt) ?? time(record.stickers.requestedAt), pageUrl: `/characters/${record.id}#family-stickers`, imageUrl: `/stickers/${record.id}/gm.png` });
    }
    return entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
  }
  function challengeEntries(id = currentCommunityPrompt(now()).id) {
    const prompt = communityPromptById(id);
    if (!prompt) fail(400, 'Choose a valid community prompt.');
    const entries = relevant().filter(r => r.kind === 'meme' && saved(r) && r.parents?.length === 1 && tokenValid(r.parents[0].tokenId) && r.challengeId === id
      && time(r.createdAt) !== null && r.createdAt >= prompt.weekStart && r.createdAt < prompt.endsAt).map(memeEntry)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
    return { prompt, entries: entries.slice(0, limit), total: entries.length, shown: Math.min(entries.length, limit), limit };
  }
  return {
    challengeEntries,
    async get(tokenId, { resolveLive = true } = {}) {
      if (!tokenValid(tokenId)) fail(400, 'Use a valid Chog token ID.');
      const entries = appearances(tokenId);
      const counts = { memes: 0, families: 0, comics: 0, episodes: 0, stickers: 0, total: entries.length };
      const keys = { meme: 'memes', family: 'families', comic: 'comics', episode: 'episodes', stickers: 'stickers' };
      for (const entry of entries) counts[keys[entry.kind]]++;
      const work = Promise.allSettled([currentOwner(tokenId), originalPreview(tokenId)]);
      let resolved;
      if (resolveLive) {
        let timeout;
        try { resolved = await Promise.race([work, new Promise(resolve => { timeout = setTimeout(resolve, liveWaitMs); })]); }
        finally { clearTimeout(timeout); }
      }
      const snapshot = liveSnapshot(tokenId);
      if (resolved?.[0]?.status === 'fulfilled') snapshot.ownership = resolved[0].value;
      if (resolved?.[1]?.status === 'fulfilled') snapshot.preview = resolved[1].value;
      return { tokenId, collection, pageUrl: `${origin}/chogs/${tokenId}`, nftUrl: `https://opensea.io/item/monad/${collection.address}/${tokenId}`,
        createUrl: `/?chog=${tokenId}#meme-studio`, ...snapshot, counts, entries: entries.slice(0, limit), shown: Math.min(entries.length, limit), limit };
    },
  };
}
