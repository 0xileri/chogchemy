// Isolated browser-test harness. No real wallets, NFTs, RPC calls, or production database.
// Start explicitly with `node scripts/preview-test.mjs`; never use for deployment.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApplication } from '../src/application.mjs';
import { fixtureArt } from './fixture-art.mjs';

const accounts = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
const origin = 'http://localhost:3091';
const ids = ['11', '22'];
const chain = {
  async owners(tokens) { return { owners: tokens.map(id => { const index = ids.indexOf(id); if (index < 0) throw new Error('Unknown test token'); return accounts[index].address; }), blockNumber: 12345n }; },
  async balance() { return 1n; },
  async ownedTokenIds(address) { return [ids[accounts.findIndex(a => a.address.toLowerCase() === address)]]; },
  async token(id) { return { owner: (await this.owners([id])).owners[0], tokenURI: 'data:application/json,' + encodeURIComponent(JSON.stringify({ name: `Test Chog #${id}`, image: `data:image/png;base64,${fixtureArt(id === '22').toString('base64')}`, attributes: [{ trait_type: 'Fixture', value: 'Synthetic NFT for browser tests' }] })) }; },
};
const fixturePng = fixtureArt(true);
const app = createApplication({ chain, origin, generationOptions: {
  loadReference: async (_, tokenId) => ({ tokenId, bytes: fixturePng, mime: 'image/png', name: 'Synthetic parent', traits: [] }),
  imageGenerator: { configured: true, mode: 'fixture', model: 'synthetic-test', async generate() { return { bytes: fixturePng, mode: 'fixture', model: 'synthetic-test' }; } },
} });
const html = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).replaceAll('__APP_ORIGIN__', origin).replace('<body>', `<body><aside style="padding:16px;background:#ffe7a0;color:#302600;position:relative">LOCAL TEST FIXTURE · Synthetic wallets and NFTs only. <button id="test-a">Test wallet A</button> <button id="test-b">Test wallet B</button> <span id="test-account">Wallet A selected</span></aside><script>
let slot = 0; const accounts = ${JSON.stringify(accounts.map(a => a.address))}; const listeners = new Map();
window.ethereum = {
  async request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [accounts[slot]];
    if (method === 'eth_chainId') return '0x8f';
    if (method === 'personal_sign') {
      const message = new TextDecoder().decode(Uint8Array.from(params[0].slice(2).match(/../g), byte => parseInt(byte, 16)));
      const r = await fetch('/__test/sign', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({slot,message}) });
      return (await r.json()).signature;
    }
    throw new Error('Unsupported fixture wallet request');
  },
  on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
  removeListener(event, callback) { listeners.get(event)?.delete(callback); }
};
function switchWallet(next) { slot = next; document.getElementById('test-account').textContent = 'Wallet ' + (slot === 0 ? 'A' : 'B') + ' selected'; for (const callback of listeners.get('accountsChanged') || []) callback([accounts[slot]]); }
document.getElementById('test-a').onclick = () => switchWallet(0); document.getElementById('test-b').onclick = () => switchWallet(1);
</script>`);
createServer(async (req, res) => {
  if (req.method === 'GET' && new URL(req.url, origin).pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); return; }
  if (req.method === 'POST' && req.url === '/__test/sign') {
    try {
      if (req.headers.origin !== origin) throw new Error('Wrong origin');
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 10000) throw new Error('Too large'); }
      const { slot, message } = JSON.parse(text);
      if (![0, 1].includes(slot) || typeof message !== 'string') throw new Error('Bad fixture request');
      const signature = await accounts[slot].signMessage({ message });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ signature }));
    } catch { res.writeHead(400); res.end('{}'); }
    return;
  }
  await app(req, res);
}).listen(3091, '127.0.0.1', () => console.log(`Synthetic browser fixture: ${origin}`));
