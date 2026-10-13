// Cosmetic enhancement only. Creation, wallet and download actions keep their own handlers.
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const revealed = new WeakSet(), zoomable = new WeakSet();
let observed = new WeakSet();
const visibleImages = new Set(), animations = new Set();
const revealSelector = '.intro-copy, .intro-mark, .demo-intro, .section-title, .studio-steps > a, .token-previews article, .invitation-parents article, .invitation-item, .gallery-card, .sticker-card, .character-copy, .next-step, .simple-about';
const artSelector = '.intro-mark img, .gallery-card img, .parent-art img, .character-art img, .comic-art img, #generated-image, #comic-image, .sticker-card img';
const zoomSelector = '.character-art > img, .comic-art > img, #generated-image, #comic-image';
let revealObserver, artObserver, frame = 0, scanFrame = 0, viewer = null, progress = null;

function animate(element, keyframes, options) {
  if (preference.matches || !element.animate) return;
  const animation = element.animate(keyframes, options);
  animations.add(animation);
  animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
}
function tick() {
  frame = 0;
  if (preference.matches) return;
  const height = window.innerHeight;
  const distance = Math.max(0, document.documentElement.scrollHeight - height);
  progress?.style.setProperty('--scroll-progress', distance ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0);
  for (const image of visibleImages) {
    if (!image.isConnected) { visibleImages.delete(image); continue; }
    const box = image.parentElement.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (height - box.top) / (height + box.height)));
    image.style.setProperty('--art-scale', (0.985 + 0.025 * Math.sin(position * Math.PI)).toFixed(4));
    image.style.setProperty('--art-y', `${((position - 0.5) * 8).toFixed(2)}px`);
  }
}
function schedule() { if (!frame && !preference.matches) frame = requestAnimationFrame(tick); }
function setupObservers() {
  if (preference.matches || !window.IntersectionObserver) return;
  revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || revealed.has(entry.target)) continue;
      revealed.add(entry.target); revealObserver.unobserve(entry.target);
      // Nothing is hidden while waiting for an observer or if scripts fail.
      animate(entry.target, [{ opacity: 0.3, transform: 'translateY(20px) scale(.985)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }, { threshold: 0.05 });
  artObserver = new IntersectionObserver(entries => {
    for (const entry of entries) { if (entry.isIntersecting) visibleImages.add(entry.target); else visibleImages.delete(entry.target); }
    schedule();
  }, { rootMargin: '40px' });
}
function createViewer() {
  const dialog = document.createElement('dialog'); dialog.className = 'artwork-viewer';
  dialog.setAttribute('aria-labelledby', 'artwork-viewer-title');
  const toolbar = document.createElement('div'); toolbar.className = 'artwork-viewer-toolbar';
  const title = document.createElement('h2'); title.id = 'artwork-viewer-title'; title.textContent = 'Your artwork';
  const zoom = document.createElement('button'); zoom.type = 'button'; zoom.className = 'secondary'; zoom.textContent = 'Zoom in +'; zoom.setAttribute('aria-pressed', 'false');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close ×'; close.autofocus = true;
  const stage = document.createElement('div'); stage.className = 'artwork-viewer-stage'; stage.tabIndex = 0; stage.setAttribute('aria-label', 'Artwork preview. Scroll to explore when zoomed.');
  const image = document.createElement('img'); stage.append(image); toolbar.append(title, zoom, close); dialog.append(toolbar, stage);
  zoom.addEventListener('click', () => { const enlarged = stage.classList.toggle('is-zoomed'); zoom.textContent = enlarged ? 'Zoom out −' : 'Zoom in +'; zoom.setAttribute('aria-pressed', String(enlarged)); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { document.documentElement.classList.remove('artwork-viewer-open'); image.removeAttribute('src'); schedule(); });
  document.body.append(dialog);
  return { dialog, image, stage, zoom };
}
function addZoom(image) {
  if (zoomable.has(image) || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
  zoomable.add(image);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'artwork-enlarge secondary'; button.textContent = 'Enlarge artwork ↗';
  button.setAttribute('aria-label', `Enlarge artwork: ${image.alt || 'saved artwork'}`);
  button.addEventListener('click', () => {
    if (!image.getAttribute('src')) return;
    viewer ||= createViewer();
    viewer.stage.classList.remove('is-zoomed'); viewer.zoom.textContent = 'Zoom in +'; viewer.zoom.setAttribute('aria-pressed', 'false');
    viewer.image.src = image.currentSrc || image.src; viewer.image.alt = image.alt;
    viewer.dialog.showModal(); document.documentElement.classList.add('artwork-viewer-open');
    animate(viewer.dialog, [{ opacity: 0, transform: 'translateY(12px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 220, easing: 'ease-out' });
  });
  image.after(button);
}
function scan() {
  scanFrame = 0;
  document.querySelectorAll(zoomSelector).forEach(addZoom);
  if (!revealObserver || preference.matches) return;
  document.querySelectorAll(revealSelector).forEach(element => { if (!observed.has(element)) { observed.add(element); revealObserver.observe(element); } });
  document.querySelectorAll(artSelector).forEach(image => { if (!image.classList.contains('motion-art')) { image.classList.add('motion-art'); artObserver.observe(image); } });
  schedule();
}
function reducedMotionChanged() {
  if (frame) cancelAnimationFrame(frame); frame = 0;
  animations.forEach(animation => animation.cancel()); animations.clear();
  revealObserver?.disconnect(); artObserver?.disconnect(); revealObserver = artObserver = null; visibleImages.clear();
  observed = new WeakSet();
  document.querySelectorAll('.motion-art').forEach(image => { image.classList.remove('motion-art'); image.style.removeProperty('--art-scale'); image.style.removeProperty('--art-y'); });
  // All content stays visible when preferences change; only newly mounted cards reveal again.
  setupObservers(); scan();
}
progress = document.createElement('div'); progress.className = 'scroll-progress'; progress.setAttribute('aria-hidden', 'true'); document.body.append(progress);
setupObservers(); scan();
window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule, { passive: true });
preference.addEventListener('change', reducedMotionChanged);
document.addEventListener('click', event => {
  const target = event.target.closest?.('button, a.button, .studio-steps > a');
  if (target && !target.disabled && !preference.matches) animate(target, [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
});
new MutationObserver(() => { if (!scanFrame) scanFrame = requestAnimationFrame(scan); }).observe(document.querySelector('main') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'src'] });
