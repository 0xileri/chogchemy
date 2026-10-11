const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const short = value => `${value.slice(0, 6)}…${value.slice(-4)}`;

function document({ title, description, origin, path, image, content, script = false, missing = false }) {
  const url = `${origin}${path}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}">
<meta name="theme-color" content="#F7F6ED"><link rel="icon" type="image/png" href="/brand/chogchemy-icon-v1.png">
${missing ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escape(url)}">`}
<meta property="og:type" content="website"><meta property="og:site_name" content="Chogchemy">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${escape(origin + image)}">
<meta property="og:image:alt" content="${escape(description)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${escape(origin + image)}">
<link rel="stylesheet" href="/style.css">
</head><body class="character-page">
<a class="skip-link" href="#main-content">Skip to content</a>
<header><a class="brand" href="/" aria-label="Chogchemy home"><img src="/brand/chogchemy-logo-v1.png" alt="Chogchemy" width="2172" height="724"></a><a class="family-nav" href="/#descendants">Explore the family ↗</a><a class="button" href="/#holder">Create a character ↗</a></header>
<main id="main-content">${content}</main>
<footer><a class="brand footer-brand" href="/" aria-label="Chogchemy home"><img src="/brand/chogchemy-logo-v1.png" alt="Chogchemy" width="2172" height="724"></a><p>Two Chogs. One new character.<br><span>Built for Chogathon · Early prototype</span></p></footer>
${script ? '<script type="module" src="/character.js"></script>' : ''}</body></html>`;
}

export function renderCharacterPage(request, origin) {
  const fixture = request.artwork.mode === 'fixture';
  const pair = request.parents.map(p => `#${p.tokenId}`).join(' + ');
  const title = `${fixture ? 'TEST ARTWORK · ' : ''}Chogs ${pair} — Chogchemy`;
  const description = `${fixture ? 'Synthetic test artwork' : 'An AI character'} created from Chog Genesis tokens ${pair}, with a record of its NFT roots and holder approvals.`;
  const optional = request.approvalPolicy === 'creator';
  const bothOwned = optional && request.parents.every(p => p.owner === request.createdBy);
  const approval = bothOwned ? 'Creator verified · Both Chogs owned' : optional ? (request.parents[1].approvedAt ? 'Creator verified · Partner signed' : 'Creator verified · Partner has not signed') : 'Both holders signed';
  const parents = request.parents.map((parent, index) => {
    const consent = parent.approvedAt ? 'Signed approval' : optional && parent.owner === request.createdBy ? 'Creator wallet and ownership verified' : 'Partner has not signed · Approval optional';
    return `<article class="lineage-parent parent-${index === 0 ? 'a' : 'b'}"><span class="eyebrow">PARENT ${index === 0 ? 'A' : 'B'}</span><h3>Chog Genesis #${escape(parent.tokenId)}</h3><p>Holder at creation <span class="holder-address" title="${escape(parent.owner)}">${escape(short(parent.owner))}</span></p><p class="approval-state">${escape(consent)}</p><a class="text-link" href="https://opensea.io/item/monad/${escape(request.collection.address)}/${escape(parent.tokenId)}" target="_blank" rel="noopener noreferrer">View original NFT ↗</a></article>`;
  }).join('');
  const content = `<section class="character-hero">
<figure class="character-art"><img src="${escape(request.artwork.url)}" alt="${escape(description)}" width="1024" height="1024" fetchpriority="high"><figcaption>${fixture ? 'TEST ARTWORK · Synthetic output, not a real AI fusion.' : 'AI character artwork · Original NFTs stay in their holders’ wallets.'}</figcaption></figure>
<div class="character-copy"><span class="eyebrow">${fixture ? 'TEST CHARACTER / SAMPLE ROOTS' : 'A NEW CHARACTER / REAL CHOG ROOTS'}</span><h1>A little of both.<br>A character of its own.</h1><p class="character-pair">Chogs ${escape(pair)}</p><p>Made from two Chog Genesis NFTs, brought together in the Chogchemy studio.</p><span class="badge character-approval">${escape(approval)}</span><div class="character-actions"><a class="button" href="${escape(request.artwork.url)}" download="chogchemy-${escape(request.parents.map(p => p.tokenId).join('-'))}.png">Download artwork ↓</a><button class="secondary" id="share-character" type="button" hidden>Share character ↗</button></div><label for="character-link" class="note">This character’s public page</label><div class="share-row"><input id="character-link" readonly value="${escape(request.characterUrl)}"><button id="copy-character" type="button" hidden>Copy link</button></div><p id="share-status" class="note" role="status"></p><a class="text-link" href="${escape(request.invitationUrl)}">View the studio record ↗</a></div>
</section>
<section class="character-lineage"><div class="section-title"><div><span class="eyebrow">THE FAMILY RECORD</span><h2>Every character has roots.</h2></div><span class="badge">Monad mainnet · Chog Genesis</span></div><div class="invitation-parents">${parents}</div><p class="note">${optional ? 'Partner approval was optional for this fusion.' : 'This fusion required signed approval from both listed holders.'} These are historical holders and approvals; the NFTs may have changed hands since generation.</p></section>
<section class="character-details"><span class="eyebrow">FROM THE STUDIO</span><h2>Made together. Saved with its story.</h2><details class="record-details"><summary>Record details</summary><dl><div><dt>Created</dt><dd>${escape(date(request.artwork.createdAt))}</dd></div><div><dt>Art direction</dt><dd>${escape(request.artDirection)}</dd></div><div><dt>Ownership checked</dt><dd>${escape(date(request.checkedAt))} · Monad block ${escape(request.checkedBlock)}</dd></div>${request.parents.filter(p => p.approvedAt).map(p => `<div><dt>Token #${escape(p.tokenId)} approval</dt><dd>${escape(date(p.approvedAt))}</dd></div>`).join('')}<div><dt>Artwork SHA-256</dt><dd class="artwork-digest">${escape(request.artwork.digest)}</dd></div></dl><p class="note">Chogchemy stores the ancestry and approvals; they are not an independent on-chain attestation.</p></details><p class="note">This is a saved artwork record, not a newly minted NFT.</p><a class="button" href="/#holder">Start your own fusion ✳</a></section>`;
  return document({ title, description, origin, path: `/characters/${request.id}`, image: request.artwork.url, content, script: true });
}

export function renderCharacterNotFound(origin) {
  return document({ title: 'Character not found — Chogchemy', description: 'Find a finished character in the Chogchemy family gallery.', origin, path: '/', image: '/brand/chogchemy-banner-v1.png', missing: true,
    content: '<section class="character-missing"><span class="eyebrow">STILL A BEAUTIFUL UNKNOWN</span><h1>This character<br>isn’t here yet.</h1><p>Public character pages appear after artwork is saved. Check your studio invitation for its progress, or explore the finished family.</p><a class="button" href="/#descendants">Explore the family ↗</a></section>' });
}
