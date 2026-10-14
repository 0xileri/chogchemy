import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareOrCopy } from '../public/share.js';

test('meme object and family string sharing both copy the actual public URL', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(text) { copied.push(text); } } } });
  try {
    assert.equal(await shareOrCopy({ title: 'A Chog meme', text: 'The joke', url: 'https://example.com/memes/1' }), 'copied');
    assert.equal(await shareOrCopy('https://example.com/characters/2', 'A family'), 'copied');
    assert.deepEqual(copied, ['https://example.com/memes/1', 'https://example.com/characters/2']);
    await assert.rejects(shareOrCopy({ url: 'javascript:alert(1)' }), /public page link/);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});

test('native sharing preserves the meme title and text and cancellation does not copy', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { async share(data) { calls.push(data); }, clipboard: { async writeText() { throw new Error('Unexpected copy'); } } } });
  try {
    const data = { title: 'Chog', text: 'My joke', url: 'https://example.com/memes/3' };
    assert.equal(await shareOrCopy(data), 'shared'); assert.deepEqual(calls, [data]);
    navigator.share = async () => { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; };
    assert.equal(await shareOrCopy(data), 'cancelled');
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});

test('unavailable native sharing and denied clipboard require manual copying, without claiming success', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { async share() { throw new Error('Sharing unavailable'); }, clipboard: { async writeText() { throw new Error('Clipboard denied'); } } } });
  try { assert.equal(await shareOrCopy({ url: 'https://example.com/memes/4', title: 'A Chog meme' }), 'manual'); }
  finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});
