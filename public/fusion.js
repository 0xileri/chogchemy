import { api, getWalletAddress, signWalletMessage, getChogPreview } from './wallet.js';

const $ = id => document.getElementById(id);
let current = null, message = null, operation = 0, busy = false, poll = null;
const status = text => { $('fusion-status').textContent = text; };
const short = address => `${address.slice(0, 6)}…${address.slice(-4)}`;
const active = request => ['awaiting_approvals', 'approved'].includes(request.state) && request.expires > Date.now();
const previewStates = { a: { version: 0, timer: null }, b: { version: 0, timer: null } };
function previewParent(side, immediate = false) {
  const state = previewStates[side], version = ++state.version;
  clearTimeout(state.timer);
  const tokenId = $(`fusion-parent-${side}`).value.trim(), card = $(`parent-preview-${side}`);
  const art = $(`parent-art-${side}`), title = $(`parent-title-${side}`), note = $(`parent-note-${side}`);
  art.replaceChildren(); card.hidden = !tokenId || !getWalletAddress();
  if (card.hidden) return;
  title.textContent = `Token #${tokenId}`; note.textContent = '';
  if (!/^(0|[1-9][0-9]{0,77})$/.test(tokenId)) { note.textContent = 'Enter a valid numeric token ID.'; return; }
  note.textContent = 'Loading artwork…'; art.textContent = '✳';
  state.timer = setTimeout(async () => {
    try {
      const preview = await getChogPreview(tokenId);
      if (version !== state.version || !getWalletAddress()) return;
      title.textContent = preview.name; note.textContent = `On-chain token #${tokenId} · Artwork preview`;
      const image = document.createElement('img'); image.alt = `${preview.name} · token #${tokenId}`; image.src = preview.imageUrl;
      image.addEventListener('error', () => { if (version === state.version) { art.textContent = 'Artwork unavailable'; note.textContent = 'Try changing the token ID or refreshing.'; } });
      art.replaceChildren(image);
    } catch (error) { if (version === state.version) { art.textContent = 'Artwork unavailable'; note.textContent = error.message; } }
  }, immediate ? 0 : 450);
}
function resetMessage() { message = null; $('approval-review').hidden = true; $('approval-confirm').checked = false; $('sign-fusion').disabled = true; }
function controls() {
  const address = getWalletAddress(), role = current?.parents.findIndex(p => p.owner === address) ?? -1;
  $('create-fusion').disabled = busy || !address;
  $('refresh-invitation').disabled = busy;
  $('review-approval').hidden = !current || !active(current) || role < 0 || !!current.parents[role].approvedAt;
  $('review-approval').disabled = busy;
  $('cancel-invitation').hidden = !current || !active(current) || role < 0;
  $('cancel-invitation').disabled = busy;
  $('recheck-invitation').hidden = !current || !active(current) || role < 0;
  $('recheck-invitation').disabled = busy;
  $('sign-fusion').disabled = busy || !$('approval-confirm').checked || !message || !address;
  $('wallet-hint').hidden = !!address;
  $('my-invitations').hidden = !address;
  $('generate-artwork').hidden = !current?.generationAvailable || role < 0;
  $('generate-artwork').disabled = busy;
  if (current?.state === 'preparing' && role >= 0) $('cancel-invitation').hidden = false;
}
function render(request) {
  current = request; resetMessage(); $('invitation-card').hidden = false;
  $('invitation-link').value = request.invitationUrl;
  $('invitation-state').textContent = ({ awaiting_approvals: 'Waiting for both holders', approved: 'Both holders approved', preparing: 'Preparing parent artwork', generating: 'Creating your new character…', generated: 'Meet your new character.', generation_failed: 'Artwork could not be saved', cancelled: 'Cancelled', invalidated: 'Ownership changed', expired: 'Expired' })[request.state] || request.state;
  $('invitation-parents').replaceChildren();
  for (const [index, parent] of request.parents.entries()) {
    const card = document.createElement('article');
    const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = `PARENT ${index === 0 ? 'A' : 'B'}`;
    const title = document.createElement('h3'); title.textContent = `Token #${parent.tokenId}`;
    const holder = document.createElement('p'); holder.textContent = `Holder ${short(parent.owner)}`; holder.title = parent.owner;
    const approval = document.createElement('p'); approval.className = 'approval-state'; approval.textContent = parent.approvedAt ? `Signed ${new Date(parent.approvedAt).toLocaleString()}` : 'Awaiting signed approval';
    const link = document.createElement('a'); link.textContent = 'View Chog ↗'; link.href = `https://opensea.io/item/monad/${request.collection.address}/${parent.tokenId}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    card.append(label, title, holder, approval, link); $('invitation-parents').append(card);
    if (getWalletAddress()) void getChogPreview(parent.tokenId).then(preview => {
      if (!card.isConnected || current?.id !== request.id) return;
      const image = document.createElement('img'); image.className = 'invitation-art'; image.alt = preview.name; image.src = preview.imageUrl;
      image.addEventListener('error', () => image.remove()); label.after(image);
    }).catch(() => {});
  }
  $('invitation-expiry').textContent = `Expires ${new Date(request.expires).toLocaleString()} · Art direction ${request.artDirection}`;
  $('ownership-check').textContent = `Ownership last checked ${new Date(request.checkedAt).toLocaleString()} at Monad block ${request.checkedBlock}.`;
  $('ready-note').hidden = request.state !== 'approved';
  $('ready-note').textContent = request.generation?.error || (request.generationAvailable ? 'Both holders approved. Create one character using these two Chogs. Ownership is checked again before the studio begins.' : 'Your approvals are saved. The artwork studio is not available for this invitation yet.');
  $('generation-note').hidden = !['preparing', 'generating', 'generation_failed'].includes(request.state);
  $('generation-note').textContent = request.generation?.error || (request.state === 'preparing' ? 'Loading the two parent images. Either holder can still cancel during preparation.' : 'The studio is drawing. This can take a few minutes; you can leave and return to this link.');
  $('generated-result').hidden = !request.artwork;
  if (request.artwork) {
    $('generated-image').src = request.artwork.url;
    $('download-artwork').href = request.artwork.url;
    $('artwork-caption').textContent = `${request.artwork.mode === 'fixture' ? 'TEST ARTWORK · Synthetic output' : 'AI character artwork'} · Parents #${request.parents.map(p => p.tokenId).join(' + #')} · ${request.artDirection}. An artwork record; no NFT has been minted.`;
    void gallery();
  }
  clearTimeout(poll);
  if (['preparing', 'generating'].includes(request.state)) poll = setTimeout(() => { if (!document.hidden && !busy && current?.id === request.id) void load(request.id); else if (current?.id === request.id) render(current); }, 5000);
  const address = getWalletAddress();
  $('invitation-role').textContent = !address ? 'Connect the wallet holding either parent to review and sign.' : request.parents.some(p => p.owner === address) ? 'This wallet is one of the two invited holders.' : 'This wallet is not one of the invited holders. Switch to the wallet holding a listed parent.';
  controls();
}
async function load(id, updateUrl = false) {
  const attempt = ++operation;
  status('Loading invitation…'); resetMessage();
  try {
    const request = await api(`/api/fusions/${encodeURIComponent(id)}`);
    if (attempt !== operation) return;
    render(request);
    if (updateUrl) { const url = new URL(location.href); url.searchParams.set('fusion', request.id); url.hash = 'fusion'; history.replaceState(null, '', url); }
    status(request.state === 'approved' ? 'Both signatures are saved. Review the studio options below.' : 'Invitation loaded. Review the parents and status below.');
  } catch (error) { if (attempt === operation) { current = null; $('invitation-card').hidden = true; status(error.message); controls(); } }
}
async function listMine() {
  const address = getWalletAddress();
  if (!address) { $('invitation-list').replaceChildren(); return; }
  try {
    const data = await api('/api/fusions');
    if (getWalletAddress() !== address) return;
    $('invitation-list').replaceChildren();
    for (const request of data.requests) {
      const link = document.createElement('a'); link.className = 'invitation-item';
      link.href = request.invitationUrl;
      link.textContent = `#${request.parents[0].tokenId} + #${request.parents[1].tokenId} · ${request.state.replaceAll('_', ' ')}`;
      link.addEventListener('click', event => { event.preventDefault(); void load(request.id, true); });
      $('invitation-list').append(link);
    }
    if (!data.requests.length) $('invitation-list').textContent = 'No invitations for this wallet yet.';
  } catch (error) { if (getWalletAddress() === address) $('invitation-list').textContent = error.message; }
}
async function perform(work) {
  if (busy) return;
  busy = true; controls();
  const attempt = operation;
  try { await work(); }
  catch (error) {
    if (attempt === operation) {
      if (error.status === 409 && current) await load(current.id);
      status(error.code === 4001 ? 'Approval cancelled in your wallet. Nothing was signed or saved.' : error.message);
    }
  }
  finally { busy = false; controls(); }
}
$('new-fusion').addEventListener('submit', event => {
  event.preventDefault();
  void perform(async () => {
    if (!getWalletAddress()) throw new Error('Connect your wallet to create an invitation.');
    const attempt = operation;
    status('Checking both parents on Monad…');
    const request = await api('/api/fusions', { parentA: $('fusion-parent-a').value.trim(), parentB: $('fusion-parent-b').value.trim() });
    if (attempt !== operation) return;
    render(request);
    const url = new URL(location.href); url.searchParams.set('fusion', request.id); url.hash = 'fusion'; history.replaceState(null, '', url);
    status('Invitation created. Review and sign your approval, then share the link with your partner.');
    await listMine();
  });
});
$('review-approval').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation; if (!id) return;
  status('Checking both holders before preparing your approval…');
  const data = await api(`/api/fusions/${id}/message`, {});
  if (attempt !== operation || current?.id !== id) return;
  render(data.request); message = data.message;
  $('approval-message').textContent = message; $('approval-review').hidden = false;
  status('Read the exact approval below. Signing authorizes only this fusion request.');
}));
$('approval-confirm').addEventListener('change', controls);
$('sign-fusion').addEventListener('click', () => void perform(async () => {
  if (!message || !$('approval-confirm').checked || !current) return;
  const id = current.id, attempt = operation, expectedAddress = getWalletAddress();
  status('Review and sign this fusion approval in your wallet.');
  const signature = await signWalletMessage(message);
  if (attempt !== operation || getWalletAddress() !== expectedAddress) throw new Error('Wallet or invitation changed. Review again.');
  const request = await api(`/api/fusions/${id}/approve`, { signature });
  if (attempt !== operation) return;
  render(request); status(request.state === 'approved' ? 'Both holders approved. Your character is ready to create.' : 'Your signature is saved. Waiting for the other holder.');
  await listMine();
}));
$('cancel-invitation').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation; if (!id) return;
  const request = await api(`/api/fusions/${id}/cancel`, {});
  if (attempt !== operation) return;
  render(request); status('Invitation cancelled. Its signatures cannot be used to proceed.'); await listMine();
}));
$('recheck-invitation').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation; if (!id) return;
  try {
    const request = await api(`/api/fusions/${id}/recheck`, {});
    if (attempt !== operation) return;
    render(request); status('Both Chogs are still owned by the invited holders.');
  } catch (error) { if (attempt === operation) { await load(id); status(error.message); } }
}));
$('refresh-invitation').addEventListener('click', () => { if (!busy && current) void load(current.id); });
$('generate-artwork').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation; if (!id) return;
  status('Checking consent and both owners before preparing the artwork…');
  const request = await api(`/api/fusions/${id}/generate`, {});
  if (attempt !== operation || current?.id !== id) return;
  render(request); status('Your fusion is underway. This page will update as it progresses.');
}));
async function gallery() {
  try {
    const data = await api('/api/gallery');
    $('live-gallery').replaceChildren();
    for (const request of data.artworks) {
      const card = document.createElement('a'); card.className = 'gallery-card'; card.href = request.invitationUrl;
      const image = document.createElement('img'); image.src = request.artwork.url; image.loading = 'lazy'; image.alt = `Character from Chogs ${request.parents.map(p => p.tokenId).join(' and ')}`;
      const label = document.createElement('p'); label.textContent = `${request.artwork.mode === 'fixture' ? 'TEST · ' : ''}#${request.parents[0].tokenId} + #${request.parents[1].tokenId}`;
      card.append(image, label); $('live-gallery').append(card);
    }
    if (!data.artworks.length) $('live-gallery').textContent = 'The first holder-approved characters will appear here.';
  } catch { $('live-gallery').textContent = 'The gallery is temporarily unavailable.'; }
}
void gallery();
$('copy-invitation').addEventListener('click', async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(current.invitationUrl); status('Invitation link copied.'); }
  catch { $('invitation-link').select(); status('Select and copy the invitation link above.'); }
});
for (const side of ['a', 'b']) for (const event of ['input', 'change']) $(`fusion-parent-${side}`).addEventListener(event, () => previewParent(side));
window.addEventListener('chogchemy:token', event => { $('fusion-parent-a').value = event.detail.tokenId; previewParent('a', true); });
window.addEventListener('chogchemy:wallet', () => {
  operation++; resetMessage(); controls();
  previewParent('a', true); previewParent('b', true);
  if (current) void load(current.id);
  void listMine();
});
controls();
const initialId = new URL(location.href).searchParams.get('fusion');
if (initialId) { void load(initialId); $('fusion').scrollIntoView({ behavior: 'smooth' }); }
