// MetaMask documents this route for its mobile wallet browser. Navigation is opt-in.
export function metamaskBrowserLink(pageUrl) {
  const url = new URL(pageUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use the Chogchemy website address.');
  // Query strings and hashes belong to the target page, not the outer deep link.
  return `https://link.metamask.io/dapp/${url.host}${url.pathname}${url.search.replace(/\?/g, '%3F')}${url.hash.replace(/#/g, '%23')}`;
}
export function mountWalletBrowserHelp({ document, pageUrl, hasProvider }) {
  const status = document.getElementById('wallet-status');
  if (!status) return null;
  let help = document.getElementById('wallet-browser-help');
  if (!help) {
    help = document.createElement('aside'); help.id = 'wallet-browser-help'; help.className = 'wallet-browser-help';
    const title = document.createElement('strong'); title.textContent = 'Creating on your phone?';
    const instructions = document.createElement('p'); instructions.textContent = 'Open Chogchemy in your wallet’s built-in browser, then connect the account that holds your Chog. In MetaMask, use its browser to visit this page.';
    const link = document.createElement('a'); link.id = 'wallet-browser-link'; link.className = 'button secondary'; link.textContent = 'Open in MetaMask ↗'; link.href = metamaskBrowserLink(pageUrl);
    const note = document.createElement('p'); note.className = 'note'; note.textContent = 'If the link does not open from X or Discord, open this page in Safari or Chrome first. On desktop, use a wallet extension such as MetaMask or Rabby.';
    help.append(title, instructions, link, note); status.insertAdjacentElement('afterend', help);
  }
  help.hidden = Boolean(hasProvider);
  return help;
}
