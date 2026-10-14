# Implementation sources and choices

Checked 14 October 2026. These sources informed the hackathon audit improvements.

| Source | Choice in Chogchemy |
| --- | --- |
| [Chogathon rules and submission form](https://chogathon.chog.xyz/) | NFT essentiality is required; the published weights favor novelty, fun and return use. Submission video links use YouTube or Google Drive, up to three minutes. Current code lists a 9 October start and 23 October, 15:00 UTC submission deadline. |
| [ERC-721 specification](https://eips.ethereum.org/EIPS/eip-721) | Use `ownerOf` for current ownership and token IDs for a continuing character scrapbook. NFT transfers do not rewrite earlier creator attribution in the app. Fresh creation still checks ownership at dispatch. |
| [Imgflip API](https://imgflip.com/api) | Templates have different caption-box counts; the library is user-uploaded and changes over time. The 100-item file remains a dated source snapshot. Ten selected formats have local caption layouts and role presets; this is not a claim that all outputs are artist-approved. |
| [Sharp text input](https://sharp.pixelplumbing.com/api-constructor/) and [compositing](https://sharp.pixelplumbing.com/api-composite/) | Pango measures actual glyph width and wraps long words. Render exact captions locally over bounded image rectangles, instead of asking the model to spell them. |
| [Pango markup](https://docs.gtk.org/Pango/pango_markup.html) | Escape caption markup before rendering; users cannot inject color or formatting instructions. |
| [MetaMask deep links](https://github.com/MetaMask/metamask-docs/blob/main/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks.md) | Provide an explicit mobile wallet-browser link and instructions. Do not silently redirect users or claim WalletConnect support without implementing it. Real-device app handoff still needs a holder test. |
| [Railway public networking](https://docs.railway.com/networking/public-networking/specs-and-limits) | Railway documents edge headers, but the app does not trust arbitrary forwarded headers for authentication or throttling. Verified wallets have independent request buckets behind shared ingress; anonymous traffic stays socket-limited. |

## Visual validation

Two real saved AI meme scenes were read from the live site's public endpoints and checked against their public SHA-256 digests. Caption-export examples use those existing scenes, not additional AI requests or new creation records. The original records retain their bytes, captions and creator attribution.

The uncaptioned Drake scene can be reused directly. The older Bike image used outside caption bars; its scene is restored by cropping the known older layout and resizing. That export can be softer, and the website says so. Real-image review prompted moving its captions away from the character's face and body.

Automated tests establish input validation, storage, ownership transitions, export behavior and UI state. They do not establish visual fidelity across every template or independent user retention. The holder/artist review plan is in USER-TEST.md.
