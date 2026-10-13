import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../public/motion.js', import.meta.url), 'utf8');
function page(reduced) {
  const observers = [], listeners = {}, appended = []; let animated = 0, cancelled = 0, frameCancelled = 0;
  const element = () => ({ className: '', isConnected: true, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, querySelectorAll: () => [], classList: { contains: () => false, add() {}, remove() {} } });
  const hero = { ...element(), hidden: false, animate() { animated++; return { finished: new Promise(() => {}), cancel() { cancelled++; } }; } };
  const media = { matches: reduced, addEventListener(_, callback) { listeners.preference = callback; } };
  const context = { window: { matchMedia: () => media, innerHeight: 800, scrollY: 0, IntersectionObserver: function() {}, addEventListener() {} },
    document: { documentElement: { scrollHeight: 1600 }, createElement: element, body: { append: e => appended.push(e) }, querySelector: () => element(), addEventListener() {},
      querySelectorAll(selector) { return selector.includes('.intro-copy') ? [hero] : []; } },
    IntersectionObserver: class { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe() {} unobserve() {} disconnect() { this.disconnected = true; } },
    MutationObserver: class { observe() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() { frameCancelled++; }, Element: class {} };
  runInNewContext(source, context);
  return { observers, media, hero, appended, stats: () => ({ animated, cancelled, frameCancelled }), change(value) { media.matches = value; listeners.preference(); } };
}
test('reduced motion never starts decorative observers or animations and leaves content visible', () => {
  const p = page(true); assert.equal(p.observers.length, 0); assert.equal(p.stats().animated, 0); assert.equal(p.hero.hidden, false);
  p.change(false); assert.equal(p.observers.length, 2); p.observers[0].callback([{ isIntersecting: true, target: p.hero }]); assert.equal(p.stats().animated, 1); assert.equal(p.hero.hidden, false);
});
test('enabling reduced motion while the page is open cancels active animation and keeps content usable', () => {
  const p = page(false); p.observers[0].callback([{ isIntersecting: true, target: p.hero }]);
  p.change(true); assert.equal(p.stats().cancelled, 1); assert.ok(p.observers.every(o => o.disconnected)); assert.equal(p.hero.hidden, false);
  p.observers[0].callback([{ isIntersecting: true, target: { ...p.hero } }]); assert.equal(p.stats().animated, 1);
});
