import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachCaptionSuggestions } from '../public/caption-suggestions.js';
import { memeCatalog } from '../src/meme-catalog.mjs';

function element() {
  const handlers = new Map();
  return { value: '', disabled: false, textContent: '', placeholder: '',
    addEventListener(name, listener) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(listener); },
    dispatchEvent(event) { for (const listener of handlers.get(event.type) || []) listener(event); return !event.defaultPrevented; },
  };
}
function event(type, data = {}) { return Object.assign({ type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, cancelable: true }, data); }
function fixture() {
  const top = element(), bottom = element(), button = element(), status = element(); let changes = 0;
  const controller = attachCaptionSuggestions({ top, bottom, button, status, onChange: () => changes++ });
  // Exercise the classic two-bar contract separately from curated slot layouts.
  const template = memeCatalog.templates.find(template => !template.layout); controller.select(template);
  return { top, bottom, button, status, controller, template, changes: () => changes };
}
test('every one of the 100 templates has two different caption pairs within the server limits', () => {
  assert.equal(memeCatalog.templates.length, 100);
  for (const template of memeCatalog.templates) {
    assert.equal(template.captionSuggestions.length, 2);
    assert.notDeepEqual(template.captionSuggestions[0], template.captionSuggestions[1]);
    for (const idea of template.captionSuggestions) for (const caption of [idea.top, idea.bottom]) assert.ok(caption.trim() && caption.length <= 80 && !/[\u0000-\u001f\u007f]/.test(caption));
  }
});
test('Tab fills an empty caption pair and keeps normal keyboard focus navigation', () => {
  const f = fixture(), key = event('keydown', { key: 'Tab' });
  f.top.dispatchEvent(key);
  assert.equal(f.top.value, f.template.captionSuggestions[0].top); assert.equal(f.bottom.value, f.template.captionSuggestions[0].bottom);
  assert.equal(key.defaultPrevented, false); assert.match(f.status.textContent, /idea 1 of 2/);
  const next = event('keydown', { key: 'Tab' }); f.bottom.dispatchEvent(next);
  assert.equal(f.changes(), 2); assert.equal(next.defaultPrevented, false);
});
test('Space fills an empty field without inserting a stray space or filling twice', () => {
  const f = fixture(), key = event('keydown', { key: ' ' }); f.bottom.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true); assert.equal(f.top.value, f.template.captionSuggestions[0].top);
  const mobile = event('beforeinput', { inputType: 'insertText', data: ' ' }); f.bottom.dispatchEvent(mobile);
  assert.equal(f.changes(), 2); assert.equal(mobile.defaultPrevented, false);
});
test('mobile beforeinput without keydown fills captions and prevents the original space', () => {
  const f = fixture(), mobile = event('beforeinput', { inputType: 'insertText', data: ' ' }); f.top.dispatchEvent(mobile);
  assert.equal(mobile.defaultPrevented, true); assert.equal(f.bottom.value, f.template.captionSuggestions[0].bottom);
});
test('the button cycles suggestions while keeping hand-written text and ordinary spaces intact', () => {
  const f = fixture(); f.button.dispatchEvent(event('click'));
  f.top.value = 'My own joke with a space'; f.top.dispatchEvent(new Event('input'));
  const space = event('keydown', { key: ' ' }); f.top.dispatchEvent(space); assert.equal(space.defaultPrevented, false);
  f.button.dispatchEvent(event('click')); assert.equal(f.top.value, 'My own joke with a space'); assert.equal(f.bottom.value, f.template.captionSuggestions[1].bottom); assert.match(f.status.textContent, /own text was kept/);
  f.bottom.value = 'My second custom line'; f.bottom.dispatchEvent(new Event('input'));
  f.button.dispatchEvent(event('click')); assert.equal(f.bottom.value, 'My second custom line'); assert.match(f.status.textContent, /Clear a box/);
});
test('button cycles both ideas and returns to the first without creating any other action', () => {
  const f = fixture(); for (let i = 0; i < 3; i++) { f.button.dispatchEvent(event('click')); assert.equal(f.top.value, f.template.captionSuggestions[i % 2].top); assert.equal(f.bottom.value, f.template.captionSuggestions[i % 2].bottom); }
  assert.equal(f.changes(), 4);
});
test('changing template clears only old automatic captions and preserves edited captions', () => {
  const f = fixture(); f.button.dispatchEvent(event('click')); f.top.value = 'Keep my own caption'; f.top.dispatchEvent(new Event('input'));
  const next = memeCatalog.templates.find(t => t.name === 'This Is Fine'); f.controller.select(next);
  const expectedBottom = next.slotCaptionSuggestions[0].find(caption => caption.boxId === next.captionSlots[1].id).text;
  assert.equal(f.top.value, 'Keep my own caption'); assert.equal(f.bottom.value, ''); assert.equal(f.bottom.placeholder, expectedBottom);
  f.bottom.dispatchEvent(event('keydown', { key: 'Tab' })); assert.equal(f.top.value, 'Keep my own caption'); assert.equal(f.bottom.value, expectedBottom);
});
test('disabled drawing controls do not change a pending request’s captions', () => {
  const f = fixture(); f.button.disabled = true;
  f.button.dispatchEvent(event('click')); f.top.dispatchEvent(event('keydown', { key: 'Tab' })); f.bottom.dispatchEvent(event('beforeinput', { inputType: 'insertText', data: ' ' }));
  assert.equal(f.top.value, ''); assert.equal(f.bottom.value, ''); assert.equal(f.changes(), 1);
  f.button.disabled = false; f.top.disabled = true; f.button.dispatchEvent(event('click')); assert.equal(f.bottom.value, '');
});
test('Shift+Tab, modified keys, composition and non-space mobile typing stay native', () => {
  const f = fixture();
  for (const options of [{ key: 'Tab', shiftKey: true }, { key: ' ', ctrlKey: true }, { key: 'Tab', altKey: true }, { key: 'Tab', isComposing: true }, { key: ' ', repeat: true }]) {
    const key = event('keydown', options); f.top.dispatchEvent(key); assert.equal(key.defaultPrevented, false);
  }
  for (const options of [{ inputType: 'insertText', data: 'x' }, { inputType: 'insertCompositionText', data: ' ' }, { inputType: 'insertText', data: ' ', isComposing: true }]) {
    const mobile = event('beforeinput', options); f.top.dispatchEvent(mobile); assert.equal(mobile.defaultPrevented, false);
  }
  assert.equal(f.top.value, ''); assert.equal(f.changes(), 1);
});

test('curated four-slot ideas fill every visible caption and preserve a manually edited third slot', () => {
  const fields = Array.from({ length: 4 }, element), button = element(), status = element();
  const controller = attachCaptionSuggestions({ top: fields[0], bottom: fields[1], fields, button, status });
  const slots = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id }));
  const template = { id: 'four', name: 'Four panels', captionSlots: slots, slotCaptionSuggestions: [slots.map(slot => ({ boxId: slot.id, text: `First ${slot.id}` })), slots.map(slot => ({ boxId: slot.id, text: `Second ${slot.id}` }))] };
  controller.select(template); fields[3].dispatchEvent(event('keydown', { key: 'Tab' }));
  assert.deepEqual(fields.map(field => field.value), ['First a', 'First b', 'First c', 'First d']);
  fields[2].value = 'My own third panel'; fields[2].dispatchEvent(new Event('input'));
  button.dispatchEvent(event('click'));
  assert.deepEqual(fields.map(field => field.value), ['Second a', 'Second b', 'My own third panel', 'Second d']);
  controller.select({ id: 'other', name: 'Classic', captionSuggestions: [{ top: 'Top', bottom: 'Bottom' }] });
  assert.deepEqual(fields.map(field => field.value), ['', '', 'My own third panel', '']);
});
test('a hidden extra slot cannot trigger caption replacement in a two-slot template', () => {
  const fields = Array.from({ length: 4 }, element), button = element(), status = element();
  const controller = attachCaptionSuggestions({ top: fields[0], bottom: fields[1], fields, button, status });
  controller.select({ id: 'classic', name: 'Classic', captionSuggestions: [{ top: 'One', bottom: 'Two' }] });
  const key = event('keydown', { key: ' ' }); fields[3].dispatchEvent(key);
  assert.equal(key.defaultPrevented, false); assert.deepEqual(fields.map(field => field.value), ['', '', '', '']);
});
