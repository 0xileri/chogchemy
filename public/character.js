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

const familyShare = document.getElementById('share-family-comic');
const familyCopy = document.getElementById('copy-family-comic');
if (familyShare && familyCopy) {
  familyShare.hidden = false; familyCopy.hidden = false;
  const familyUrl = link.value + '#family-comic';
  const familyStatus = document.getElementById('family-share-status');
  familyShare.addEventListener('click', async () => {
    familyShare.disabled = true;
    try {
      const result = await shareOrCopy(familyUrl, 'Our Chog Family — Chogchemy');
      familyStatus.textContent = ({ shared: 'Family comic shared.', copied: 'Family link copied.', cancelled: 'Sharing cancelled.', manual: 'Select and copy the public page link above.' })[result];
      if (result === 'manual') { link.focus(); link.select(); }
    } finally { familyShare.disabled = false; }
  });
  familyCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(familyUrl); familyStatus.textContent = 'Family link copied.'; }
    catch { link.focus(); link.select(); familyStatus.textContent = 'Select and copy the public page link above.'; }
  });
}
