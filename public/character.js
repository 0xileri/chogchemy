import { shareOrCopy } from './share.js';
const link = document.getElementById('character-link');
const status = document.getElementById('share-status');
const share = document.getElementById('share-character');
const copy = document.getElementById('copy-character');
share.hidden = false; copy.hidden = false;
function feedback(result) {
  status.textContent = ({ shared: 'Character shared.', copied: 'Character link copied.', cancelled: 'Sharing cancelled.', manual: 'Select and copy the character link above.' })[result];
  if (result === 'manual') { link.focus(); link.select(); }
}
share.addEventListener('click', async () => {
  share.disabled = true;
  try { feedback(await shareOrCopy(link.value, document.title)); }
  finally { share.disabled = false; }
});
copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(link.value); feedback('copied'); }
  catch { feedback('manual'); }
});
