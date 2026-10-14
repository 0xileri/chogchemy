# Test Chogchemy

## Public review — no wallet or drawing request

1. Open https://chogchemy.up.railway.app/examples. Compare the real Chog scenes, readable caption exports and saved family comic. Each example links to its original saved record. The exports do not count as new AI generations.
2. Open https://chogchemy.up.railway.app/chogs/1786. Inspect the original NFT, current ownership snapshot, all saved appearances and their original creator credits. Expand ownership details to see the check time. The studio rechecks ownership before new generation.
3. Open an original meme page. Download the PNG, enlarge it, try zoom/Escape, and copy its public link. Reopening needs no wallet.
4. Open https://chogchemy.up.railway.app/community. Read this week's prompt and its actual entry count. No completed opted-in entries means an honest empty wall.
5. On the homepage, browse ten recommended scenes, switch to all 100 and search. Pick Anakin/Padme or Gru to see four named caption fields. Tab in an empty field fills the complete suggestion and still advances focus. Space or the button also works; changing suggestions preserves edited text.
6. Watch https://chogchemy.up.railway.app/watch. The video records actual website interactions with synthetic narration using the Cillian preset from Higgsfield. After editing a Two Buttons draft, a labelled cut opens an existing real Drake result as a different saved example. Holder sign-in and a fresh AI drawing are not recorded.

## Holder creation and free caption export

Use a wallet that owns a Chog Genesis NFT on Monad mainnet. On a phone, use a supported wallet's built-in browser; the site provides an explicit Open in MetaMask link. Normal phone Safari/Chrome without an injected wallet cannot sign directly. Actual device handoff still needs testing.

1. Connect and sign the login message. It authorizes sign-in, not a transaction. Automatic discovery finds Chogs; manual token lookup remains a fallback. A displayed artwork number can differ from its on-chain token ID.
2. Select your Chog, a template and the character role. Recommended formats have two to four named text boxes. Write a joke or use complete suggestions. Other formats use two outside caption bars.
3. Choose whether to enter the weekly prompt; it is unchecked by default. Click Create my Chog meme once. One dispatched image request uses one drawing allowance, shared with family features.
4. Wait for the saved result. Reopen it from My memes or its studio link. Provider failures are not automatically retried.
5. As the original creator, change the text under Same scene. A new joke. Click Export with my captions and download the edited PNG. This calls no image provider and uses no drawing allowance. The public saved original remains unchanged. Older caption-bar scenes may be recovered at lower sharpness, with a visible notice.
6. Open the token passport. Later verified owners can make new memes for that token, while older creators retain attribution. Do not transfer an NFT merely for testing; this behavior is also covered by local transfer simulations.

Configured live limits are four dispatched attempts per accountable holder and ten globally per UTC day. Failed dispatched attempts count. The site shows actual remaining allowance and the local reset time. Availability depends on usage by all holders; public review does not require generation. Account/session changes clear author actions, and saved public links remain readable.

## Families remain available

Open https://chogchemy.up.railway.app/families. Select two distinct Chogs, review their images, choose facing and create a child. Partner approval remains optional in the default flow and is labelled honestly. A signed collaboration can require two distinct holders. A child, first comic, extra episode and sticker pack are separate drawing requests.

Saved real family:
https://chogchemy.up.railway.app/characters/5bf843d9408576096235b23092a73230331f0ca0ea0e2e624f0f8911c8422279#family-comic

Future family drawings require the recorded parent owners to remain unchanged. Existing artwork stays public. Sticker PNG/ZIP downloads do not automatically install into a chat app.

## Honest testing boundaries

The /demo sample and explicitly started scripts/preview-test.mjs are procedural fixtures, not evidence of AI quality. They are excluded from deployment and from passports/community entries. Automated tests cover authorization, persistence, idempotency, transfer checks, free export, request limits, text safety and frontend state. Two real meme scenes do not establish quality across 100 templates.

No NFTs are minted, burned or transferred. Authorship/history lives in the app database, not an on-chain registry. Smart-contract wallet sign-in is not supported. Independent holder feedback and return-use data are not yet established; the blank test plan is USER-TEST.md.
