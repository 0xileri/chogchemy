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
    replaceChildren() {}, append() {}, after() {}, scrollIntoView() {} });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let address = '0x1111111111111111111111111111111111111111', requests = 0;
  const record = { id: 'a'.repeat(64), state: 'generated', createdBy: address, parents: [{ tokenId: '11', owner: address }, { tokenId: '22', owner: address }], approvalPolicy: 'creator', collection: { address }, artwork: { url: '/artwork/test.png' }, invitationUrl: '/?fusion=test', characterUrl: '/characters/test', canGenerateComic: true };
  const context = { document: { getElementById: get, createElement: element },
    window: { addEventListener(event, handler) { walletEvents.set(event, handler); } },
    location: { href: 'http://localhost:3091/' }, history: {}, URL, Date, console,
    setTimeout: () => 1, clearTimeout() {}, getWalletAddress: () => address,
    getChogPreview: async () => { throw new Error('Unused preview'); }, shareOrCopy: async () => 'copied',
    api: async path => {
      if (path.endsWith('/comic')) {
        requests++;
        if (response.status === 401) { address = null; walletEvents.get('chogchemy:wallet')(); }
        if (response.status) throw Object.assign(new Error(response.message), { status: response.status });
        return response.promise;
      }
      if (path === '/api/gallery') return { artworks: [] };
      if (path === '/api/fusions') return { requests: [] };
      return { ...record, canGenerateComic: !!address };
    },
  };
  runInNewContext(source + '\nthis.show = render;', context);
  context.show(record);
  return { get, record, click: () => get('generate-comic').handlers.get('click')(), requests: () => requests };
}

test('comic request errors appear beside the button and allow a later retry', async () => {
  const ui = browser({ status: 429, message: 'The daily artwork limit has been reached.' });
  ui.click(); await flush();
  assert.equal(ui.get('comic-error').hidden, false);
  assert.match(ui.get('comic-error').textContent, /daily artwork limit/);
  assert.equal(ui.get('generate-comic').disabled, false);
  assert.match(ui.get('generate-comic').textContent, /Create our family comic/);
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
