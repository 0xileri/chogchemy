# Chogchemy

Make your verified Chog a recurring character in memes, with a passport that keeps its creative history as ownership changes. Families, comics and stickers remain in the separate family studio. Built for Chogathon by [@0xileri](https://x.com/0xileri), with original artist references and art direction from [@theejhay01](https://x.com/theejhay01).

Website: https://chogchemy.up.railway.app

- [Real output tour](https://chogchemy.up.railway.app/examples)
- [Chog #1786 passport](https://chogchemy.up.railway.app/chogs/1786)
- [Weekly prompt](https://chogchemy.up.railway.app/community)
- [Family studio](https://chogchemy.up.railway.app/families)
- [Demo video preview](https://chogchemy.up.railway.app/watch)

## Run locally

Use Node 24, minimum 22.13 for native SQLite.

```powershell
cd "C:\Users\HP\orbio build\chogchemy"
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000. PowerShell users should use npm.cmd to avoid npm.ps1 execution-policy restrictions. On macOS/Linux use npm.

For first setup, copy .env.example to .env without overwriting an existing file. Set IMAGE_PROVIDER=orbio and ORBIO_API_KEY locally, or use the separate direct OpenAI configuration. Keep keys out of chat, Git and browser code. APP_ORIGIN must match the browser's origin. MONAD_RPC_URL optionally replaces the public RPC. Wallet checks and public browsing do not require an image key.

```powershell
npm.cmd run check
npm.cmd test
```

## The main meme studio

Connect a Chog holder wallet, select the NFT, choose a template and create a scene. The server verifies ownership before preparation and immediately before provider dispatch. The actual NFT, the selected scene and two artist drawings become the image references; users cannot substitute arbitrary image URLs.

The default selection shows ten recommended templates with two to four named caption boxes and readable character roles. All 100 templates in the dated Imgflip snapshot remain searchable. The recommended list is selected for a simple starting point, not a guarantee of AI quality or artist approval. Category overrides and normalized layout geometry live in assets/memes/layouts.json; the original source snapshot remains unchanged. See [catalog provenance](docs/MEME-CATALOG.md).

Each recommended template has two complete caption suggestions. Other templates retain two top/bottom ideas. Tab in an empty field fills a suggestion and advances focus normally. Mobile Space/beforeinput and a visible button also work. Cycling and template changes preserve manually edited text.

Captions are drawn locally with Sharp/Pango so spelling is exact and glyphs wrap within available pixels. Recommended formats use scene-specific boxes; others use outside bars. Model composition can still differ from the template. The provider is asked to keep caption regions clear.

Saved meme PNGs have public pages, sharing, downloads and private My memes navigation. Requests are immutable and idempotent. New provider scenes are saved separately and atomically with their original captioned PNG and provenance.

### Free caption edits

The original creator can export new captions from a saved scene without calling AI or using drawing allowance. POST /api/memes/:id/recaption requires a valid creator session and same-origin request. It returns a PNG rather than creating or replacing a public record. Captions use canonical box IDs and bounded text; the raw scene is not publicly served. Two exports may run concurrently.

The original saved PNG, captions, digest and creator credit remain unchanged. A later NFT owner can create a fresh meme but cannot edit someone else's creation. An earlier creator can still export captions for their own saved art after selling the NFT; that does not grant new AI-generation authority.

Legacy uncaptioned images can be reused directly. Older outside-caption images recover their square scene from the known original layout; this can soften it. A notice explains that fallback. Unknown or damaged layouts keep their original downloads but fail free export safely.

## Chog passports and weekly prompts

/chogs/:tokenId groups real saved memes and family appearances by token, rather than creator wallet. It preserves each original creator's credit and links to the actual NFT. Current ownership uses a bounded 30-second cache with a displayed check time; the studio independently checks it again before creating. New verified owners can continue the same character history. This app scrapbook does not alter NFT metadata or transfer copyright.

Passports exclude procedural fixtures, unknown output modes and foreign collection/origin records. Ownership/RPC failure leaves history readable with an honest unavailable state. Public original-art previews use bounded trusted reference loading; private holder preview endpoints remain authenticated.

/community displays a weekly UTC prompt and completed real memes explicitly opted into it. The prompt changes Monday at 00:00 UTC. Joining is unchecked by default; URL parameters never silently enter a creation. Old entries stay in their token history. Empty weeks show zero, without fabricated votes, winners or engagement.

The /examples tour uses two real saved AI scenes with local caption-export examples and a saved family comic. Exports are labelled and do not count as additional generations, creations or users.

## Families

/families retains the original flow and old /?fusion= links continue to work. A verified Parent A holder selects a distinct Parent B, previews both and chooses automatic, left or right facing. Partner approval remains optional by default. A separate optional invitation policy can require both distinct holders to sign a policy-bound message.

AI uses both actual parent images and the artist references to draw a saved child. Its original creator can request a first three-panel comic, then adventure, school or birthday episodes, or a six-reaction sticker pack. These are separate drawing requests. New family drawings check that recorded parent ownership has not changed; saved results remain historical public records after transfers.

Sticker exports include six transparent PNGs and a ZIP. Users import them with their chat app's supported tool; the ZIP does not install automatically. Layout and character fidelity still depend on the image model.

## Wallets, storage and generation safety

Chog Genesis on Monad mainnet: chain 143, collection 0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763. Selection always checks the on-chain token ID, which can differ from a displayed artwork number. Automatic discovery is bounded to 5,000 candidates and returns up to 12 Chogs, with manual lookup as a fallback.

Sign-in uses single-use five-minute EIP-191 challenges and 30-minute HttpOnly sessions. Account/network/session changes clear author actions and stale caption exports. Desktop wallets need an injected provider; phones can use a wallet browser through the explicit MetaMask deep link. Real-device handoff still needs a holder test. Smart-contract wallet/EIP-1271 sign-in is unsupported.

SQLite stores records, original artwork, raw meme scenes, comics, episodes and stickers. DATABASE_PATH must point to persistent storage. New tables preserve older records. Use SQLite's online backup or stop/checkpoint the WAL before copying; never commit the database. Sessions and the mutation queue are in memory, so run one process/replica.

Generation is approved → preparing → generating → generated. Preparation can be cancelled or retried. Potentially charged dispatch failures are terminal and never automatically retried or switched to another provider. Restart recovery follows the same rule. References are restricted to trusted hosts, redirects and image sizes are checked, and oversized Orbio requests use compressed copies without changing saved originals.

Memes and family drawings share quotas and a two-job concurrency pool. Live limits are currently four dispatched attempts per accountable holder and ten globally per UTC day; development defaults are two and ten. Failed dispatched attempts count. These are request limits, not a dollar budget. Free caption exports are separate and do not count. Verified wallets have independent API rate buckets behind shared ingress; arbitrary forwarded headers are not trusted.

Orbio uses server-side credentials, model openai/gpt-image-2, one square PNG and medium quality. The direct OpenAI adapter uses a separate key. See [deployment notes](DEPLOY.md) and [implementation research](docs/RESEARCH-NOTES.md).

## Art direction and motion

Art direction v3 uses two original drawings in assets/artist. Their outlines, colors and texture guide rendering; the selected NFT images supply the characters. Models are told not to copy unrelated accessories from the style references. The style hash includes rules and reference digests; changed direction requires a fresh request.

The brand kit retains the original logo and family banner. The meme banner v2 says “Your Chog. Every meme.” and is documented in [BANNER-V2.md](assets/brand/BANNER-V2.md). AI branding assets are separate from the partner's hand-drawn references.

Motion uses native browser APIs for reveals, subtle zoom, click feedback and artwork dialogs. Content remains visible if scripts fail. Reduced-motion preferences disable decorative effects; enlarged artwork supports Escape, focus return and small screens.

## Tests, disclosures and limits

For an isolated synthetic browser test, explicitly run node scripts/preview-test.mjs and open localhost:3091. Its ephemeral accounts and procedural images are clearly labelled. It makes no real chain or image-provider calls and is excluded from deployment. The /demo page is also procedural; neither proves AI quality.

NFTs are not minted, burned, transferred or spent. Artwork/history is stored in a trusted application database, not independently attested on-chain. There is no $CHOG or $CHMY integration.

Git history dates the initial scaffold to 8 October 2026, before the current official 9 October start. The submission discloses that earlier work. Artist-reference creation dates remain unconfirmed. Existing collection/template/model/library assets and coding assistance are disclosed. Independent holder feedback, artist review and repeat-use evidence are still to be gathered honestly.

Submission materials: [draft](docs/SUBMISSION.md), [judge guide](docs/JUDGE-GUIDE.md), [video script](docs/DEMO-SCRIPT.md), [holder test](docs/USER-TEST.md). The final competition video must use YouTube or Google Drive; the website MP4 is a preview/download, not an accepted submission host.
