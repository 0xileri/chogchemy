import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createFusionService } from '../src/fusions.mjs';
import { createMemeService } from '../src/memes.mjs';
import { createMemoryFusionStore, createSqliteFusionStore } from '../src/fusion-store.mjs';
import { captionMeme, memeCatalog, memeTemplate, normalizeMemeCaptions, renderCaptionText, restoreLegacyMemeScene } from '../src/meme-catalog.mjs';
import { currentCommunityPrompt } from '../src/community-prompts.mjs';
import { digest } from '../src/art-direction.mjs';
import { collection } from '../src/chain.mjs';

const creator = '0x' + 'a'.repeat(40), stranger = '0x' + 'b'.repeat(40);
const scene = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#73aa33' } }).png().toBuffer();
const status = value => error => error.status === value;
function fixture(store = createMemoryFusionStore()) {
  let time = Date.UTC(2026, 9, 14, 12), owner = creator, calls = 0, ownerCalls = 0;
  const direction = { hash: 'caption-test-style', label: 'Test style', rules: [], images: [] };
  const config = { store, origin: 'http://localhost:3000', now: () => time, holderDailyLimit: 4,
    chain: { async owners() { ownerCalls++; return { owners: [owner], blockNumber: 123n }; } },
    artDirection: direction, loadReference: async () => ({ bytes: scene, mime: 'image/png', digest: digest(scene) }),
    templateLoader: async template => ({ bytes: scene, mime: 'image/png', templateId: template.id }),
    imageGenerator: { configured: true, model: 'test', async generate() { calls++; return { bytes: scene, mode: 'ai', model: 'test' }; } } };
  const fusions = createFusionService(config);
  const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
  const memes = createMemeService({ ...config, serial: work => Promise.resolve().then(work), jobs: new Set(), checkQuota: () => {}, fail });
  return { config, store, fusions, memes, calls: () => calls, ownerCalls: () => ownerCalls, transfer: () => { owner = stranger; }, advance: ms => { time += ms; },
    input: { tokenId: '11', templateId: '181913649', nonce: '1'.repeat(32), captions: memeTemplate('181913649').slotCaptionSuggestions[0] } };
}

test('ten recommended templates expose bounded source-based caption boxes, role presets and two complete jokes', () => {
  const curated = memeCatalog.templates.filter(template => template.layout);
  assert.equal(curated.length, 10);
  assert.equal(memeTemplate('112126428').category, 'Choices');
  assert.equal(memeTemplate('322841258').category, 'Conversations');
  assert.equal(memeTemplate('217743513').category, 'Choices');
  assert.deepEqual(curated.map(template => template.recommendedOrder).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const template of curated) {
    assert.equal(template.captionSlots, template.layout.boxes);
    assert.ok(template.rolePresets.length > 0);
    assert.ok(template.rolePresets.every(role => role.description.length <= 120));
    assert.equal(template.slotCaptionSuggestions.length, 2);
    for (const idea of template.slotCaptionSuggestions) assert.equal(normalizeMemeCaptions(idea, template).length, template.captionSlots.length);
  }
});

test('caption boxes are canonical, bounded, escaped and reject duplicate or client-created boxes', async () => {
  const template = memeTemplate('322841258');
  assert.equal(normalizeMemeCaptions([], template).length, 4);
  assert.deepEqual(normalizeMemeCaptions([{ boxId: 'claim', text: '  hello  ' }], template)[0], { boxId: 'claim', text: 'hello' });
  for (const input of [null, {}, [{ boxId: 'unknown', text: 'x' }], [{ boxId: 'claim', text: 'x' }, { boxId: 'claim', text: 'y' }], [{ boxId: 'claim', text: 'x'.repeat(81) }], [{ boxId: 'claim', text: '\n' }], [{ boxId: 'claim', text: {} }]]) assert.throws(() => normalizeMemeCaptions(input, template));
  assert.throws(() => normalizeMemeCaptions([], memeTemplate('97984')));
  const f = fixture();
  for (const input of [[{ boxId: 'claim', text: '\u0000' }], [{ boxId: 'realization', text: '<script>alert(1)</script>' }, { boxId: 'wrong', text: 'x' }]]) await assert.rejects(f.fusions.createMeme(creator, { ...f.input, templateId: template.id, captions: input }), status(400));
  const markup = await renderCaptionText('<span foreground="red">This is literal markup</span>', 260, 100);
  const { data, info } = await sharp(markup.data).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) assert.ok(!(data[i] > 170 && data[i + 1] < 80 && data[i + 2] < 80), 'User markup cannot change the caption color.');
});

test('pixel-measured wrapping fits long words and complete four-panel captions without clipping', async () => {
  for (const text of ['W'.repeat(80), '界'.repeat(80), 'A wide caption with words and a Chog 😀']) {
    const rendered = await renderCaptionText(text, 240, 100);
    assert.ok(rendered.info.width <= 240 && rendered.info.height <= 100);
  }
  const white = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'white' } }).png().toBuffer();
  const bars = await captionMeme(white, 'W'.repeat(32), '');
  const { data, info } = await sharp(bars).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < 220; y++) for (const x of [0, 1023]) {
    const i = (y * info.width + x) * info.channels;
    assert.deepEqual([...data.subarray(i, i + 3)], [255, 255, 255], 'The caption stays inside canvas edges.');
  }
  const template = memeTemplate('131940431');
  const result = await captionMeme(scene, '', '', false, { template, captions: template.captionSlots.map(box => ({ boxId: box.id, text: 'W'.repeat(80) })) });
  const meta = await sharp(result).metadata(); assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
  const bike = memeTemplate('79132341');
  const bikeResult = await captionMeme(scene, '', '', false, { template: bike, captions: bike.slotCaptionSuggestions[0] });
  const pixels = await sharp(bikeResult).raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[680, 500], [700, 850]]) {
    const index = (y * pixels.info.width + x) * pixels.info.channels;
    assert.deepEqual([...pixels.data.subarray(index, index + 3)], [115, 170, 51], 'Captions leave the Chog face and body areas uncovered.');
  }
});

test('free caption export preserves original art and request, never invokes AI or ownership/quota checks', async () => {
  const f = fixture(), record = await f.fusions.createMeme(creator, f.input); await f.fusions.idle();
  const saved = f.store.get(record.id), original = f.store.artwork(record.id), usage = f.fusions.usage(creator), ownerCalls = f.ownerCalls();
  assert.deepEqual(f.store.memeScene(record.id), scene);
  f.transfer(); f.advance(2 * 86400000);
  const exported = await f.memes.recaption(record.id, creator, { captions: [{ boxId: 'reject', text: 'New joke' }, { boxId: 'approve', text: 'Still my saved Chog' }] });
  assert.equal(exported.source, 'saved_scene'); assert.equal(f.calls(), 1); assert.equal(f.ownerCalls(), ownerCalls);
  assert.deepEqual(f.store.get(record.id), saved); assert.deepEqual(f.store.artwork(record.id), original); assert.notDeepEqual(exported.bytes, original);
  assert.equal(f.fusions.usage(creator).used, 0, 'UTC reset stays independent of free exports.');
  assert.equal(usage.used, 1);
  await assert.rejects(f.memes.recaption(record.id, stranger, { captions: [] }), status(403));
  await assert.rejects(f.memes.recaption(record.id, creator, { captions: [{ boxId: 'reject', text: 'x'.repeat(81) }] }), status(400));
});

test('raw scenes survive SQLite reopen, and original/scene/state save rolls back together on failure', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chogchemy-caption-')), 'records.sqlite'), store = createSqliteFusionStore(path), f = fixture(store);
  const record = await f.fusions.createMeme(creator, f.input); await f.fusions.idle(); const original = store.artwork(record.id); store.close();
  const reopened = createSqliteFusionStore(path);
  try {
    const again = fixture(reopened), exported = await again.memes.recaption(record.id, creator, { captions: [] });
    assert.equal(exported.source, 'saved_scene'); assert.equal(again.calls(), 0); assert.deepEqual(reopened.memeScene(record.id), scene); assert.deepEqual(reopened.artwork(record.id), original);
    const broken = { ...reopened.get(record.id), id: 'e'.repeat(64) };
    assert.throws(() => reopened.complete(broken, scene, {}));
    assert.equal(reopened.get(broken.id), null); assert.equal(reopened.artwork(broken.id), null); assert.equal(reopened.memeScene(broken.id), null);
  } finally { reopened.close(); }
});

test('existing uncaptained and old caption-bar scenes support free exports without changing their original downloads', async () => {
  const f = fixture(), record = await f.fusions.createMeme(creator, f.input); await f.fusions.idle();
  const base = f.store.get(record.id); delete base.scene; delete base.captionRenderingVersion; delete base.captions; delete base.captionLayout;
  const uncaptioned = { ...base, id: 'c'.repeat(64), topCaption: '', bottomCaption: '' };
  f.store.complete(uncaptioned, scene);
  assert.equal((await f.memes.recaption(uncaptioned.id, creator, { captions: memeTemplate('181913649').slotCaptionSuggestions[0] })).source, 'legacy_uncaptioned');
  const old = { ...base, id: 'd'.repeat(64), templateId: '79132341', topCaption: 'An old caption', bottomCaption: '' };
  const picture = await sharp(scene).resize(948, 948).png().toBuffer();
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'white' } }).composite([{ input: picture, left: 38, top: 76 }, { input: Buffer.from('<svg width="1024" height="76"><text x="512" y="54" text-anchor="middle" font-size="40">An old caption</text></svg>'), left: 0, top: 0 }]).png().toBuffer();
  f.store.complete(old, png); const before = f.store.get(old.id);
  const restored = await restoreLegacyMemeScene(png, old);
  assert.equal(restored.source, 'legacy_crop'); const stats = await sharp(restored.bytes).stats();
  assert.deepEqual(stats.channels.slice(0, 3).map(channel => Math.round(channel.mean)), [115, 170, 51], 'Old caption bars and contain padding were removed.');
  const exported = await f.memes.recaption(old.id, creator, { captions: memeTemplate(old.templateId).slotCaptionSuggestions[0] });
  assert.equal(exported.source, 'legacy_crop'); assert.equal(f.calls(), 1); assert.deepEqual(f.store.artwork(old.id), png); assert.deepEqual(f.store.get(old.id), before);
  assert.ok(f.memes.get(old.id, creator).recaptionNotice.includes('slightly softer'));
});

test('legacy payload hashes remain idempotent and optional community entry is immutable and explicit', async () => {
  const f = fixture();
  const oldInput = { tokenId: '11', templateId: '181913649', nonce: '9'.repeat(32), topCaption: 'Top', bottomCaption: 'Bottom', characterRole: '' };
  const data = { tokenId: oldInput.tokenId, templateId: oldInput.templateId, topCaption: oldInput.topCaption, bottomCaption: oldInput.bottomCaption, characterRole: oldInput.characterRole };
  const record = { ...data, kind: 'meme', id: 'f'.repeat(64), createdBy: creator, state: 'generated', nonce: oldInput.nonce, requestHash: digest(JSON.stringify(data)), origin: f.config.origin, chainId: collection.chainId, collection: collection.address, parents: [{ tokenId: '11', owner: creator }], createdAt: f.config.now(), artwork: { mode: 'ai' } };
  f.store.put(record); assert.equal((await f.fusions.createMeme(creator, oldInput)).id, record.id); assert.equal(f.calls(), 0);
  const prompt = currentCommunityPrompt(f.config.now());
  await assert.rejects(f.fusions.createMeme(creator, { ...f.input, challengeId: 'wrong' }), status(400));
  const created = await f.fusions.createMeme(creator, { ...f.input, challengeId: prompt.id }); await f.fusions.idle();
  assert.equal(f.fusions.getMeme(created.id).challengeId, prompt.id);
  await assert.rejects(f.fusions.createMeme(creator, f.input), status(409));
  f.advance(8 * 86400000);
  assert.equal((await f.fusions.createMeme(creator, { ...f.input, challengeId: prompt.id })).id, created.id, 'A completed themed request remains idempotent after the prompt changes.');
});
