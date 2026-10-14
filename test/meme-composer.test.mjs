import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionDraft, savedCaptionValues, roleDescription, filterTemplates, requestCaptionExport } from '../public/meme-composer.js';
import { metamaskBrowserLink } from '../public/mobile-wallet.js';

const template = { captionSlots: [{ id: 'left', label: 'Left choice' }, { id: 'right', label: 'Right choice' }, { id: 'character', label: 'Your Chog' }], rolePresets: [{ id: 'chooser', label: 'The person choosing', description: 'Replace the worried chooser with the Chog.' }] };
test('curated caption drafts identify every slot without losing intentionally blank text', () => {
  assert.deepEqual(captionDraft(template, ['One', '', 'My Chog']), { captions: [{ boxId: 'left', text: 'One' }, { boxId: 'right', text: '' }, { boxId: 'character', text: 'My Chog' }] });
  assert.deepEqual(captionDraft({}, ['Top', 'Bottom', 'hidden field']), { topCaption: 'Top', bottomCaption: 'Bottom' });
});
test('saved captions restore by box identity rather than provider order; legacy bars remain editable', () => {
  assert.deepEqual(savedCaptionValues({ template, captions: [{ boxId: 'character', text: 'Chog' }, { boxId: 'left', text: 'Choice' }] }), ['Choice', '', 'Chog']);
  assert.deepEqual(savedCaptionValues({ template, topCaption: 'Old top', bottomCaption: 'Old bottom' }), ['Old top', '', 'Old bottom']);
  assert.deepEqual(savedCaptionValues({ template: {}, topCaption: 'Top', bottomCaption: '' }), ['Top', '']);
});
test('role choices use readable descriptions and a user’s custom role takes precedence', () => {
  assert.equal(roleDescription(template, 'chooser'), 'Replace the worried chooser with the Chog.');
  assert.equal(roleDescription(template, 'chooser', '  The left person  '), 'The left person');
  assert.equal(roleDescription(template, 'missing'), '');
});
test('recommended browsing excludes the full catalog until selected and applies search and category together', () => {
  const catalog = [{ name: 'Drake', category: 'Reactions', rank: 1, recommendedOrder: 2 }, { name: 'Two Buttons', category: 'Choices', rank: 2, recommendedOrder: 1 }, { name: 'Bike Fall', category: 'Situations', rank: 3 }];
  assert.deepEqual(filterTemplates(catalog).map(t => t.name), ['Two Buttons', 'Drake']);
  assert.deepEqual(filterTemplates(catalog, { scope: 'all', query: ' BIKE ', category: 'Situations' }).map(t => t.name), ['Bike Fall']);
  assert.deepEqual(filterTemplates(catalog, { query: 'bike' }), []);
  assert.deepEqual(filterTemplates(catalog, { scope: 'all', query: 'Bike', category: 'Reactions' }), []);
});
test('mobile wallet deep link keeps a saved page inside the target URL and rejects executable or credential URLs', () => {
  const link = metamaskBrowserLink('https://chogchemy.up.railway.app/?meme=abc#meme-result');
  assert.equal(new URL(link).origin, 'https://link.metamask.io');
  assert.equal(new URL(link).search, ''); assert.equal(new URL(link).hash, '');
  assert.equal(decodeURIComponent(new URL(link).pathname), '/dapp/chogchemy.up.railway.app/?meme=abc#meme-result');
  assert.throws(() => metamaskBrowserLink('javascript:alert(1)'));
  assert.throws(() => metamaskBrowserLink('https://name:secret@chogchemy.up.railway.app/'));
});

test('an expired free-export session clears the connected identity and never reads an image body', async () => {
  let address = 'creator', imageRead = false;
  await assert.rejects(requestCaptionExport('/api/memes/test/recaption', { topCaption: 'New joke' }, {
    fetcher: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Sign in again.' }), blob: async () => { imageRead = true; } }),
    onUnauthorized: () => { address = null; },
  }), error => error.status === 401 && /Sign in/.test(error.message));
  assert.equal(address, null); assert.equal(imageRead, false);
});
test('a free export that finishes after the wallet switches is discarded; a current PNG remains usable', async () => {
  let finish, address = 'creator'; const image = new Blob(['test PNG'], { type: 'image/png' });
  const pending = requestCaptionExport('/api/memes/test/recaption', { topCaption: 'Joke' }, {
    fetcher: async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'image/png' }), blob: () => new Promise(resolve => { finish = resolve; }) }),
    stillCurrent: () => address === 'creator',
  });
  await Promise.resolve(); address = 'different account'; finish(image);
  assert.equal(await pending, null);
  const current = await requestCaptionExport('/api/memes/test/recaption', {}, { fetcher: async () => new Response(image, { headers: { 'Content-Type': 'image/png' } }) });
  assert.equal(current.type, 'image/png'); assert.equal(await current.text(), 'test PNG');
});
