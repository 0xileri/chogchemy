import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collection } from '../src/chain.mjs';
import { createMemoryFusionStore } from '../src/fusion-store.mjs';
import { createChogPassportService } from '../src/chog-passport.mjs';
import { renderChogPassportPage, renderCommunityPromptPage } from '../src/passport-pages.mjs';
import { currentCommunityPrompt } from '../src/community-prompts.mjs';
import { attachPassportLiveDetails, validatePassportLiveSnapshot } from '../public/passport.js';

const now = Date.UTC(2026, 9, 14, 12, 0, 0, 321), owner = '0x' + 'a'.repeat(40), origin = 'https://example.test';
const preview = { imageUrl: '/passport-image/1786?v=' + 'd'.repeat(64), name: 'Chog #1786', traits: [] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function store() {
  const result = createMemoryFusionStore();
  result.put({ id: '1'.repeat(64), kind: 'meme', origin, collection: collection.address, chainId: collection.chainId, state: 'generated', createdBy: owner,
    createdAt: now - 1000, parents: [{ tokenId: '1786', owner }], templateId: '181913649', artwork: { mode: 'ai', createdAt: now } });
  return result;
}
function live(overrides = {}) {
  return { tokenId: '1786', ownership: { status: 'verified', owner, checkedAt: now, blockNumber: '123' }, preview, livePending: { ownership: false, preview: false }, ...overrides };
}
class Element {
  hidden = true; disabled = false; textContent = ''; alt = ''; attrs = new Map(); events = new Map();
  set src(value) { this.attrs.set('src', value); } get src() { return this.attrs.get('src'); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  removeAttribute(name) { this.attrs.delete(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  removeEventListener(name) { this.events.delete(name); }
}
function elements() { return Object.fromEntries(['status', 'image', 'placeholder', 'badge', 'wallet', 'details', 'address', 'checked', 'button', 'history'].map(key => [key, new Element()])); }

test('SSR returns saved history before slow RPC/metadata reads and API has a bounded wait while sharing pending work', async () => {
  const gate = deferred(); let reads = 0, previews = 0;
  const service = createChogPassportService({ store: store(), origin, now: () => now, liveWaitMs: 20,
    chain: { async owners() { reads++; await gate.promise; return { owners: [owner], blockNumber: 123n }; } },
    getPreview: async () => { previews++; await gate.promise; return preview; },
  });
  let timer;
  try {
    const initial = await Promise.race([service.get('1786', { resolveLive: false }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSR waited for live NFT details.')), 100); })]);
    assert.equal(initial.counts.memes, 1); assert.equal(initial.ownership.status, 'unavailable'); assert.equal(initial.preview, null);
    assert.deepEqual(initial.livePending, { ownership: true, preview: true });
    const html = renderChogPassportPage(initial, origin);
    assert.match(html, /Drake Hotline Bling/); assert.match(html, /data-passport-token="1786"/); assert.match(html, /src="\/passport.js"/);
    assert.match(html, /Your saved history below is ready/); assert.doesNotMatch(html, /Current owner checked on Monad/);
    const partial = await Promise.race([service.get('1786'), new Promise((_, reject) => { setTimeout(() => reject(new Error('API missed the bounded wait.')), 1000).unref(); })]);
    assert.equal(partial.counts.memes, 1); assert.equal(partial.ownership.status, 'unavailable'); assert.deepEqual(partial.livePending, { ownership: true, preview: true });
    assert.equal(reads, 1); assert.equal(previews, 1);
    gate.resolve(); const loaded = await service.get('1786');
    assert.equal(loaded.ownership.owner, owner); assert.deepEqual(loaded.preview, preview); assert.deepEqual(loaded.entries, initial.entries);
    assert.deepEqual(loaded.livePending, { ownership: false, preview: false }); assert.equal(reads, 1); assert.equal(previews, 1);
  } finally { clearTimeout(timer); gate.resolve(); }
});

test('a completed fresh owner lookup is returned even when ownership caching is disabled', async () => {
  const service = createChogPassportService({ store: store(), origin, now: () => now, ownershipTtl: 0,
    chain: { async owners() { return { owners: [owner], blockNumber: 1n }; } }, getPreview: async () => preview });
  assert.equal((await service.get('1786')).ownership.owner, owner);
});

test('progressive client shows partial details then completes in at most three requests without changing saved history', async () => {
  const nodes = elements(); nodes.history.textContent = 'Original saved creator credits'; let calls = 0, delays = 0;
  const states = [live({ ownership: { status: 'unavailable' }, preview: null, livePending: { ownership: true, preview: true } }), live({ preview: null, livePending: { ownership: false, preview: true } }), live()];
  const client = attachPassportLiveDetails({ tokenId: '1786', elements: nodes, sleep: async () => { delays++; }, fetcher: async url => {
    assert.equal(url, '/api/chogs/1786/passport'); return Response.json(states[calls++]);
  } });
  await client.refresh();
  assert.equal(calls, 3); assert.equal(delays, 2); assert.equal(nodes.badge.hidden, false); assert.equal(nodes.address.textContent, owner);
  assert.equal(nodes.image.src, preview.imageUrl); assert.equal(nodes.image.hidden, false); assert.equal(nodes.placeholder.hidden, true);
  assert.equal(nodes.history.textContent, 'Original saved creator credits'); assert.equal(nodes.button.disabled, false);
  assert.match(nodes.checked.textContent, /2026-10-14 12:00:00 UTC/); assert.doesNotMatch(nodes.checked.textContent, /\.321Z/);
});

test('failed live reads stop after three attempts, preserve the scrapbook and never invent a current owner', async () => {
  const nodes = elements(); nodes.history.textContent = 'Saved Chog meme'; let calls = 0;
  const client = attachPassportLiveDetails({ tokenId: '1786', elements: nodes, sleep: async () => {}, fetcher: async () => { calls++; throw new Error('private RPC detail'); } });
  await client.refresh(); assert.equal(calls, 3); assert.equal(nodes.badge.hidden, true); assert.equal(nodes.wallet.textContent, '');
  assert.equal(nodes.history.textContent, 'Saved Chog meme'); assert.match(nodes.status.textContent, /saved history is still here/); assert.doesNotMatch(nodes.status.textContent, /private RPC detail/);
});

test('live snapshots reject wrong tokens and external, holder-only or malformed image URLs', () => {
  assert.throws(() => validatePassportLiveSnapshot(live({ tokenId: '1870' }), '1786'));
  for (const imageUrl of ['https://foreign.test/image.jpg', 'javascript:alert(1)', '/api/chog-image?id=1786&v=' + 'd'.repeat(64), '/passport-image/1870?v=' + 'd'.repeat(64), '/passport-image/1786?v=' + 'd'.repeat(64) + '&redirect=evil']) assert.equal(validatePassportLiveSnapshot(live({ preview: { imageUrl } }), '1786').preview, null);
  for (const ownership of [{ status: 'verified', owner: '0x' + '0'.repeat(40), checkedAt: now, blockNumber: '1' }, { status: 'verified', owner, checkedAt: NaN, blockNumber: '1' }, { status: 'unavailable', owner }]) assert.equal(validatePassportLiveSnapshot(live({ ownership }), '1786').ownership.status, 'unavailable');
});

test('concurrent refresh clicks share the active client request and unavailable state clears prior owner credit', async () => {
  const gate = deferred(), nodes = elements(); let calls = 0;
  const client = attachPassportLiveDetails({ tokenId: '1786', elements: nodes, attempts: 1, fetcher: async () => { calls++; await gate.promise; return Response.json(live({ ownership: { status: 'unavailable' }, preview: null })); } });
  nodes.badge.hidden = false; nodes.wallet.textContent = 'A prior lookup'; nodes.address.textContent = owner;
  const first = client.refresh(); await client.refresh(); assert.equal(calls, 1); gate.resolve(); await first;
  assert.equal(nodes.badge.hidden, true); assert.equal(nodes.wallet.hidden, true); assert.equal(nodes.address.textContent, ''); assert.equal(nodes.placeholder.hidden, false);
});

test('passport card dates are short, exact timestamps stay in details and community does not start passport requests', async () => {
  const service = createChogPassportService({ store: store(), origin, now: () => now, chain: { async owners() { return { owners: [owner], blockNumber: 1n }; } } });
  const html = renderChogPassportPage(await service.get('1786'), origin);
  assert.match(html, /<br>14 Oct 2026<\/p><details/); assert.match(html, /Saved 2026-10-14 12:00:00 UTC/); assert.doesNotMatch(html, /\.321Z/);
  const community = renderCommunityPromptPage({ prompt: currentCommunityPrompt(now), entries: [], total: 0, shown: 0 }, origin);
  assert.doesNotMatch(community, /src="\/passport.js"|data-passport-token/);
});
