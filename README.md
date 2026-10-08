# Chogchemy

Two Chog holders create one new character, with signed consent, artist style references, and ancestry linked to their original NFTs. Built for Chogathon.

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
- Immutable 24-hour invitations between two distinct holders, with separate signatures binding the parent token IDs, holder addresses, origin, chain, collection, request, expiry, and hashed art direction.
- Server-side AI image editing using both NFT images plus optional artist references, after both approvals and a fresh check of both owners at the same Monad block.
- One saved PNG per invitation, public ancestry links, downloads and a shared gallery. Consent, provenance and image bytes persist together in SQLite.
- A separate sample lab with procedural placeholder art, simulated consent, and browser-local family history. Its approvals are not trusted authorization.

The collection was identified through [Chog's official Linktree](https://linktr.ee/chognft) and [the linked OpenSea collection](https://opensea.io/collection/chog-genesis). Enter the on-chain token ID from the end of the OpenSea item URL; its displayed artwork number can differ. After login, automatic discovery searches the collection using batched on-chain owner reads at one block. The first scan takes a few seconds; a shared 30-second cache reduces repeated RPC work. The range is bounded by maxSupply (capped at 5,000), and the number of successful owner reads must match totalSupply before results are accepted. A changed wallet balance refreshes the cache. If discovery fails, manual lookup remains available. Up to 12 Chogs are shown per wallet; selecting a token always rechecks current ownership.

## Test with two holders

1. Holder A connects and signs the login message. Their Chogs are found automatically; a sole Chog is selected and fills Parent A. With several, choose one. Enter the other holder's token ID as Parent B.
2. Create the invitation. Review both NFT links and owners, click **Review my approval**, read the complete message, check the consent box, and sign.
3. Share the invitation link. Holder B connects and reviews/signs their own approval. For local testing, use another browser profile on the same computer. Remote sharing requires a hosted HTTPS instance.
4. Either holder clicks **Create our character** once both approvals are saved. Parent images load first; either holder can cancel during preparation. After dispatch to the provider, generation cannot be cancelled.
5. Wait a few minutes; status updates automatically. The completed character, both parent links, download and gallery entry appear. You can leave and return to the invitation link later.
6. Restart the server and reopen the link: consent and artwork persist. Wallet login must be repeated to take actions.

Without real holders, run `node scripts/preview-test.mjs`, then open http://localhost:3091. This isolated fixture has test wallets A/B, fake tokens 11/22 with original procedural preview art, and a tiny deterministic generated PNG labelled **TEST ARTWORK**. It makes no real blockchain or AI calls. It verifies application behavior, not AI visual quality. Never deploy it. The test runner explicitly targets `test/*.test.mjs` so it does not start this fixture.

## Artist contribution

Edit `art-direction.json` with your partner's style rules. Place up to four approved PNG/JPEG/WebP drawings in `assets/artist/`, then list their filenames in `references`. The house style is currently provisional; no partner artwork is included yet. Restart after changing it.

The style hash covers the rules, version, description and reference image hashes. Existing invitations using a different style cannot generate; create a fresh invitation for new consent. Legacy invitations from before this milestone also need fresh approvals. The Orbio adapter uses its OpenRouter-compatible `/api/v1/images` endpoint with `input_references`, model `openai/gpt-image-2`, one 1024 by 1024 PNG, and medium quality. The model is present in [Orbio's live image catalogue](https://api.orbio.so/api/v1/models?output_modalities=image). The optional direct OpenAI adapter uses its [image edits API](https://developers.openai.com/api/reference/resources/images/methods/edit). Model and quality are configurable per provider. No automatic fallback switches between paid providers. The Orbio request/response contract is covered by mocked tests; live paid generation still needs a fresh locally configured key.

## Persistence and failures

`data/chogchemy.sqlite` stores invitations, signatures, PNGs and provenance. Use SQLite's online backup mechanism or stop the app and checkpoint its WAL before copying the database. Never commit it. `DATABASE_PATH` can point to a persistent disk. Sessions and the mutation queue are in memory: run exactly one server process/instance.

Generation follows `approved → preparing → generating → generated`. Reference-loading errors return to `approved` and can be retried without an AI call. After dispatch, any provider timeout/error becomes `generation_failed` and is never automatically retried because it may have been charged. On restart, interrupted preparation returns to approved; an interrupted provider call becomes failed. A new invitation permits another attempt, subject to quotas.

Defaults allow 10 dispatched attempts globally and two per participating holder per UTC day, with at most two jobs preparing/generating concurrently. Failed provider attempts also count. Quotas persist across restarts. These cap request counts, not dollars; configure a provider spending budget separately.

Only HTTPS IPFS paths on explicitly trusted gateway hosts are fetched server-side, with every redirect checked. Metadata is capped at 1 MB, references at 12 MB each, and output at 25 MB. Authenticated artwork previews use the same server-side loader and trusted gateway fallback, avoiding browser CORS failures. The preview cache lasts five minutes and is bounded to 40 entries/64 MB, with at most four loads in progress. Token input changes clear stale artwork immediately and load after a short debounce. A preview failure leaves ownership and invitation checks available.

Orbio requests have an additional conservative 4 MB combined JSON limit, checked before dispatch or quota reservation. Use small artist reference files. The adapter uses ordinary image inference; Orbio's Incognito encrypted mode currently supports text only and cannot serve this image flow. The app never changes account privacy settings. See [Orbio's setup guide](https://www.orbio.so/incognito/setup.md).

## Limitations

Original NFTs stay in their holders' wallets. There is no token spending, minting, burn or transfer. Descendants are artwork records with database ancestry, not new NFTs or on-chain ancestry. Smart-contract wallets/EIP-1271 are not supported yet.

Ownership is checked at invitation creation, approval preparation/acceptance, rechecks, generation requests, and immediately before the provider call. Detected transfers permanently invalidate consent. Transfers away and back between checks are not detected without event tracking. Finished artwork remains a historical record after later transfers or invitation expiry.

Image bytes can be checked against their SHA-256 digest, but the server/database are trusted; lineage is not independently attested on-chain. AI visual quality and live paid generation still require testing with a configured account and real parent references.

## Hosting and team

See [DEPLOY.md](DEPLOY.md). `Dockerfile` and `render.yaml` prepare one Render web service with a persistent disk and `/healthz`. This uses paid hosting: review the quote before creating it. No deployment has been completed yet.

- Developer: wallet and ownership checks, consent, image integration, persistence and hosting.
- Comic artist: original style guide, approved reference drawings, sample fusions and output review.

For submission, gather real holder feedback, record a demo under three minutes, and disclose sample/test fixtures and any pre-existing work.
