import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collection } from '../src/chain.mjs';
import { createMemoryFusionStore } from '../src/fusion-store.mjs';
import { createChogPassportService } from '../src/chog-passport.mjs';
import { currentCommunityPrompt } from '../src/community-prompts.mjs';
import { renderChogPassportPage, renderCommunityPromptPage } from '../src/passport-pages.mjs';

const originalOwner = '0x' + 'a'.repeat(40), newOwner = '0x' + 'b'.repeat(40), otherOwner = '0x' + 'c'.repeat(40);
const origin = 'https://example.test', now = Date.UTC(2026, 9, 14, 12);
const image = (createdAt = now, mode = 'ai') => ({ digest: 'd'.repeat(64), createdAt, mode });
function meme(id, changes = {}) {
  return { id: id.repeat(64), kind: 'meme', origin, collection: collection.address, chainId: collection.chainId, state: 'generated', createdBy: originalOwner,
    createdAt: now - 1000, parents: [{ tokenId: '1786', owner: originalOwner }], artwork: image(), templateId: '181913649', nonce: 'private request value',
    topCaption: 'A normal Monday', bottomCaption: 'My Chog has other plans', ...changes };
}
function family(changes = {}) {
  return { id: 'f'.repeat(64), origin, collection: collection.address, chainId: collection.chainId, state: 'generated', createdBy: originalOwner,
    createdAt: now - 5000, parents: [{ tokenId: '1786', owner: originalOwner }, { tokenId: '1870', owner: otherOwner }], artwork: image(now - 4000),
    comic: { state: 'generated', artwork: image(now - 3000), title: 'Our Chog Family' },
    episodes: [{ id: 'e'.repeat(64), state: 'generated', artwork: image(now - 2000), title: 'A first adventure' }],
    stickers: { state: 'generated', artwork: { ...image(now - 1000), items: [{ id: 'gm' }] } }, ...changes };
}
function setup(records = [], extra = {}) {
  const store = createMemoryFusionStore(); for (const record of records) store.put(record);
  let owner = originalOwner, block = 123n, clock = now;
  const chain = { async owners(ids) { assert.deepEqual(ids, ['1786']); return { owners: [owner], blockNumber: block }; } };
  return { store, service: createChogPassportService({ store, chain, origin, now: () => clock, ...extra }), transfer() { owner = newOwner; block++; clock += 30001; } };
}

test('token history survives a transfer while every original creator credit remains unchanged', async () => {
  const original = meme('1'), f = setup([original, family()]);
  const before = await f.service.get('1786');
  assert.equal(before.ownership.owner, originalOwner); assert.equal(before.ownership.blockNumber, '123');
  assert.deepEqual(before.counts, { memes: 1, families: 1, comics: 1, episodes: 1, stickers: 1, total: 5 });
  f.transfer(); const after = await f.service.get('1786');
  assert.equal(after.ownership.owner, newOwner); assert.equal(after.ownership.blockNumber, '124');
  assert.deepEqual(after.entries, before.entries);
  assert.ok(after.entries.every(item => item.creator === originalOwner));
  assert.equal(after.createUrl, '/?chog=1786#meme-studio');
  assert.deepEqual(f.store.get(original.id), original);
  assert.doesNotMatch(JSON.stringify(after), /private request value|"nonce"|providerRequestId|approvalMessage/);
});

test('passports include only completed real appearances from the configured Chog collection and origin', async () => {
  const f = setup([meme('1'), meme('2', { state: 'generation_failed' }), meme('3', { artwork: image(now, 'fixture') }), meme('4', { origin: 'https://other.test' }),
    meme('5', { chainId: 1 }), meme('6', { collection: '0x' + '0'.repeat(40) }), meme('7', { parents: [{ tokenId: '1870', owner: originalOwner }] }),
    family({ artwork: image(now, 'fixture') }), family({ id: '8'.repeat(64), comic: { state: 'generating' }, episodes: [], stickers: null })]);
  const result = await f.service.get('1786');
  assert.equal(result.counts.total, 2); assert.equal(result.counts.memes, 1); assert.equal(result.counts.families, 1);
  assert.ok(result.entries.every(item => item.imageUrl.startsWith('/')));
  assert.ok(result.entries.every(item => item.pageUrl.startsWith('/')));
});

test('owner or preview RPC failures leave the historical scrapbook readable without claiming ownership', async () => {
  const f = setup([meme('1')], { chain: { async owners() { throw new Error('private provider details'); } }, getPreview: async () => { throw new Error('metadata unavailable'); } });
  const result = await f.service.get('1786');
  assert.deepEqual(result.ownership, { status: 'unavailable', owner: null, checkedAt: null, blockNumber: null });
  assert.equal(result.preview, null); assert.equal(result.counts.memes, 1);
  const html = renderChogPassportPage(result, origin);
  assert.match(html, /Current ownership is temporarily unavailable/);
  assert.doesNotMatch(html, /private provider details|Current owner checked on Monad/);
});

test('token validation rejects noncanonical and oversized IDs before calling the chain', async () => {
  let reads = 0; const f = setup([], { chain: { async owners() { reads++; return { owners: [originalOwner], blockNumber: 1n }; } } });
  for (const tokenId of ['01', '-1', '1786<script>', String(2n ** 256n), null]) await assert.rejects(f.service.get(tokenId), error => error.status === 400);
  assert.equal(reads, 0);
});

test('a weekly community entry requires real saved artwork, explicit opt-in and a request within its UTC week', () => {
  const prompt = currentCommunityPrompt(now);
  const f = setup([meme('1', { challengeId: prompt.id }), meme('2'), meme('3', { challengeId: prompt.id, artwork: image(now, 'fixture') }),
    meme('4', { challengeId: prompt.id, state: 'generating' }), meme('5', { challengeId: prompt.id, createdAt: prompt.weekStart - 1 }),
    meme('6', { challengeId: prompt.id, createdAt: prompt.endsAt }), meme('7', { challengeId: 'chog-week-2026-10-05' }),
    family({ challengeId: prompt.id }), meme('8', { challengeId: prompt.id, origin: 'https://other.test' })]);
  const result = f.service.challengeEntries(prompt.id);
  assert.equal(result.total, 1); assert.equal(result.entries[0].id, '1'.repeat(64));
  assert.equal(result.prompt.id, prompt.id);
  assert.throws(() => f.service.challengeEntries('unknown'), error => error.status === 400);
  const html = renderCommunityPromptPage(result, origin);
  assert.match(html, /1 saved entry/); assert.match(html, /Starring Chog #1786/);
  assert.doesNotMatch(html, /"likes"|Winner|Leaderboard/);
});

test('empty community state reports zero entries instead of seeding synthetic activity', () => {
  const f = setup([meme('1')]); const result = f.service.challengeEntries();
  assert.equal(result.total, 0); assert.deepEqual(result.entries, []);
  assert.match(renderCommunityPromptPage(result, origin), /No entries yet/);
});

test('history reports full counts while limiting display, with deterministic newest-first order', async () => {
  const f = setup([meme('1', { artwork: image(now - 100) }), meme('2'), meme('3', { artwork: image(now + 100) })], { limit: 2 });
  const result = await f.service.get('1786');
  assert.equal(result.counts.total, 3); assert.equal(result.shown, 2);
  assert.deepEqual(result.entries.map(item => item.id), ['3'.repeat(64), '2'.repeat(64)]);
  assert.match(renderChogPassportPage(result, origin), /Showing the latest 2 of 3/);
});

test('rendered creator and character pages escape metadata and keep static local image links', async () => {
  const f = setup([family({ comic: { state: 'generated', title: '<img src=x onerror=alert(1)>', artwork: image() } })],
    { getPreview: async () => ({ name: '<script>alert(1)</script>', imageUrl: '/passport-image/1786?v=' + 'd'.repeat(64), traits: [] }) });
  const result = await f.service.get('1786'); const html = renderChogPassportPage(result, origin);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|<img src=x/);
  assert.match(html, /Earlier creations keep their authorship|earlier creations keep their authorship/);
});

test('concurrent public ownership reads share one bounded lookup and cached credit cannot be mutated', async () => {
  let reads = 0, release; const gate = new Promise(resolve => { release = resolve; });
  const f = setup([meme('1')], { chain: { async owners() { reads++; await gate; return { owners: [originalOwner], blockNumber: 12n }; } } });
  const first = f.service.get('1786'), second = f.service.get('1786');
  await Promise.resolve(); assert.equal(reads, 1); release();
  const [a, b] = await Promise.all([first, second]);
  a.ownership.owner = newOwner;
  assert.equal(b.ownership.owner, originalOwner);
  const cached = await f.service.get('1786'); assert.equal(reads, 1); assert.equal(cached.ownership.owner, originalOwner);
});

test('public passports never reuse holder-only or external artwork preview URLs', async () => {
  for (const imageUrl of ['/api/chog-image?id=1786&v=' + 'd'.repeat(64), 'https://external.test/image.jpg', '/passport-image/1870?v=' + 'd'.repeat(64), '/passport-image/1786?v=bad']) {
    const f = setup([], { getPreview: async () => ({ imageUrl, name: 'Unexpected preview' }) });
    assert.equal((await f.service.get('1786')).preview, null);
  }
});
