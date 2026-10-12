import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the browser's actual click/error flow, including the wallet event fired on 401.
const source = readFileSync(new URL('../public/fusion.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function browser(response) {
  const elements = new Map(), walletEvents = new Map();
  const element = () => ({ hidden: false, disabled: false, checked: false, textContent: '', value: '',
    handlers: new Map(), addEventListener(event, handler) { this.handlers.set(event, handler); },
    children: [], replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); }, after() {}, scrollIntoView() {}, setAttribute() {} });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let address = '0x1111111111111111111111111111111111111111', requests = 0;
  const record = { id: 'a'.repeat(64), state: 'generated', createdBy: address, parents: [{ tokenId: '11', owner: address }, { tokenId: '22', owner: address }], approvalPolicy: 'creator', collection: { address }, artwork: { url: '/artwork/test.png' }, invitationUrl: '/?fusion=test', characterUrl: '/characters/test', canGenerateComic: true, episodeChoices: [{ id: 'adventure', title: 'Their first adventure', chapters: ['Pack', 'Explore', 'Discover'] }, { id: 'school', title: 'The first school day', chapters: ['Pack', 'School', 'Pickup'] }, { id: 'birthday', title: 'A birthday surprise', chapters: ['Surprise', 'Wish', 'Gift'] }], episodes: [], ...response.record };
  const context = { document: { getElementById: get, createElement: element },
    window: { addEventListener(event, handler) { walletEvents.set(event, handler); } },
    location: { href: 'http://localhost:3091/' }, history: {}, URL, Date, console,
    setTimeout: () => 1, clearTimeout() {}, getWalletAddress: () => address,
    getChogPreview: async () => { throw new Error('Unused preview'); }, shareOrCopy: async () => 'copied',
    api: async path => {
      if (path.endsWith('/comic') || path.endsWith('/episode')) {
        requests++;
        if (response.status === 401) { address = null; walletEvents.get('chogchemy:wallet')(); }
        if (response.status) throw Object.assign(new Error(response.message), { status: response.status });
        return response.promise;
      }
      if (path === '/api/gallery') return { artworks: [] };
      if (path === '/api/fusions') return { requests: [] };
      if (path === '/api/drawing-usage') return response.usage || { used: 0, limit: 4, remaining: 4, globalRemaining: 10, resetsAt: Date.now() + 86400000 };
      return { ...record, canGenerateComic: !!address };
    },
  };
  runInNewContext(source + '\nthis.show = render;', context);
  context.show(record);
  return { get, record, show: context.show, click: () => get('generate-comic').handlers.get('click')(), clickEpisode: () => get('generate-episode').handlers.get('click')(), requests: () => requests };
}

test('comic request errors appear beside the button and allow a later retry', async () => {
  const ui = browser({ status: 429, message: 'The daily artwork limit has been reached.' });
  ui.click(); await flush();
  assert.equal(ui.get('comic-error').hidden, false);
  assert.match(ui.get('comic-error').textContent, /drawing limit.*local time/);
  assert.equal(ui.get('generate-comic').disabled, false);
  assert.match(ui.get('generate-comic').textContent, /Create the family comic/);
});

test('expired session errors survive the wallet reset and public record reload', async () => {
  const ui = browser({ status: 401, message: 'Connect and verify your wallet first.' });
  ui.click(); await flush();
  assert.equal(ui.get('comic-error').hidden, false);
  assert.match(ui.get('comic-error').textContent, /session expired.*sign in again/);
  assert.equal(ui.get('generate-comic').hidden, true);
  assert.equal(ui.get('family-comic-studio').hidden, false);
});

test('comic click shows immediate progress, blocks duplicates, and then renders drawing progress', async () => {
  let resolve;
  const ui = browser({ promise: new Promise(r => { resolve = r; }) });
  ui.click(); ui.click();
  assert.equal(ui.requests(), 1); assert.equal(ui.get('generate-comic').disabled, true);
  assert.match(ui.get('generate-comic').textContent, /Checking your family/);
  resolve({ ...ui.record, canGenerateComic: false, comic: { state: 'preparing' } }); await flush();
  assert.equal(ui.get('generate-comic').hidden, true);
  assert.match(ui.get('comic-status').textContent, /Preparing the parents/);
});

test('a saved child clearly points to its separate comic and displays remaining drawing requests', async () => {
  const ui = browser({}); await flush();
  assert.match(ui.get('invitation-state').textContent, /Child saved.*Comic not created/);
  assert.equal(ui.get('child-next').hidden, false);
  assert.match(ui.get('child-next-note').textContent, /separate drawing/);
  assert.match(ui.get('comic-status').textContent, /No comic yet/);
  assert.match(ui.get('drawing-remaining').textContent, /4 drawing requests left/);
});

test('an exhausted allowance disables new drawings and explains the local reset time beside the comic', async () => {
  const ui = browser({ usage: { used: 4, limit: 4, remaining: 0, globalRemaining: 6, resetsAt: Date.now() + 86400000 } }); await flush();
  assert.equal(ui.get('generate-comic').disabled, true);
  assert.match(ui.get('comic-budget').textContent, /limit is used up.*local time/);
  assert.match(ui.get('drawing-remaining').textContent, /0 drawing requests left/);
});

test('new episode click blocks duplicate requests and restores the saved family with an inline error', async () => {
  const ui = browser({ status: 429, message: 'The daily artwork limit has been reached.', record: { comic: { state: 'generated', artwork: { url: '/comics/test.png' } }, canGenerateEpisode: true } });
  assert.equal(ui.get('family-episodes-studio').hidden, false);
  assert.equal(ui.get('episode-story').value, 'adventure');
  ui.clickEpisode(); ui.clickEpisode(); await flush();
  assert.equal(ui.requests(), 1); assert.match(ui.get('episode-error').textContent, /drawing limit.*local time/);
  assert.equal(ui.get('episode-error').hidden, false); assert.equal(ui.get('comic-result').hidden, false);
});

test('saved and failed episode choices are unavailable while the next unused story remains selectable', async () => {
  const ui = browser({ record: { comic: { state: 'generated', artwork: { url: '/comics/test.png' } }, canGenerateEpisode: true, episodes: [{ id: 'b'.repeat(64), number: 2, storyId: 'adventure', title: 'Their first adventure', state: 'generated', artwork: { url: '/episodes/test.png', mode: 'fixture' } }, { id: 'c'.repeat(64), number: 3, storyId: 'school', title: 'The first school day', state: 'failed', error: 'Could not save this attempt.' }] } });
  await flush();
  assert.deepEqual(ui.get('episode-story').children.map(option => option.disabled), [true, true, false]);
  assert.equal(ui.get('episode-story').value, 'birthday'); assert.equal(ui.get('episode-list').children.length, 2);
  assert.equal(ui.get('generate-episode').disabled, false);
});
