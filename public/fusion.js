import { api, getWalletAddress, signWalletMessage, getChogPreview } from './wallet.js';
import { shareOrCopy } from './share.js';

const $ = id => document.getElementById(id);
let current = null, message = null, operation = 0, busy = false, poll = null, comicAction = null;
let drawingUsage = null, usagePending = null, choosingNew = false;
let episodeCancelButtons = [];
const status = text => { $('fusion-status').textContent = text; };
const short = address => `${address.slice(0, 6)}…${address.slice(-4)}`;
const active = request => ['awaiting_approvals', 'approved'].includes(request.state) && request.expires > Date.now();
const optionalPartner = request => request.approvalPolicy === 'creator';
const creationState = request => {
  if ((request.episodes || []).some(e => ['preparing', 'generating'].includes(e.state))) return 'Family saved · New episode drawing';
  const count = (request.episodes || []).filter(e => e.artwork).length;
  if (count) return `Family saved · ${count} extra episode${count === 1 ? '' : 's'}`;
  return request.comic?.artwork ? 'Child + comic saved' : request.artwork ? ['preparing', 'generating'].includes(request.comic?.state) ? 'Child saved · Comic drawing' : request.comic?.state === 'failed' ? 'Child saved · Comic failed' : 'Child saved · Comic not created' : ({ approved: 'Ready to create the child', awaiting_approvals: 'Waiting for approval', preparing: 'Preparing the child', generating: 'Drawing the child', generation_failed: 'Child drawing failed', cancelled: 'Cancelled', expired: 'Expired', invalidated: 'Parent ownership changed' })[request.state] || 'Work in progress';
};
const resetTime = () => new Date(drawingUsage?.resetsAt || (Math.floor(Date.now() / 86400000) + 1) * 86400000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function budgetText() {
  if (!drawingUsage) return '';
  if (!drawingUsage.remaining || !drawingUsage.globalRemaining) return `Today's drawing limit is used up. Try again ${resetTime()} (your local time). Your saved artwork is still here.`;
  return `${drawingUsage.remaining} of ${drawingUsage.limit} drawing requests left today. Each child, comic, or new episode uses one request.`;
}
async function refreshUsage() {
  const address = getWalletAddress(); if (!address) return;
  if (usagePending?.address === address) return usagePending.promise;
  const pending = { address, promise: null };
  pending.promise = (async () => {
    try {
      const data = await api('/api/drawing-usage');
      if (getWalletAddress() !== address || usagePending !== pending) return;
      drawingUsage = data; controls();
    } catch { if (getWalletAddress() === address && usagePending === pending) { drawingUsage = null; controls(); } }
    finally { if (usagePending === pending) usagePending = null; }
  })();
  usagePending = pending; return pending.promise;
}
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
  const atLimit = !!drawingUsage && (!drawingUsage.remaining || !drawingUsage.globalRemaining);
  const step = !address ? 'connect' : current?.artwork ? 'comic' : 'child';
  for (const name of ['connect', 'child', 'comic']) $('step-' + name).setAttribute('aria-current', step === name ? 'step' : 'false');
  $('step-comic').href = current?.artwork ? '#family-comic-studio' : '#fusion';
  $('saved-wallet-hint').hidden = !!address;
  $('parent-picker').hidden = !!current;
  $('start-new-family').hidden = !address || !current;
  $('start-new-family').disabled = busy;
  $('drawing-usage').hidden = !address;
  $('drawing-remaining').textContent = drawingUsage ? `${drawingUsage.remaining} drawing request${drawingUsage.remaining === 1 ? '' : 's'} left today` : 'Checking your drawing allowance…';
  $('drawing-usage-note').textContent = drawingUsage ? `${drawingUsage.used} of ${drawingUsage.limit} used. One request per child, comic, or episode. Resets ${resetTime()} (your local time).${!drawingUsage.globalRemaining ? ' The studio-wide daily limit is also used up.' : ''}` : 'Your allowance appears here after wallet verification.';
  for (const id of ['child-budget', 'comic-budget']) { $(id).hidden = !address || !drawingUsage; $(id).textContent = budgetText(); }
  $('child-budget').hidden ||= current?.state !== 'approved';
  $('comic-budget').hidden ||= !current?.canGenerateComic;
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
  $('generate-artwork').disabled = busy || atLimit;
  $('generate-comic').hidden = !current?.canGenerateComic || !address;
  $('generate-comic').disabled = busy || atLimit;
  $('generate-comic').textContent = comicAction === 'generate' ? 'Checking your family…' : current?.comic?.state === 'ready' ? 'Try drawing the comic again ✳' : 'Create the family comic ✳';
  $('cancel-comic').hidden = current?.comic?.state !== 'preparing' || address !== current?.createdBy;
  $('cancel-comic').disabled = busy;
  episodeControls();
  if (current?.state === 'preparing' && role >= 0) $('cancel-invitation').hidden = false;
}
function render(request) {
  if (current?.id !== request.id) { comicError(''); episodeError(''); }
  current = request; resetMessage(); $('invitation-card').hidden = false;
  $('invitation-link').value = request.invitationUrl;
  $('invitation-state').textContent = creationState(request);
  $('invitation-approval-policy').textContent = request.artwork ? `Child created from Chogs #${request.parents.map(p => p.tokenId).join(' and #')}.` : optionalPartner(request) ? 'The parents are checked. You can create the child without an extra partner signature.' : request.state === 'approved' ? 'Both holders approved. You can create the child.' : 'Both holders need to approve before the child can be drawn.';
  $('invitation-parents').replaceChildren();
  for (const [index, parent] of request.parents.entries()) {
    const card = document.createElement('article');
    const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = index === 0 ? 'FIRST PARENT' : 'SECOND PARENT';
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
  $('ready-note').textContent = request.generation?.error || (request.generationAvailable ? 'These are the two parents. Click “Create the child” to draw and save their new character.' : 'This creation cannot start drawing yet. Try a new creation if it uses an older art style.');
  $('generation-note').hidden = !['preparing', 'generating', 'generation_failed'].includes(request.state);
  $('generation-note').textContent = request.generation?.error || (request.state === 'preparing' ? 'Preparing the two parents for drawing. You can still cancel.' : 'Drawing the child. This can take a few minutes. Find it later in My creations.');
  $('child-next').hidden = !request.artwork;
  const comicDrawing = ['preparing', 'generating'].includes(request.comic?.state);
  $('child-next-title').textContent = request.comic?.artwork ? 'Your child and comic are saved.' : comicDrawing ? 'Your comic is being drawn.' : 'Next: create the family comic.';
  $('child-next-note').textContent = request.comic?.artwork ? 'Open or download your comic in step 3 below.' : comicDrawing ? 'The child is saved. Your comic will appear below when it is ready.' : 'The child is one artwork. The comic is a separate drawing you start in step 3.';
  $('next-comic').textContent = request.comic?.artwork ? 'See my comic ↓' : comicDrawing ? 'Check comic progress ↓' : 'Go to the comic ↓';
  $('generated-result').hidden = !request.artwork;
  if (request.artwork) {
    $('generated-image').src = request.artwork.url;
    $('download-artwork').href = request.artwork.url;
    $('view-character').href = request.characterUrl;
    $('artwork-caption').textContent = `${request.artwork.mode === 'fixture' ? 'TEST ARTWORK · Synthetic output' : 'Saved child artwork'} · Parents #${request.parents.map(p => p.tokenId).join(' + #')}. Artwork only; no new NFT minted.`;
    void gallery();
    void listMine();
  }
  renderComic(request);
  clearTimeout(poll);
  if (['preparing', 'generating'].includes(request.state) || ['preparing', 'generating'].includes(request.comic?.state) || (request.episodes || []).some(e => ['preparing', 'generating'].includes(e.state))) poll = setTimeout(() => { if (!document.hidden && !busy && current?.id === request.id) void load(request.id); else if (current?.id === request.id) render(current); }, 5000);
  const address = getWalletAddress();
  $('invitation-role').textContent = !address ? 'Connect the wallet holding either parent to review and sign.' : request.parents.some(p => p.owner === address) ? 'This wallet is one of the two invited holders.' : 'This wallet is not one of the invited holders. Switch to the wallet holding a listed parent.';
  controls();
  void refreshUsage();
}
function comicError(text) {
  $('comic-error').textContent = text;
  $('comic-error').hidden = !text;
}
function renderComic(request) {
  $('family-comic-studio').hidden = !request.artwork;
  const comic = request.comic;
  $('comic-result').hidden = !comic?.artwork;
  $('comic-status').textContent = comic?.error || ({ preparing: 'Preparing the parents and saved child artwork… No comic is saved yet.', generating: 'Drawing your family comic. It will appear here when finished. You can also return through My creations.', generated: 'Comic saved. Download it or open your family page below.', cancelled: 'Preparation cancelled. No comic is saved yet.' })[comic?.state] || 'No comic yet. Click “Create the family comic” to draw it.';
  $('comic-access').textContent = comic?.artwork ? 'A fictional character story. Your original NFTs stay in their wallets.' : getWalletAddress() === request.createdBy ? 'Uses one drawing request. The saved child is used as the comic’s child character.' : 'Connect the wallet that created this child to draw its comic.';
  $('comic-record').hidden = !comic;
  $('comic-record-text').textContent = comic ? `Requested ${new Date(comic.requestedAt).toLocaleString()} · Ownership checked ${new Date(comic.checkedAt).toLocaleString()} · Monad block ${comic.checkedBlock} · Style ${comic.styleLabel} · Style hash ${comic.styleHash} · Child SHA-256 ${comic.childDigest}${comic.artwork ? ` · Comic SHA-256 ${comic.artwork.digest}` : ''}` : '';
  if (comic?.artwork) {
    $('comic-image').src = comic.artwork.url;
    $('download-comic').href = comic.artwork.url;
    $('view-family').href = request.characterUrl + '#family-comic';
    $('comic-caption').textContent = `${comic.artwork.mode === 'fixture' ? 'TEST COMIC · Synthetic output' : 'AI family comic'} · Chogs #${request.parents.map(p => p.tokenId).join(' + #')} and their saved fusion child. Artwork only; no new NFT minted.`;
  }
  renderEpisodes(request);
}
function episodeError(text) { $('episode-error').textContent = text; $('episode-error').hidden = !text; }
function episodeControls() {
  const address = getWalletAddress(), episodes = current?.episodes || [];
  const available = (current?.episodeChoices || []).some(choice => !episodes.some(e => e.storyId === choice.id && !['ready', 'cancelled'].includes(e.state)));
  const progress = episodes.some(e => ['preparing', 'generating'].includes(e.state));
  const atLimit = !!drawingUsage && (!drawingUsage.remaining || !drawingUsage.globalRemaining);
  $('episode-creator').hidden = !current?.canGenerateEpisode || !address;
  $('connect-wallet-episodes').hidden = !!address || !current?.comic?.artwork;
  $('episode-wallet-status').hidden = !!address || !current?.comic?.artwork;
  $('generate-episode').hidden = !available;
  $('generate-episode').disabled = busy || atLimit || progress || !current?.canGenerateEpisode || !$('episode-story').value;
  $('generate-episode').textContent = comicAction === 'episode' ? 'Checking your family…' : 'Create the next episode ✳';
  $('episode-story').disabled = busy || progress || !available;
  for (const button of episodeCancelButtons) button.disabled = busy;
  $('episode-budget').textContent = budgetText() || 'Each new episode uses one drawing request.';
  const allSaved = (current?.episodeChoices || []).length > 0 && current.episodeChoices.every(choice => episodes.some(e => e.storyId === choice.id && e.artwork));
  $('episode-access').textContent = !available && current?.comic?.artwork ? allSaved ? 'All three extra stories are saved. Open or download them below.' : 'All three stories have been attempted. Your saved episodes remain below; dispatched failures cannot be repeated.' : progress ? 'An episode is underway. This page updates automatically; earlier artwork stays saved.' : address !== current?.createdBy ? 'Connect the wallet that created this family to draw its next episode.' : 'Earlier child artwork and comics stay saved. New episodes check both parent owners again.';
}
function episodeChapters() {
  const choice = (current?.episodeChoices || []).find(s => s.id === $('episode-story').value);
  $('episode-chapters').textContent = choice ? choice.chapters.join(' → ') : '';
}
function renderEpisodes(request) {
  $('family-episodes-studio').hidden = !request.comic?.artwork;
  const selected = $('episode-story').value, episodes = request.episodes || [];
  $('episode-story').replaceChildren();
  const available = [];
  for (const choice of request.episodeChoices || []) {
    const previous = episodes.find(e => e.storyId === choice.id), option = document.createElement('option');
    option.value = choice.id; option.disabled = !!previous && !['ready', 'cancelled'].includes(previous.state);
    option.textContent = choice.title + (previous ? ` · ${previous.state === 'generated' ? 'Saved' : previous.state === 'failed' ? 'Attempt failed' : previous.state === 'ready' || previous.state === 'cancelled' ? 'Ready to try' : 'Drawing'}` : '');
    if (!option.disabled) available.push(choice.id);
    $('episode-story').append(option);
  }
  $('episode-story').value = available.includes(selected) ? selected : available[0] || '';
  episodeChapters();
  $('episode-list').replaceChildren();
  episodeCancelButtons = [];
  for (const item of episodes) {
    const card = document.createElement('article'); card.className = 'episode-card';
    const title = document.createElement('h4'); title.textContent = `Episode ${item.number} · ${item.title}`;
    const note = document.createElement('p'); note.className = 'note'; note.textContent = item.error || ({ preparing: 'Preparing this episode. You can still cancel.', generating: 'Drawing this episode. It will appear here when saved.', generated: 'Episode saved.', ready: 'Ready to try again before drawing starts.', cancelled: 'Preparation cancelled. No drawing request was dispatched.' })[item.state] || 'No episode saved.';
    card.append(title, note);
    if (item.artwork) {
      const image = document.createElement('img'); image.src = item.artwork.url; image.alt = `${item.title}, starring the two Chog parents and their saved child`; image.loading = 'lazy';
      const caption = document.createElement('p'); caption.className = 'note'; caption.textContent = item.artwork.mode === 'fixture' ? 'TEST EPISODE · Synthetic output, not AI artwork.' : 'AI family episode · Artwork only; no new NFT minted.';
      const actions = document.createElement('div'); actions.className = 'character-actions';
      const download = document.createElement('a'); download.className = 'button'; download.href = item.artwork.url; download.download = `chogchemy-episode-${item.number}.png`; download.textContent = 'Download episode ↓';
      const open = document.createElement('a'); open.className = 'button secondary'; open.href = request.characterUrl + '#episode-' + item.id; open.textContent = 'Open public episode ↗';
      actions.append(download, open); card.append(image, caption, actions);
    }
    if (item.state === 'preparing' && getWalletAddress() === request.createdBy) {
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Cancel episode preparation'; cancel.disabled = busy;
      episodeCancelButtons.push(cancel);
      cancel.addEventListener('click', () => void perform(async () => {
        const id = current?.id, attempt = operation; if (id !== request.id) return;
        const updated = await api(`/api/fusions/${id}/cancel-episode`, { episodeId: item.id });
        if (attempt !== operation || current?.id !== id) return;
        render(updated); status('Episode preparation cancelled. Your saved family is safe.');
      }, 'episode'));
      card.append(cancel);
    }
    $('episode-list').append(card);
  }
}
$('episode-story').addEventListener('change', () => { episodeError(''); episodeChapters(); episodeControls(); });
$('generate-episode').addEventListener('click', () => void perform(async () => {
  const id = current?.id, attempt = operation, story = $('episode-story').value; if (!id || !story) return;
  episodeError(''); status('Checking your family before preparing the next episode…');
  const request = await api(`/api/fusions/${id}/episode`, { story });
  if (attempt !== operation || current?.id !== id) return;
  render(request); status('Your next episode is underway. The earlier artwork is still saved.');
}, 'episode'));
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
    status(request.artwork ? request.comic?.artwork ? 'Your child and comic are saved below.' : 'Your child is saved. Continue to step 3 to create its comic.' : request.state === 'approved' ? 'Parents checked. Click “Create the child” below.' : 'Creation opened. Check its progress below.');
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
      const title = document.createElement('strong'); title.textContent = `Chogs #${request.parents[0].tokenId} + #${request.parents[1].tokenId}`;
      const state = document.createElement('span'); state.textContent = creationState(request);
      const action = document.createElement('span'); action.className = 'saved-action'; action.textContent = request.episodes?.length ? 'Open family & episodes ↗' : request.comic?.artwork ? 'Open child & comic ↗' : request.comic?.state === 'failed' ? 'Open child / View comic error ↗' : request.artwork ? 'Open child / Create comic ↗' : 'Continue creation ↗';
      link.append(title, state, action);
      link.addEventListener('click', event => { event.preventDefault(); if (busy) return; choosingNew = false; void load(request.id, true).then(() => (current?.artwork ? $('child-next') : $('invitation-card')).scrollIntoView({ behavior: 'smooth' })); });
      $('invitation-list').append(link);
    }
    if (!data.requests.length) $('invitation-list').textContent = 'No saved creations yet. Choose two parents below to begin.';
    if (!current && !choosingNew && !new URL(location.href).searchParams.has('fusion') && data.requests.length && !busy) await load(data.requests[0].id, true);
  } catch (error) { if (getWalletAddress() === address) $('invitation-list').textContent = error.message; }
}
async function perform(work, familyAction = null) {
  if (busy) return;
  const comicId = familyAction ? current?.id : null;
  comicAction = familyAction;
  if (familyAction) { comicError(''); episodeError(''); }
  busy = true; controls();
  const attempt = operation;
  try { await work(); }
  catch (error) {
    const errorText = error.status === 401 ? 'Your wallet session expired. Connect and sign in again, then create your family comic.' : /daily artwork limit/i.test(error.message) ? `Today's drawing limit is used up. Try again ${resetTime()} (your local time). Your saved artwork is still here.` : error.message;
    // A 401 clears the wallet and advances operation; still explain it beside this comic.
    if (familyAction && current?.id === comicId && (attempt === operation || (error.status === 401 && !getWalletAddress()))) { if (familyAction === 'episode') episodeError(errorText); else comicError(errorText); }
    if (attempt === operation) {
      if (error.status === 409 && current) await load(current.id);
      status(error.code === 4001 ? 'Approval cancelled in your wallet. Nothing was signed or saved.' : errorText);
    }
  }
  finally { busy = false; comicAction = null; controls(); void refreshUsage(); }
}
$('new-fusion').addEventListener('submit', event => {
  event.preventDefault();
  void perform(async () => {
    if (!getWalletAddress()) throw new Error('Connect your wallet to create an invitation.');
    choosingNew = false;
    const attempt = operation;
    status('Checking both parents on Monad…');
    const request = await api('/api/fusions', { parentA: $('fusion-parent-a').value.trim(), parentB: $('fusion-parent-b').value.trim(), requirePartnerApproval: $('require-partner-approval').checked });
    if (attempt !== operation) return;
    render(request);
    const url = new URL(location.href); url.searchParams.set('fusion', request.id); url.hash = 'fusion'; history.replaceState(null, '', url);
    status(optionalPartner(request) ? 'Parents checked. Click “Create the child” below.' : 'Review your approval, then share this creation with the other holder.');
    await listMine();
  });
});
$('start-new-family').addEventListener('click', () => {
  if (busy || !getWalletAddress()) return;
  choosingNew = true; operation++; current = null; resetMessage(); comicError(''); episodeError(''); clearTimeout(poll);
  $('invitation-card').hidden = true;
  $('fusion-parent-b').value = ''; previewParent('b', true);
  const url = new URL(location.href); url.searchParams.delete('fusion'); url.hash = 'fusion'; history.replaceState(null, '', url);
  controls(); status('Choose a second parent to start a new family. Your previous creations are still saved.');
  $('fusion').scrollIntoView({ behavior: 'smooth' });
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
  status('Checking both Chog owners before drawing the child…');
  const request = await api(`/api/fusions/${id}/generate`, {});
  if (attempt !== operation || current?.id !== id) return;
  render(request); status('Your child is being drawn. This page updates automatically.');
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
      const badge = document.createElement('span'); badge.className = 'comic-gallery-badge'; badge.textContent = request.comic?.artwork ? 'Comic saved ↗' : 'Child artwork · No comic yet'; card.append(badge);
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
  drawingUsage = null; usagePending = null;
  operation++; resetMessage(); controls();
  void refreshUsage();
  previewParent('a', true); previewParent('b', true);
  if (current) void load(current.id);
  void listMine();
});
controls();
const initialId = new URL(location.href).searchParams.get('fusion');
if (initialId) void load(initialId).then(() => {
  const target = location.hash === '#family-episodes-studio' && !$('family-episodes-studio').hidden ? $('family-episodes-studio') : $('fusion');
  target.scrollIntoView({ behavior: 'smooth' });
});
