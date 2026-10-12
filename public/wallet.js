const $ = id => document.getElementById(id);
let provider = null, address = null, config = null, revision = 0, busy = false;
const previewCache = new Map();
export async function getChogPreview(tokenId) {
  const entry = previewCache.get(tokenId);
  if (entry && entry.expires > Date.now()) return entry.promise;
  if (previewCache.size >= 40) previewCache.delete(previewCache.keys().next().value);
  const promise = api(`/api/chog-preview?id=${encodeURIComponent(tokenId)}`).catch(error => { if (previewCache.get(tokenId)?.promise === promise) previewCache.delete(tokenId); throw error; });
  previewCache.set(tokenId, { promise, expires: Date.now() + 30000 }); return promise;
}
const status = text => { $('wallet-status').textContent = text; $('episode-wallet-status').textContent = text; $('sticker-wallet-status').textContent = text; };
async function api(path, body) {
  const response = await fetch(path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      clearWallet();
      status('Your wallet session expired. Connect and sign in again to continue.');
    }
    const error = new Error(data.error || 'Request failed. Please retry.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function clearWallet() {
  revision++; address = null;
  previewCache.clear();
  $('holder-tools').hidden = true; $('verified-chog').hidden = true;
  $('chog-art').replaceChildren(); $('owned-chogs').replaceChildren(); $('token-id').value = '';
  $('manual-chog').open = false;
  window.dispatchEvent(new CustomEvent('chogchemy:token', { detail: { tokenId: '' } }));
  $('connect-wallet').textContent = 'Connect wallet'; $('connect-wallet').disabled = false;
  $('connect-wallet-main').hidden = false;
  status('Connect to start creating or reopen your saved work.');
  window.dispatchEvent(new CustomEvent('chogchemy:wallet', { detail: { address: null } }));
}
async function disconnect() {
  clearWallet();
  try { await api('/api/logout', {}); } catch { status('Local connection cleared. Refresh before reconnecting if the server is unavailable.'); }
}
function attachProvider(next) {
  if (provider === next) return;
  if (provider?.removeListener) for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.removeListener(event, onWalletChange);
  provider = next;
  if (provider?.on) for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on(event, onWalletChange);
}
function onWalletChange() {
  // Changes during connection are handled by the checks immediately before/after signing.
  if (busy && !address) { revision++; return; }
  void disconnect();
}
async function contextMatches(expectedAddress) {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });
  return accounts[0]?.toLowerCase() === expectedAddress && BigInt(chainId) === 143n;
}
async function connect() {
  if (busy) return;
  if (address) { document.getElementById('holder').scrollIntoView({ behavior: 'smooth' }); return; }
  busy = true; $('connect-wallet').disabled = true; $('connect-wallet-main').disabled = true; $('connect-wallet-episodes').disabled = true; $('connect-wallet-stickers').disabled = true;
  let authenticated = false;
  try {
    if (!window.ethereum?.request) throw new Error('Open this page in a browser with an Ethereum-compatible wallet extension, such as MetaMask or Rabby.');
    attachProvider(window.ethereum);
    config ||= await api('/api/config');
    if (location.origin !== config.origin) throw new Error(`Open ${config.origin} to connect your wallet.`);
    status('Choose your wallet account.');
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts[0]) throw new Error('No wallet account selected.');
    const expectedAddress = accounts[0].toLowerCase();
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (BigInt(chainId) !== 143n) {
      status('Switch your wallet to Monad mainnet.');
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] }); }
      catch (error) {
        if (error.code !== 4902 && error.data?.originalError?.code !== 4902) throw error;
        await provider.request({ method: 'wallet_addEthereumChain', params: [config.chain] });
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] });
      }
    }
    if (!await contextMatches(expectedAddress)) throw new Error('Wallet account or network changed. Connect again.');
    const attempt = revision;
    const challenge = await api('/api/auth/challenge', { address: expectedAddress });
    if (attempt !== revision) throw new Error('Wallet changed. Connect again.');
    status('Sign the login message in your wallet. This does not approve a fusion or move NFTs.');
    const hex = '0x' + Array.from(new TextEncoder().encode(challenge.message), b => b.toString(16).padStart(2, '0')).join('');
    const signature = await provider.request({ method: 'personal_sign', params: [hex, expectedAddress] });
    if (attempt !== revision || !await contextMatches(expectedAddress)) throw new Error('Wallet changed while signing. Connect again.');
    const session = await api('/api/auth/verify', { id: challenge.id, signature }); authenticated = true;
    if (attempt !== revision || !await contextMatches(expectedAddress)) throw new Error('Wallet changed while signing. Connect again.');
    address = session.address; $('holder-tools').hidden = false;
    $('connect-wallet-main').hidden = true;
    $('connect-wallet').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
    window.dispatchEvent(new CustomEvent('chogchemy:wallet', { detail: { address } }));
    status('Wallet verified on Monad. Checking your Chog collection…');
    await refreshChogs();
  } catch (error) {
    if (!address) {
      clearWallet();
      if (authenticated) try { await api('/api/logout', {}); } catch { /* Server session will expire. */ }
    }
    status(error.code === 4001 ? 'You cancelled the wallet request. Connect again when ready.' : error.message);
  } finally { busy = false; $('connect-wallet').disabled = false; $('connect-wallet-main').disabled = false; $('connect-wallet-episodes').disabled = false; $('connect-wallet-stickers').disabled = false; }
}
async function refreshChogs() {
  if (!address) return;
  const attempt = ++revision;
  window.dispatchEvent(new CustomEvent('chogchemy:token', { detail: { tokenId: '' } }));
  $('refresh-chogs').disabled = true; $('verified-chog').hidden = true;
  $('owned-chogs').replaceChildren(); $('balance-status').textContent = 'Finding your Chogs on Monad… This can take a few seconds.';
  try {
    if (!await contextMatches(address)) { await disconnect(); return; }
    const result = await api('/api/chogs');
    if (attempt !== revision) return;
    $('manual-chog').open = result.tokenIds === null;
    $('balance-status').textContent = result.balance === '0' ? 'No Chog Genesis NFTs found in this wallet. You can still try the demo.' : `You own ${result.balance} Chog Genesis NFT${result.balance === '1' ? '' : 's'}. ${result.tokenIds === null ? 'Automatic discovery is temporarily unavailable. You can enter a token ID below.' : !result.tokenIds.length ? 'Your holdings may have just changed. Refresh in a moment or use manual lookup.' : result.tokenIds.length === 1 && result.balance === '1' ? 'Found your Chog automatically.' : 'Choose your Chog below.'}`;
    for (const tokenId of result.tokenIds || []) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Chog #${tokenId}`;
      button.addEventListener('click', () => { $('token-id').value = tokenId; void lookup(); }); $('owned-chogs').append(button);
    }
    if (result.tokenIds?.length === result.limit && BigInt(result.balance) > BigInt(result.limit)) $('balance-status').textContent += ` Showing the first ${result.limit}; look up others by ID.`;
    status('Wallet connected. Choose your Chog as the first parent.');
    if (result.balance === '1' && result.tokenIds?.length === 1) { $('token-id').value = result.tokenIds[0]; await lookup(); }
  } catch (error) { if (attempt === revision) { $('balance-status').textContent = ''; status(error.message); } }
  finally { $('refresh-chogs').disabled = false; }
}
async function lookup() {
  if (!address) { status('Connect your wallet first.'); return; }
  const tokenId = $('token-id').value.trim();
  if (!/^(0|[1-9][0-9]{0,77})$/.test(tokenId)) { status('Enter a numeric token ID from your NFT’s OpenSea URL.'); return; }
  const attempt = ++revision;
  window.dispatchEvent(new CustomEvent('chogchemy:token', { detail: { tokenId: '' } }));
  $('verified-chog').hidden = true; status(`Checking ownership of token #${tokenId}…`);
  try {
    if (!await contextMatches(address)) { await disconnect(); return; }
    const token = await api(`/api/chog?id=${encodeURIComponent(tokenId)}`);
    if (attempt !== revision) return;
    $('chog-name').textContent = `Chog Genesis · Token #${token.tokenId}`;
    $('chog-proof').textContent = `Ownership verified · ${token.owner.slice(0, 6)}…${token.owner.slice(-4)}`;
    $('chog-record').textContent = `Checked ${new Date(token.checkedAt).toLocaleString()} · Holder ${token.owner}`;
    $('chog-link').href = `https://opensea.io/item/monad/${token.collection.address}/${token.tokenId}`;
    $('chog-traits').textContent = 'Loading artwork and traits…'; $('chog-art').textContent = '✳'; $('verified-chog').hidden = false;
    status('Your Chog is selected. Add the other Chog below.');
    window.dispatchEvent(new CustomEvent('chogchemy:token', { detail: { tokenId: token.tokenId } }));
    try {
      const metadata = await getChogPreview(token.tokenId);
      if (attempt !== revision) return;
      if (typeof metadata?.name === 'string') $('chog-name').textContent = metadata.name.slice(0, 200);
      const attributes = Array.isArray(metadata?.traits) ? metadata.traits : [];
      $('chog-traits').textContent = attributes.map(x => `${x.type}: ${x.value}`).join(' · ').slice(0, 2000) || 'No traits provided.';
      const imageUrl = metadata.imageUrl;
      if (imageUrl) { const image = document.createElement('img'); image.alt = $('chog-name').textContent; image.referrerPolicy = 'no-referrer'; image.src = imageUrl; image.addEventListener('error', () => { if (attempt === revision) $('chog-art').textContent = 'Artwork unavailable · View on OpenSea'; }); $('chog-art').replaceChildren(image); }
      else $('chog-art').textContent = 'Artwork unavailable · View on OpenSea';
    } catch { if (attempt === revision) { $('chog-traits').textContent = 'Ownership confirmed. Artwork is temporarily unavailable; refresh or view it on OpenSea.'; $('chog-art').textContent = 'Artwork unavailable'; } }
  } catch (error) { if (attempt === revision) status(error.message); }
}
window.addEventListener('chogchemy:choose-token', () => {
  if (!address) return;
  $('holder').scrollIntoView({ behavior: 'smooth' });
  const choices = $('owned-chogs').querySelectorAll('button');
  if (choices.length > 1) { choices[0].focus({ preventScroll: true }); status('Choose another Chog from your collection.'); }
  else { $('manual-chog').open = true; $('token-id').focus({ preventScroll: true }); $('token-id').select(); status('Look up another Chog you own, or keep the selected Chog.'); }
});
$('connect-wallet').addEventListener('click', connect);
$('connect-wallet-main').addEventListener('click', connect);
$('connect-wallet-episodes').addEventListener('click', connect);
$('connect-wallet-stickers').addEventListener('click', connect);
$('disconnect-wallet').addEventListener('click', disconnect);
$('refresh-chogs').addEventListener('click', refreshChogs);
$('lookup-chog').addEventListener('submit', event => { event.preventDefault(); void lookup(); });
// Start disconnected on every page load; never restore identity from browser storage.
clearWallet();

export { api };
export function getWalletAddress() { return address; }
export async function signWalletMessage(message) {
  if (!address || !provider) throw new Error('Connect and verify your wallet first.');
  const expected = address, attempt = revision;
  if (!await contextMatches(expected)) { await disconnect(); throw new Error('Wallet changed. Reconnect before approving.'); }
  const hex = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('');
  const signature = await provider.request({ method: 'personal_sign', params: [hex, expected] });
  if (attempt !== revision || !await contextMatches(expected)) throw new Error('Wallet changed during approval. Reconnect and try again.');
  return signature;
}
