# Chogchemy

Create a character from your Chog and another Chog, with optional partner approval, artist style references, and ancestry linked to the original NFTs. Built for Chogathon.

Live website: [chogchemy.up.railway.app](https://chogchemy.up.railway.app). Open it in a browser with MetaMask or Rabby to connect your holder wallet.

## Run locally

Use Node 24 (minimum 22.13) for native SQLite support.

```powershell
cd "C:\Users\HP\orbio build\chogchemy"
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000 in a browser with MetaMask or Rabby. For first setup, copy `.env.example` to `.env` without overwriting an existing file. Set `IMAGE_PROVIDER=orbio` and add a fresh `ORBIO_API_KEY` using your local editor to enable image generation, then restart the server. Alternatively, select `IMAGE_PROVIDER=openai` with `OPENAI_API_KEY`. Wallet verification and invitations work without an image API key. Keep credentials out of chat, browser code and Git. The Orbio adapter sends its credential only to Orbio; the direct OpenAI adapter uses a separate key.

`APP_ORIGIN` must exactly match the browser origin. `MONAD_RPC_URL` optionally overrides the public Monad endpoint. Run `npm.cmd run check` and `npm.cmd test` for syntax checks and automated tests. On macOS/Linux, use `npm` instead of `npm.cmd`.

## What works

- EIP-191 wallet sign-in, single-use five-minute challenges, and 30-minute HttpOnly sessions. Account/network changes clear the verified UI and log out.
- Live ownership verification for Chog Genesis on Monad mainnet: chain 143, contract `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`.
- Artwork previews for the selected holder NFT, both parent token inputs, and invitation parents. Entering the partner's token ID loads its artwork automatically; previews do not grant ownership or consent.
- Immutable 24-hour fusion requests. By default, verified ownership of Parent A allows its holder to create without extra signatures; Parent B's holder can optionally approve. Only the creator can dispatch generation in this mode, and only their holder quota is used. Two distinct NFTs in the same wallet are also supported.
- An optional **Require both holder signatures before fusion** checkbox creates an invitation between distinct holders that requires both signatures. Signatures bind the parent token IDs, holders, origin, chain, request, expiry, and hashed art direction. Existing invitations retain their original two-signature requirement.
- Server-side AI image editing using both NFT images plus optional artist references, after satisfying the request's approval policy and a fresh check of both owners at the same Monad block. Public ancestry and gallery entries show whether the partner actually signed.
- One saved PNG per invitation, public ancestry links, downloads and a shared gallery. Consent, provenance and image bytes persist together in SQLite.
- Public character pages at `/characters/<fusion-id>` for finished artwork, with parent NFT links, historical approval labels, downloads, artwork digest and social preview metadata. Viewing a page needs no wallet. Native sharing is available where supported, with a copy-link fallback; the gallery links to these pages.
- **Our Chog Family:** after saving a fusion child, the original creator can request one three-panel comic: the wedding, the new arrival, and a family picnic. Both original NFT images, the exact saved child PNG, and the artist references are sent to the image provider. Comics have their own storage and status, downloads, and a public section on the character page. This is a fictional character story; approvals for the original child are not presented as comic approvals.
- A dedicated demo at `/demo`, with procedural placeholder art and browser-local history. It requires no wallet, approval checkboxes, or AI calls.

The collection was identified through [Chog's official Linktree](https://linktr.ee/chognft) and [the linked OpenSea collection](https://opensea.io/collection/chog-genesis). Enter the on-chain token ID from the end of the OpenSea item URL; its displayed artwork number can differ. After login, automatic discovery searches the collection using batched on-chain owner reads at one block. The first scan takes a few seconds; a shared 30-second cache reduces repeated RPC work. The range is bounded by maxSupply (capped at 5,000), and the number of successful owner reads must match totalSupply before results are accepted. A changed wallet balance refreshes the cache. If discovery fails, manual lookup remains available. Up to 12 Chogs are shown per wallet; selecting a token always rechecks current ownership.

Detailed timestamps, block numbers and artwork hashes are available under **Record details** in the studio and public character pages.

## Test the fusion flows

1. Holder A connects and signs the login message. Their Chogs are found automatically; a sole Chog is selected and shown as Parent A, with **Change Chog** to choose another or use manual lookup. With several, choose one. Enter the other holder's token ID as Parent B.
2. Leave **Require both holder signatures before fusion** unchecked and click **Prepare fusion**. Review both NFT images and owners. Holder A can click **Create our character** immediately, with no additional signature. Holder B can use the shared link to **Add my optional approval** before generation; an unsigned partner is labelled clearly. An optional approval does not grant the partner permission to dispatch the creator's generation.
3. To test the collaboration flow, check **Require both holder signatures before fusion** before preparing a new request. Each holder clicks **Review my approval**, reads the complete message, checks the consent box, and signs. For local testing, use another browser profile on the same computer. Remote sharing requires a hosted HTTPS instance. The policy cannot be changed after creation; create a new request to choose another mode.
4. In the collaboration flow, either holder clicks **Create our character** once both approvals are saved. Parent images load first; either holder can cancel during preparation in both modes. After dispatch to the provider, generation cannot be cancelled.
5. Wait a few minutes; status updates automatically. The completed character, both parent links, download and gallery entry appear. You can leave and return to the invitation link later.
   Use **View character page** to open its public record, or **Share character** to share that page. A finished character stays visible after the invitation deadline; unfinished or missing characters return a helpful 404.
6. Restart the server and reopen the link: consent and artwork persist. Wallet login must be repeated to take actions.

7. After a child is saved, its original creator can click **Create our family comic**. The server verifies that both parent NFTs still have their recorded owners, then rechecks immediately before dispatch. The saved child's digest is verified and its PNG becomes the third image reference. Preparation can be cancelled; a dispatched comic is never automatically retried. View the finished comic, download it, or share the public family link. Comics remain readable after invitation expiry; no NFT is minted.

Without real holders, run `node scripts/preview-test.mjs`, then open http://localhost:3091. This isolated fixture has test wallets A/B, fake tokens 11/22 with original procedural preview art, and a procedural test PNG labelled **TEST ARTWORK**. It makes no real blockchain or AI calls. It verifies application behavior, not AI visual quality. Never deploy it. The test runner explicitly targets `test/*.test.mjs` so it does not start this fixture.

## Artist contribution

The Chogchemy identity kit is in [assets/brand/BRAND-GUIDE.md](assets/brand/BRAND-GUIDE.md): transparent logo and icon, social banner, palette, typography, and copy. Open `assets/brand/brand-preview.html` for the visual overview. The site uses this identity in its header, hero, parent preview accents, studio banner, footer, favicon, and social metadata. Social image/canonical URLs use the configured app origin. Only the three named PNGs are publicly served at `/brand/`; brand source documents remain private. These branding assets are separate from the artist reference drawings used for character generation.

Art direction version 2 uses the comic artist's supplied finished fusion drawing, `assets/artist/comic-fusion-reference-v1.jpg`, as a style reference. Bold black outlines, saturated colors, grainy texture and simple shading guide the output; the selected parent NFTs supply its features. This hand-drawn reference is separate from the generated gallery. The artist's display name and credit handle are still to be supplied.

Edit `art-direction.json` to refine the rules or add up to four approved PNG/JPEG/WebP drawings in `assets/artist/`, then list their filenames in `references`. Restart after changing it and prepare a new fusion to use the new style.

The style hash covers the rules, version, description and reference image hashes. Existing invitations using a different style cannot generate; create a fresh invitation for new consent. Legacy invitations from before this milestone also need fresh approvals. The Orbio adapter uses its OpenRouter-compatible `/api/v1/images` endpoint with `input_references`, model `openai/gpt-image-2`, one 1024 by 1024 PNG, and medium quality. The model is present in [Orbio's live image catalogue](https://api.orbio.so/api/v1/models?output_modalities=image). The optional direct OpenAI adapter uses its [image edits API](https://developers.openai.com/api/reference/resources/images/methods/edit). Model and quality are configurable per provider. No automatic fallback switches between paid providers. The Orbio request/response contract is covered by mocked tests; live paid generation still needs a fresh locally configured key.

## Persistence and failures

`data/chogchemy.sqlite` stores invitations, signatures, PNGs and provenance. Use SQLite's online backup mechanism or stop the app and checkpoint its WAL before copying the database. Never commit it. `DATABASE_PATH` can point to a persistent disk. Sessions and the mutation queue are in memory: run exactly one server process/instance.

Generation follows `approved → preparing → generating → generated`. Reference-loading errors return to `approved` and can be retried without an AI call. After dispatch, any provider timeout/error becomes `generation_failed` and is never automatically retried because it may have been charged. On restart, interrupted preparation returns to approved; an interrupted provider call becomes failed. A new invitation permits another attempt, subject to quotas.

Defaults allow 10 dispatched attempts globally and two per accountable holder per UTC day: the creator in optional approval mode, or both participants when two signatures are required. Each family comic consumes one attempt for the original creator, using the same global limit and concurrency pool as fusions. Referencing another holder's Chog in optional mode does not consume their quota. At most two jobs can prepare/generate concurrently. Failed provider attempts also count. Quotas persist across restarts. These cap request counts, not dollars; configure a provider spending budget separately.

Only HTTPS IPFS paths on explicitly trusted gateway hosts are fetched server-side, with every redirect checked. Metadata is capped at 1 MB, references at 12 MB each, and output at 25 MB. Authenticated artwork previews use the same server-side loader and trusted gateway fallback, avoiding browser CORS failures. The preview cache lasts five minutes and is bounded to 40 entries/64 MB, with at most four loads in progress. Token input changes clear stale artwork immediately and load after a short debounce. A preview failure leaves ownership and invitation checks available.

Orbio requests have an additional conservative 4 MB combined JSON limit, checked before dispatch or quota reservation. Use small artist reference files. The adapter uses ordinary image inference; Orbio's Incognito encrypted mode currently supports text only and cannot serve this image flow. The app never changes account privacy settings. See [Orbio's setup guide](https://www.orbio.so/incognito/setup.md).

## Limitations

Original NFTs stay in their holders' wallets. There is no token spending, minting, burn or transfer. Descendants are artwork records with database ancestry, not new NFTs or on-chain ancestry. Smart-contract wallets/EIP-1271 are not supported yet.

The first family episode uses one square PNG with three horizontal panels. The website supplies chapter titles; the AI is instructed to draw without lettering. The saved child is provided as a visual reference, but exact visual consistency and panel composition still depend on the model. A comic is a separate creator-authorized request, using the artist style active when it is requested; completed child artwork is preserved. New comics require unchanged ownership of both recorded parent NFTs. A failed comic leaves the original character available. Interrupted preparation is retryable, while an interrupted dispatched comic is terminal because it may have been charged.

Ownership is checked at invitation creation, approval preparation/acceptance, rechecks, generation requests, and immediately before the provider call. Detected transfers permanently invalidate consent. Transfers away and back between checks are not detected without event tracking. Finished artwork remains a historical record after later transfers or invitation expiry.

Image bytes can be checked against their SHA-256 digest, but the server/database are trusted; lineage is not independently attested on-chain. AI visual quality and live paid generation still require testing with a configured account and real parent references.

## Hosting and team

See [DEPLOY.md](DEPLOY.md) for the live Railway deployment, verification and budget notes. The existing `Dockerfile` also supports Render using `render.yaml`. Both need one web service with persistent storage and `/healthz`. The Railway volume starts with no local artwork or invitations; wallet sessions must be renewed after deployments.

- Developer: wallet and ownership checks, consent, image integration, persistence and hosting.
- Comic artist: original style guide, approved reference drawings, sample fusions and output review.

For submission, gather real holder feedback, record a demo under three minutes, and disclose sample/test fixtures and any pre-existing work.
