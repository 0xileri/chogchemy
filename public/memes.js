import { api, getWalletAddress } from './wallet.js';
import { shareOrCopy } from './share.js';
const $ = id => document.getElementById(id);
let templates = [], selected = null, tokenId = '', current = null, busy = false, allowance = null, nonce = null, revision = 0, poll = null, shown = 24;
const stateLabel = record => ({ preparing: 'Preparing your Chog meme', generating: 'Drawing your Chog meme', generated: 'Your Chog meme is saved', approved: 'Meme preparation needs another try', generation_failed: 'The meme was not saved', cancelled: 'Preparation cancelled', invalidated: 'Chog ownership changed', expired: 'Meme request expired' })[record.state] || 'Meme in progress';
function newNonce() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }
function error(text = '') { $('meme-create-error').textContent = text; $('meme-create-error').hidden = !text; }
function controls() {
  const address = getWalletAddress(), pending = ['preparing', 'generating'].includes(current?.state);
  const atLimit = allowance && (!allowance.remaining || !allowance.globalRemaining);
  $('create-meme').disabled = busy || pending || !address || !tokenId || !selected || atLimit;
  $('create-meme').textContent = busy ? 'Checking your Chog…' : pending ? 'Meme is drawing…' : 'Create my Chog meme ✳';
  $('meme-chog-selection').textContent = tokenId && address ? `Starring your Chog #${tokenId}. Change it using your owned Chogs above.` : 'Connect your wallet above to choose the Chog starring in your meme.';
  $('meme-allowance').textContent = allowance && address ? `${allowance.remaining} of ${allowance.limit} drawing requests left today. Memes share the allowance with family creations.${atLimit ? ` Try again ${new Date(allowance.resetsAt).toLocaleString()} (your local time).` : ''}` : 'Your drawing allowance appears after wallet verification.';
  $('meme-refresh').disabled = busy;
  $('meme-retry').hidden = !current?.canGenerate || !address; $('meme-retry').disabled = busy || atLimit;
  $('meme-cancel').hidden = !current?.canCancel || !address; $('meme-cancel').disabled = busy;
  for (const id of ['meme-role', 'meme-top-caption', 'meme-bottom-caption']) $(id).disabled = busy || pending;
  document.querySelectorAll('.meme-template-card button').forEach(b => { b.disabled = busy || pending; });
}
async function usage() {
  const address = getWalletAddress(); if (!address) { allowance = null; controls(); return; }
  try { const result = await api('/api/drawing-usage'); if (address === getWalletAddress()) allowance = result; } catch { if (address === getWalletAddress()) allowance = null; }
  controls();
}
function choose(template) {
  if (busy || ['preparing', 'generating'].includes(current?.state)) return;
  selected = template; nonce = null; error();
  $('meme-selected-name').textContent = template.name; $('meme-selected-template').src = template.imageUrl; $('meme-selected-template').alt = `${template.name} — original template`; $('meme-selected-template').hidden = false;
  $('meme-template-source').href = template.sourceUrl; $('meme-template-source').hidden = false;
  document.querySelectorAll('.meme-template-card').forEach(card => {
    const chosen = card.dataset.template === template.id; card.classList.toggle('is-selected', chosen);
    const button = card.querySelector('button'); button.setAttribute('aria-pressed', String(chosen)); button.textContent = chosen ? 'Selected ✓' : 'Use this meme ↗';
  });
  controls();
}
function renderTemplates() {
  const query = $('meme-search').value.trim().toLowerCase(), category = $('meme-category').value;
  const filtered = templates.filter(t => t.name.toLowerCase().includes(query) && (category === 'all' || t.category === category));
  $('meme-template-grid').replaceChildren(); $('meme-template-count').textContent = `${filtered.length} template${filtered.length === 1 ? '' : 's'}${query || category !== 'all' ? filtered.length === 1 ? ' matches your search' : ' match your search' : ' ready to browse'}. Showing ${Math.min(shown, filtered.length)}.`;
  for (const template of filtered.slice(0, shown)) {
    const card = document.createElement('article'); card.className = 'meme-template-card'; card.dataset.template = template.id;
    const image = document.createElement('img'); image.src = template.imageUrl; image.alt = `${template.name} original meme template`; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
    const title = document.createElement('h3'); title.textContent = template.name;
    const categoryLabel = document.createElement('p'); categoryLabel.className = 'note'; categoryLabel.textContent = template.category;
    const button = document.createElement('button'); button.type = 'button'; const picked = selected?.id === template.id;
    button.textContent = picked ? 'Selected ✓' : 'Use this meme ↗'; button.setAttribute('aria-label', `Use ${template.name}`); button.setAttribute('aria-pressed', String(picked)); card.classList.toggle('is-selected', picked);
    button.addEventListener('click', () => { choose(template); $('meme-studio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
    card.append(image, title, categoryLabel, button); $('meme-template-grid').append(card);
  }
  $('meme-show-more').hidden = shown >= filtered.length;
  if (!filtered.length) $('meme-template-grid').textContent = 'No matching templates. Try another name or category.';
  controls();
}
function render(record) {
  current = record; $('meme-result').hidden = false; $('meme-result-title').textContent = stateLabel(record);
  $('meme-result-status').textContent = record.error || (record.state === 'generated' ? `Saved: ${record.template.name}, starring Chog #${record.tokenId}. Download it or share its public page below.` : record.state === 'preparing' ? 'Loading your NFT and the template. You can still cancel preparation.' : record.state === 'generating' ? 'Your Chog is stepping into the scene. This can take a few minutes. Find it later in My memes.' : 'Your saved request is shown here.');
  $('meme-artwork').hidden = !record.artwork; $('meme-result-actions').hidden = !record.artwork;
  if (record.artwork) {
    $('meme-result-image').src = record.artwork.url; $('meme-result-image').alt = `${record.template.name}, starring Chog #${record.tokenId}`;
    $('meme-result-caption').textContent = `${record.artwork.mode === 'fixture' ? 'TEST MEME · Synthetic artwork, not AI output' : 'AI Chog meme'} · ${record.template.name} · Chog #${record.tokenId}. Artwork only; no new NFT minted.`;
    $('meme-download').href = record.artwork.url; $('meme-public-link').href = record.pageUrl;
  }
  $('meme-record-text').textContent = `Requested ${new Date(record.createdAt).toLocaleString()} · Ownership checked ${new Date(record.checkedAt).toLocaleString()} at Monad block ${record.checkedBlock} · Style ${record.artDirection} · Style hash ${record.artDirectionHash}${record.artwork ? ` · Artwork SHA-256 ${record.artwork.digest}` : ''}`;
  const url = new URL(location.href); url.searchParams.set('meme', record.id); history.replaceState(null, '', url);
  controls(); clearTimeout(poll);
  if (['preparing', 'generating'].includes(record.state)) poll = setTimeout(() => void load(record.id), 4000);
}
async function load(id) {
  const attempt = revision;
  try { const record = await api(`/api/memes/${id}`); if (attempt === revision) { render(record); if (record.artwork) { await listMine(); await gallery(); } } }
  catch (e) { if (attempt === revision) { error(e.message); if (current?.id === id && ['preparing', 'generating'].includes(current.state)) { $('meme-result-status').textContent = 'Could not refresh progress. Try Refresh progress; no new drawing is requested.'; poll = setTimeout(() => void load(id), 8000); } } }
}
async function listMine() {
  const address = getWalletAddress(); if (!address) return;
  try {
    const result = await api('/api/memes'); if (address !== getWalletAddress()) return;
    $('my-memes-hint').textContent = 'Open a saved meme to continue or download it.'; $('my-memes-list').replaceChildren();
    for (const record of result.memes) {
      const link = document.createElement('a'); link.className = 'invitation-item'; link.href = record.studioUrl;
      const title = document.createElement('strong'); title.textContent = `${record.template.name} · Chog #${record.tokenId}`;
      const state = document.createElement('span'); state.textContent = stateLabel(record); link.append(title, state);
      link.addEventListener('click', event => { event.preventDefault(); if (busy) return; void load(record.id).then(() => $('meme-result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); }); $('my-memes-list').append(link);
    }
    if (!result.memes.length) $('my-memes-hint').textContent = 'No memes saved yet. Pick a template to start.';
  } catch (e) { if (address === getWalletAddress()) $('my-memes-hint').textContent = e.message; }
}
async function gallery() {
  try {
    const data = await api('/api/meme-gallery'); $('meme-gallery-grid').replaceChildren();
    for (const record of data.memes) {
      const link = document.createElement('a'); link.className = 'gallery-card'; link.href = record.pageUrl;
      const image = document.createElement('img'); image.src = record.artwork.url; image.alt = `${record.template.name} starring Chog #${record.tokenId}`; image.loading = 'lazy';
      const title = document.createElement('p'); title.textContent = `${record.artwork.mode === 'fixture' ? 'TEST · ' : ''}${record.template.name} · Chog #${record.tokenId}`; link.append(image, title); $('meme-gallery-grid').append(link);
    }
    if (!data.memes.length) $('meme-gallery-grid').textContent = 'Your Chog could be the first star on the meme wall.';
  } catch { $('meme-gallery-grid').textContent = 'The meme wall is temporarily unavailable.'; }
}
async function perform(work) {
  if (busy) return; const attempt = revision; busy = true; error(); controls();
  try { const result = await work(); if (attempt === revision) { render(result); await listMine(); await usage(); $('meme-result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } }
  catch (e) { if (attempt === revision || e.status === 401) error(e.status === 401 ? 'Your wallet session expired. Reconnect to continue.' : e.message); }
  finally { busy = false; controls(); }
}
$('create-meme-form').addEventListener('submit', event => {
  event.preventDefault(); if (!getWalletAddress() || !tokenId || !selected || busy || ['preparing', 'generating'].includes(current?.state)) return;
  nonce ||= newNonce();
  void perform(() => api('/api/memes', { tokenId, templateId: selected.id, nonce, characterRole: $('meme-role').value, topCaption: $('meme-top-caption').value, bottomCaption: $('meme-bottom-caption').value }));
});
for (const id of ['meme-role', 'meme-top-caption', 'meme-bottom-caption']) $(id).addEventListener('input', () => { nonce = null; });
$('meme-search').addEventListener('input', () => { shown = 24; renderTemplates(); }); $('meme-category').addEventListener('change', () => { shown = 24; renderTemplates(); });
$('meme-show-more').addEventListener('click', () => { shown += 24; renderTemplates(); });
$('meme-refresh').addEventListener('click', () => { if (current && !busy) void load(current.id); });
$('meme-retry').addEventListener('click', () => { if (current) void perform(() => api(`/api/memes/${current.id}/generate`, {})); });
$('meme-cancel').addEventListener('click', () => { if (current) void perform(() => api(`/api/memes/${current.id}/cancel`, {})); });
$('meme-new').addEventListener('click', () => {
  if (busy) return; revision++; current = null; nonce = null; clearTimeout(poll); $('meme-result').hidden = true; error();
  const url = new URL(location.href); url.searchParams.delete('meme'); history.replaceState(null, '', url); controls(); $('meme-studio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
$('meme-share').addEventListener('click', () => { if (!current?.artwork) return; void shareOrCopy({ title: `${current.template.name} · Chogchemy`, text: `Chog #${current.tokenId} is the main character.`, url: current.pageUrl }).then(action => { $('meme-result-status').textContent = action === 'copied' ? 'Public meme link copied. Send it to your chat.' : action === 'cancelled' ? 'Sharing cancelled. Your meme is still saved.' : 'Meme shared.'; }).catch(e => error(e.message)); });
window.addEventListener('chogchemy:token', event => { tokenId = event.detail.tokenId || ''; nonce = null; controls(); });
window.addEventListener('chogchemy:wallet', () => { revision++; tokenId = ''; allowance = null; controls(); $('my-memes-list').replaceChildren(); $('my-memes-hint').textContent = 'Connect your wallet to reopen your saved memes and work in progress.'; if (getWalletAddress()) { void usage(); void listMine(); if (current) void load(current.id); } });
void (async () => { try { const data = await api('/api/meme-templates'); templates = data.templates; renderTemplates(); if (templates.length) choose(templates[0]); } catch { $('meme-template-count').textContent = 'Templates are temporarily unavailable. Refresh in a moment.'; } })();
const saved = new URL(location.href).searchParams.get('meme'); if (saved && /^[a-f0-9]{64}$/.test(saved)) void load(saved);
void gallery(); controls();
