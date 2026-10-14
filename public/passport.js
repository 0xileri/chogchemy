const tokenValid = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const ownerValid = value => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
const dateValid = value => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
const date = value => new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');

export function validatePassportLiveSnapshot(data, tokenId) {
  if (!tokenValid(tokenId) || !data || data.tokenId !== tokenId) throw new Error('Could not refresh this Chog’s details.');
  const input = data.ownership;
  const ownership = input?.status === 'verified' && ownerValid(input.owner) && dateValid(input.checkedAt) && typeof input.blockNumber === 'string' && /^\d{1,80}$/.test(input.blockNumber)
    ? { status: 'verified', owner: input.owner.toLowerCase(), checkedAt: input.checkedAt, blockNumber: input.blockNumber }
    : { status: 'unavailable', owner: null, checkedAt: null, blockNumber: null };
  const image = data.preview;
  const preview = image && typeof image.imageUrl === 'string' && new RegExp(`^/passport-image/${tokenId}\\?v=[a-f0-9]{64}$`).test(image.imageUrl)
    ? { imageUrl: image.imageUrl, name: typeof image.name === 'string' ? image.name.slice(0, 120) : `Chog #${tokenId}` } : null;
  return { ownership, preview, livePending: { ownership: data.livePending?.ownership === true, preview: data.livePending?.preview === true } };
}

export function attachPassportLiveDetails({ tokenId, elements, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), retryDelayMs = 2000, attempts = 3 }) {
  if (!tokenValid(tokenId) || !['status', 'image', 'placeholder', 'badge', 'wallet', 'details', 'address', 'checked'].every(key => elements[key]) || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) return null;
  let busy = false, stopped = false;
  function render(data) {
    const { ownership, preview, livePending } = validatePassportLiveSnapshot(data, tokenId), verified = ownership.status === 'verified';
    elements.badge.hidden = !verified; elements.badge.textContent = verified ? 'Current owner checked on Monad' : '';
    elements.wallet.hidden = !verified; elements.wallet.textContent = verified ? `${ownership.owner.slice(0, 6)}…${ownership.owner.slice(-4)}` : '';
    elements.details.hidden = !verified; elements.address.textContent = ownership.owner || '';
    elements.checked.textContent = verified ? `Checked ${date(ownership.checkedAt)} · Monad block ${ownership.blockNumber}` : '';
    if (preview) {
      if (elements.image.getAttribute('src') !== preview.imageUrl) elements.image.src = preview.imageUrl;
      elements.image.alt = `${preview.name} — original Chog NFT`; elements.image.hidden = false; elements.placeholder.hidden = true;
    } else {
      elements.image.hidden = true; elements.image.removeAttribute('src'); elements.placeholder.hidden = false;
      elements.placeholder.setAttribute('aria-label', 'Original Chog artwork temporarily unavailable');
    }
    elements.status.textContent = verified
      ? preview ? 'NFT details loaded. Your saved history is ready.' : livePending.preview ? 'The current owner is checked. Original artwork is still loading; your saved history is ready.' : 'The current owner is checked. Original artwork is temporarily unavailable; your saved history is ready.'
      : livePending.ownership ? 'Checking the current owner. Your saved history below is ready.' : 'Current ownership is temporarily unavailable. Saved history remains here. The studio checks ownership again before a new creation.';
    return verified && Boolean(preview);
  }
  async function refresh() {
    if (busy || stopped) return;
    busy = true; if (elements.button) { elements.button.disabled = true; elements.button.hidden = false; }
    elements.status.textContent = 'Checking the current owner and original artwork. Your saved history below is ready.';
    try {
      for (let attempt = 0; attempt < attempts && !stopped; attempt++) {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6500);
        try {
          const response = await fetcher(`/api/chogs/${tokenId}/passport`, { credentials: 'same-origin', signal: controller.signal });
          if (!response.ok) throw new Error('The Chog details are temporarily unavailable.');
          const data = await response.json();
          if (stopped) return;
          if (render(data)) return;
        } catch {
          if (!stopped) elements.status.textContent = 'NFT details are temporarily unavailable. Your saved history is still here. Try Refresh NFT details in a moment.';
        } finally { clearTimeout(timeout); }
        if (attempt + 1 < attempts && !stopped) await sleep(retryDelayMs);
      }
      if (!stopped) elements.status.textContent = 'Some NFT details are taking longer. Your saved history is still here. Try Refresh NFT details in a moment.';
    } finally { busy = false; if (elements.button) elements.button.disabled = false; }
  }
  const onImageError = () => {
    elements.image.hidden = true; elements.image.removeAttribute('src'); elements.placeholder.hidden = false;
    elements.placeholder.setAttribute('aria-label', 'Original Chog artwork temporarily unavailable');
    elements.status.textContent = 'Original artwork is temporarily unavailable. Your saved history is still here.';
  };
  const onClick = () => { void refresh(); };
  elements.image.addEventListener('error', onImageError); elements.button?.addEventListener('click', onClick);
  if (elements.button) elements.button.hidden = false;
  return { refresh, stop() { stopped = true; elements.image.removeEventListener('error', onImageError); elements.button?.removeEventListener('click', onClick); } };
}

if (typeof document !== 'undefined' && document.body?.dataset.passportToken) {
  const $ = id => document.getElementById(id);
  const details = attachPassportLiveDetails({ tokenId: document.body.dataset.passportToken, elements: {
    status: $('passport-live-status'), image: $('passport-original-image'), placeholder: $('passport-original-placeholder'), badge: $('passport-owner-badge'),
    wallet: $('passport-owner-wallet'), details: $('passport-owner-details'), address: $('passport-owner-address'), checked: $('passport-owner-checked'), button: $('passport-refresh-state'),
  } });
  if (details) { void details.refresh(); window.addEventListener('pagehide', () => details.stop(), { once: true }); }
}
