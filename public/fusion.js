import { api, getWalletAddress, signWalletMessage, getChogPreview } from './wallet.js';
import { shareOrCopy } from './share.js';

const $ = id => document.getElementById(id);
let current = null, message = null, operation = 0, busy = false, poll = null, comicAction = null;
const status = text => { $('fusion-status').textContent = text; };
const short = address => `${address.slice(0, 6)}…${address.slice(-4)}`;
const active = request => ['awaiting_approvals', 'approved'].includes(request.state) && request.expires > Date.now();
const optionalPartner = request => request.approvalPolicy === 'creator';
function approvalSummary(request) {
  if (!optionalPartner(request)) return request.parents.every(p => p.approvedAt) ? 'Both holders signed' : 'Both holder signatures required';
  if (request.parents.every(p => p.owner === request.createdBy)) return 'Creator verified · Both Chogs owned';
  return request.parents[1].approvedAt ? 'Creator verified · Partner signed' : 'Creator verified · Partner has not signed';
}
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
  $('change-chog').disabled = busy;
  $('refresh-invitation').disabled = busy;
  $('review-approval').hidden = !current || !active(current) || role < 0 || !!current.parents[role].approvedAt || (optionalPartner(current) && address === current.createdBy);
  $('review-approval').textContent = current && optionalPartner(current) ? 'Add my optional approval' : 'Review my approval';
  $('review-approval').disabled = busy;
  $('cancel-invitation').hidden = !current || !active(current) || role < 0;
  $('cancel-invitation').disabled = busy;
  $('recheck-invitation').hidden = !current || !active(current) || role < 0;
  $('recheck-invitation').disabled = busy;
  $('sign-fusion').disabled = busy || !$('approval-confirm').checked || !message || !address;
  $('wallet-hint').hidden = !!address;
  $('my-invitations').hidden = !address;
  $('generate-artwork').hidden = !current?.generationAvailable || !current?.canGenerate || !address || role < 0 || (optionalPartner(current) && address !== current.createdBy);
  $('generate-artwork').disabled = busy;
  $('generate-comic').hidden = !current?.canGenerateComic;
  $('generate-comic').disabled = busy;
  $('generate-comic').textContent = comicAction === 'generate' ? 'Checking your family…' : 'Create our family comic ✳';
  $('cancel-comic').hidden = current?.comic?.state !== 'preparing' || address !== current?.createdBy;
  $('cancel-comic').disabled = busy;
  if (current?.state === 'preparing' && role >= 0) $('cancel-invitation').hidden = false;
}
function render(request) {
  if (current?.id !== request.id) comicError('');
  current = request; resetMessage(); $('invitation-card').hidden = false;
  $('invitation-link').value = request.invitationUrl;
  $('invitation-state').textContent = ({ awaiting_approvals: 'Waiting for both holders', approved: optionalPartner(request) ? 'Ready to create' : 'Both holders approved', preparing: 'Preparing parent artwork', generating: 'Creating your new character…', generated: 'Meet your new character.', generation_failed: 'Artwork could not be saved', cancelled: 'Cancelled', invalidated: 'Ownership changed', expired: 'Expired' })[request.state] || request.state;
  $('invitation-approval-policy').textContent = `${approvalSummary(request)}.${optionalPartner(request) ? ' Only the creator can start this fusion.' : ''}`;
  $('invitation-parents').replaceChildren();
  for (const [index, parent] of request.parents.entries()) {
    const card = document.createElement('article');
    const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = `PARENT ${index === 0 ? 'A' : 'B'}`;
    const title = document.createElement('h3'); title.textContent = `Token #${parent.tokenId}`;
    const holder = document.createElement('p'); holder.textContent = `Holder ${short(parent.owner)}`; holder.title = parent.owner;
    const approval = document.createElement('p'); approval.className = 'approval-state'; approval.textContent = parent.approvedAt ? 'Signed approval' : optionalPartner(request) ? (parent.owner === request.createdBy ? 'Creator wallet and ownership verified' : 'Partner has not signed · Approval optional') : 'Awaiting signed approval';
    const link = document.createElement('a'); link.textContent = 'View Chog ↗'; link.href = `https://opensea.io/item/monad/${request.collection.address}/${parent.tokenId}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    card.append(label, title, holder, approval, link); $('invitation-parents').append(card);
    if (getWalletAddress()) void getChogPreview(parent.tokenId).then(preview => {
      if (!card.isConnected || current?.id !== request.id) return;
      const image = document.createElement('img'); image.className = 'invitation-art'; image.alt = preview.name; image.src = preview.imageUrl;
      image.addEventListener('error', () => image.remove()); label.after(image);
    }).catch(() => {});
  }
  $('invitation-expiry').textContent = `Expires ${new Date(request.expires).toLocaleString()} · Art direction ${request.artDirection}`;
  $('invitation-approval-times').textContent = request.parents.filter(p => p.approvedAt).map(p => `Token #${p.tokenId} signed ${new Date(p.approvedAt).toLocaleString()}`).join(' · ');
  $('invitation-style-hash').textContent = request.artDirectionHash ? `Art direction hash ${request.artDirectionHash}` : '';
  $('ownership-check').textContent = `Ownership last checked ${new Date(request.checkedAt).toLocaleString()} at Monad block ${request.checkedBlock}.`;
  $('ready-note').hidden = request.state !== 'approved';
  $('ready-note').textContent = request.generation?.error || (request.generationAvailable ? 'Ready to create. Ownership is checked again before drawing.' : 'Your fusion is saved. The artwork studio is not available for this invitation yet.');
  $('generation-note').hidden = !['preparing', 'generating', 'generation_failed'].includes(request.state);
  $('generation-note').textContent = request.generation?.error || (request.state === 'preparing' ? 'Loading the two parent images. Either holder can still cancel during preparation.' : 'The studio is drawing. This can take a few minutes; you can leave and return to this link.');
  $('generated-result').hidden = !request.artwork;
  if (request.artwork) {
    $('generated-image').src = request.artwork.url;
    $('download-artwork').href = request.artwork.url;
    $('view-character').href = request.characterUrl;
    $('artwork-caption').textContent = `${request.artwork.mode === 'fixture' ? 'TEST ARTWORK · Synthetic output' : 'AI character artwork'} · Parents #${request.parents.map(p => p.tokenId).join(' + #')} · ${approvalSummary(request)}. An artwork record; no NFT has been minted.`;
    void gallery();
  }
  renderComic(request);
  clearTimeout(poll);
  if (['preparing', 'generating'].includes(request.state) || ['preparing', 'generating'].includes(request.comic?.state)) poll = setTimeout(() => { if (!document.hidden && !busy && current?.id === request.id) void load(request.id); else if (current?.id === request.id) render(current); }, 5000);
  const address = getWalletAddress();
  $('invitation-role').textContent = !address ? 'Connect the wallet holding either parent to review and sign.' : request.parents.some(p => p.owner === address) ? 'This wallet is one of the two invited holders.' : 'This wallet is not one of the invited holders. Switch to the wallet holding a listed parent.';
  controls();
}
function comicError(text) {
  $('comic-error').textContent = text;
  $('comic-error').hidden = !text;
}
function renderComic(request) {
  $('family-comic-studio').hidden = !request.artwork;
  const comic = request.comic;
  $('comic-result').hidden = !comic?.artwork;
  $('comic-status').textContent = comic?.error || ({ preparing: 'Preparing the parents and saved child artwork…', generating: 'Drawing your family comic. You can leave and return to this link.', generated: 'Your first family story is saved.', cancelled: 'Preparation cancelled. You can create the comic when ready.' })[comic?.state] || 'Ready for your family’s first story.';
  $('comic-access').textContent = comic?.artwork ? 'Fictional character story requested by the verified creator. Fusion approvals apply to the original child artwork.' : getWalletAddress() === request.createdBy ? 'One optional image-generation request, counted toward your daily artwork limit. Ownership is checked again before drawing.' : 'The original creator can connect their wallet to create this family comic.';
  $('comic-record').hidden = !comic;
  $('comic-record-text').textContent = comic ? `Requested ${new Date(comic.requestedAt).toLocaleString()} · Ownership checked ${new Date(comic.checkedAt).toLocaleString()} · Monad block ${comic.checkedBlock} · Style ${comic.styleLabel} · Style hash ${comic.styleHash} · Child SHA-256 ${comic.childDigest}${comic.artwork ? ` · Comic SHA-256 ${comic.artwork.digest}` : ''}` : '';
  if (comic?.artwork) {
    $('comic-image').src = comic.artwork.url;
    $('download-comic').href = comic.artwork.url;
    $('view-family').href = request.characterUrl + '#family-comic';
    $('comic-caption').textContent = `${comic.artwork.mode === 'fixture' ? 'TEST COMIC · Synthetic output' : 'AI family comic'} · Chogs #${request.parents.map(p => p.tokenId).join(' + #')} and their saved fusion child. Artwork only; no new NFT minted.`;
  }
}
$('generate-comic').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation; if (!id) return;
  status('Checking the family before preparing your comic…');
  const request = await api(`/api/fusions/${id}/comic`, {});
  if (attempt !== operation || current?.id !== id) return;
  render(request); status('Your family comic is underway.');
}, 'generate'));
$('cancel-comic').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation; if (!id) return;
  const request = await api(`/api/fusions/${id}/cancel-comic`, {});
  if (attempt !== operation || current?.id !== id) return;
  render(request); status('Comic preparation cancelled. Your child artwork is saved.');
}, 'cancel'));
$('share-family').addEventListener('click', async () => {
  const url = current?.characterUrl; if (!url) return;
  const result = await shareOrCopy(url + '#family-comic', 'Our Chog Family — Chogchemy');
  if (current?.characterUrl !== url) return;
  status(({ shared: 'Family comic shared.', copied: 'Public family link copied.', cancelled: 'Sharing cancelled.', manual: 'Open the family page to copy its public link.' })[result]);
});
async function load(id, updateUrl = false) {
  const attempt = ++operation;
  status('Loading invitation…'); resetMessage();
  try {
    const request = await api(`/api/fusions/${encodeURIComponent(id)}`);
    if (attempt !== operation) return;
    render(request);
    if (updateUrl) { const url = new URL(location.href); url.searchParams.set('fusion', request.id); url.hash = 'fusion'; history.replaceState(null, '', url); }
    status(request.state === 'approved' ? 'Your fusion is ready. Review the parents and studio options below.' : 'Invitation loaded. Review the parents and status below.');
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
async function perform(work, familyAction = null) {
  if (busy) return;
  const comicId = familyAction ? current?.id : null;
  comicAction = familyAction;
  if (familyAction) comicError('');
  busy = true; controls();
  const attempt = operation;
  try { await work(); }
  catch (error) {
    const errorText = error.status === 401 ? 'Your wallet session expired. Connect and sign in again, then create your family comic.' : error.message;
    // A 401 clears the wallet and advances operation; still explain it beside this comic.
    if (familyAction && current?.id === comicId && (attempt === operation || (error.status === 401 && !getWalletAddress()))) comicError(errorText);
    if (attempt === operation) {
      if (error.status === 409 && current) await load(current.id);
      status(error.code === 4001 ? 'Approval cancelled in your wallet. Nothing was signed or saved.' : error.message);
    }
  }
  finally { busy = false; comicAction = null; controls(); }
}
$('new-fusion').addEventListener('submit', event => {
  event.preventDefault();
  void perform(async () => {
    if (!getWalletAddress()) throw new Error('Connect your wallet to create an invitation.');
    const attempt = operation;
    status('Checking both parents on Monad…');
    const request = await api('/api/fusions', { parentA: $('fusion-parent-a').value.trim(), parentB: $('fusion-parent-b').value.trim(), requirePartnerApproval: $('require-partner-approval').checked });
    if (attempt !== operation) return;
    render(request);
    const url = new URL(location.href); url.searchParams.set('fusion', request.id); url.hash = 'fusion'; history.replaceState(null, '', url);
    status(optionalPartner(request) ? 'Ready to create. Share the link for optional partner approval.' : 'Review your approval, then share the link with your partner.');
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
  render(request); status(optionalPartner(request) ? 'Your optional approval is saved. The creator can start the fusion.' : request.state === 'approved' ? 'Both holders approved. Your character is ready to create.' : 'Your signature is saved. Waiting for the other holder.');
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
      const card = document.createElement('a'); card.className = 'gallery-card'; card.href = request.characterUrl;
      const image = document.createElement('img'); image.src = request.artwork.url; image.loading = 'lazy'; image.alt = `Character from Chogs ${request.parents.map(p => p.tokenId).join(' and ')}`;
      const label = document.createElement('p'); label.textContent = `${request.artwork.mode === 'fixture' ? 'TEST · ' : ''}#${request.parents[0].tokenId} + #${request.parents[1].tokenId}`;
      const approval = document.createElement('p'); approval.textContent = approvalSummary(request);
      card.append(image, label, approval);
      if (request.comic?.artwork) { const badge = document.createElement('span'); badge.className = 'comic-gallery-badge'; badge.textContent = 'Family comic inside ↗'; card.append(badge); }
      $('live-gallery').append(card);
    }
    if (!data.artworks.length) $('live-gallery').textContent = 'The first Chog characters will appear here.';
  } catch { $('live-gallery').textContent = 'The gallery is temporarily unavailable.'; }
}
void gallery();
$('share-finished-character').addEventListener('click', async () => {
  const url = current?.characterUrl;
  if (!url) return;
  const result = await shareOrCopy(url, 'Meet a new Chogchemy character');
  if (current?.characterUrl !== url) return;
  status(({ shared: 'Character shared.', copied: 'Public character link copied.', cancelled: 'Sharing cancelled.', manual: 'Open the character page to select and copy its public link.' })[result]);
});
$('copy-invitation').addEventListener('click', async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(current.invitationUrl); status('Invitation link copied.'); }
  catch { $('invitation-link').select(); status('Select and copy the invitation link above.'); }
});
function selectParentA(tokenId) {
  $('fusion-parent-a').value = tokenId;
  const selected = !!tokenId && !!getWalletAddress();
  $('parent-a-field').hidden = selected;
  $('change-chog').hidden = !selected;
  previewParent('a', true);
}
$('change-chog').addEventListener('click', () => window.dispatchEvent(new CustomEvent('chogchemy:choose-token')));
for (const side of ['a', 'b']) for (const event of ['input', 'change']) $(`fusion-parent-${side}`).addEventListener(event, () => previewParent(side));
window.addEventListener('chogchemy:token', event => selectParentA(event.detail.tokenId));
window.addEventListener('chogchemy:wallet', () => {
  operation++; resetMessage(); controls();
  previewParent('a', true); previewParent('b', true);
  if (current) void load(current.id);
  void listMine();
});
controls();
const initialId = new URL(location.href).searchParams.get('fusion');
if (initialId) { void load(initialId); $('fusion').scrollIntoView({ behavior: 'smooth' }); }
