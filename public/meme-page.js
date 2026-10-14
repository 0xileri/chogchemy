import { shareOrCopy } from './share.js';

const link = document.getElementById('public-meme-link');
const share = document.getElementById('share-meme');
const copy = document.getElementById('copy-meme');
const status = document.getElementById('meme-share-status');
if (link && share && copy && status) {
  share.hidden = false; copy.hidden = false;
  function feedback(result) {
    status.textContent = ({ shared: 'Meme link shared.', copied: 'Meme link copied.', cancelled: 'Sharing cancelled.', manual: 'Select and copy the public link below.' })[result];
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
}
