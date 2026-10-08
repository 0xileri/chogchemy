# Chogchemy

Two Chogs. Something unexpected.

Chogchemy is a Chogathon project where two verified holders authorize an artist-guided AI character fusion with ancestry linked to the original NFTs.

## Run

Requires Node.js 22.13 or newer (Node 24 recommended). The live wallet feature uses viem and the public Monad RPC. No API keys are needed.

```sh
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000. Run `npm.cmd run check` for JavaScript syntax checks and `npm.cmd test` for authentication and ownership tests. On macOS/Linux, use `npm` in place of `npm.cmd`.

The app supports `.env` on Node 22+ (copy `.env.example` if needed). `MONAD_RPC_URL` can override the public endpoint. `APP_ORIGIN` must match your browser address exactly; use HTTPS for a hosted deployment.

## Current prototype

Responsive fusion lab, four original placeholder characters, simulated dual approval, procedural SVG fusion previews, and a browser-local family history. Select two distinct parents, check both simulated approvals, and create a fusion. Refresh to confirm local persistence.

The separate **Your Chog** section connects an injected browser wallet (such as MetaMask or Rabby), switches to Monad mainnet, and requests an EIP-191 login signature. The server verifies this signature against a single-use five-minute challenge before issuing a 30-minute HttpOnly session. This currently supports standard externally owned accounts; smart-contract wallet signatures are not yet supported. Account/network changes clear the UI and log out.

The server reads `balanceOf`, `ownerOf`, and `tokenURI` from Chog Genesis at `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763` on chain 143. The address comes from item links in the [officially linked collection](https://opensea.io/collection/chog-genesis), via [Chog's Linktree](https://linktr.ee/chognft). The RPC chain ID is checked before reads. The collection does not advertise ERC-721 enumeration in our live check, so holders enter a token ID from the end of their OpenSea item URL. The displayed artwork name/number can differ from this on-chain token ID. Enumeration is supported automatically if available, capped at 12 tokens per refresh.

Metadata and images load directly in the browser from HTTPS/IPFS URLs; a CORS or gateway failure leaves ownership confirmation visible with an OpenSea link. The server does not fetch arbitrary metadata URLs.

**Real invitations and signed fusion consent are implemented.** A verified holder supplies two distinct on-chain token IDs held by different wallets. The server checks both owners at the same Monad block and creates an immutable 24-hour invitation. Each holder reviews and signs a separate fusion permission message that binds the app origin, chain, contract, parent tokens, holder addresses, unique request ID, expiry, and versioned art direction. Both signatures are required for the `approved` state. Sign-in alone never approves a fusion. Either invited holder can cancel, including after both have signed.

Ownership is checked when preparing each approval, accepting each signature, and explicitly rechecking a request. A detected transfer permanently invalidates the invitation. GET invitation pages show the last checked block/time; they do not continuously monitor transfers. A future generation handler must recheck both current owners, expiry, and cancellation immediately before starting its one permitted generation. A transfer away and back between checks is not detected without transfer-event tracking.

Invitations and signatures are persisted in `data/chogchemy.sqlite` using built-in Node SQLite; preserve that file and its WAL on a persistent disk. They survive restarts; login sessions do not. Public invitation responses omit raw signatures. The app currently supports one server process; use shared coordination/storage before scaling horizontally. The art direction identifier is bound to consent and cannot be silently changed for an existing invitation. Artist references and the actual generation pipeline remain to be connected.

AI generation, minting, and on-chain ancestry are **not implemented yet**. The sample lab remains independent of real holdings, and its approvals and locally stored ancestry are untrusted demo data. Placeholder artwork is not official Chog art.

Sessions and challenges are held in process memory and reset on server restart; use shared storage before scaling to multiple instances. No private keys are requested or stored.

## Test the wallet milestone

1. Open http://localhost:3000 with an injected wallet extension.
2. Click **Connect wallet**, switch to Monad if asked, and inspect/sign the login message.
3. Check the holder balance. If you own a Chog, enter its on-chain token ID from the OpenSea URL.
4. Confirm artwork/traits when the metadata gateway permits browser access. A token owned by another address must be rejected.
5. Switch accounts or networks: the verified preview must clear. Reconnect to reverify.
6. Try the sample lab without any wallet connection. No real NFT is needed for that demo.

## Test real invitations

1. Sign in as the holder of Parent A. In **Invite your other half**, enter Parent A's token ID and a different holder's token ID for Parent B.
2. Create the invitation. Inspect both parent links and the holders. Click **Review my approval**, read the entire message, check the explicit consent box, and sign.
3. Copy the invitation link. Open it with Parent B's wallet, connect, and review/sign the second approval. On localhost, test with another browser profile on the same computer; a localhost link cannot be used by a partner on another computer. Remote sharing requires a hosted instance with `APP_ORIGIN` set to its HTTPS URL.
4. Refresh the invitation to see both approvals. No AI image or NFT is created at this stage.
5. Use **Recheck ownership** to verify the current owners again, or **Cancel invitation** as either holder. Requests also expire after 24 hours.
6. Restart the server and reopen the link: the invitation and signatures persist. Reconnect the wallet to act on it.

For repeatable browser tests without real holders, `node scripts/preview-test.mjs` starts an isolated, clearly labelled fixture at http://localhost:3091 with two synthetic wallets, fake tokens 11 and 22, and an in-memory store. This script is never loaded by `npm run dev` or `npm start`; it makes no real-chain calls. Never deploy the fixture.

## Build milestones

1. Collection contract, network, and token metadata confirmed via read-only Monad calls. Confirm artwork permissions/style direction with Chog and the artist.
2. Wallet sign-in and current ownership verification implemented.
3. Fusion invitations, persistent dual signatures, cancellation, expiry, and ownership rechecks implemented. Connect the generation handler to the same checks next.
4. Incorporate the comic artist's approved style guide and references into server-side AI image generation. Keep provider keys on the server.
5. Persist approved descendants and parent references in a database; add shared family-tree pages. Descendants are artwork records initially, not automatically new NFTs.
6. Collect holder feedback, record a demo under three minutes, and provide judge testing instructions.

## Team responsibilities

- Developer: app, ownership checks, consent flow, generation integration, persistence.
- Artist: original style direction, sample fusions, feature-combination rules, output review.

Original Chog NFTs stay in their holders' wallets. Permissions must expire or become invalid when ownership changes. Do not accept client-side approval flags as authorization in production.
