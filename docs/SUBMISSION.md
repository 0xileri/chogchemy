# Chogchemy — submission draft

## Project and team

Project / team: **Chogchemy**

Builder: **@0xileri** — https://x.com/0xileri

Comic artist: **@theejhay01** — https://x.com/theejhay01

Builder Discord: **@0xileri**

Artist Discord: **[Add if required by the submission form]**

Website: https://chogchemy.up.railway.app

Repository: https://github.com/0xileri/chogchemy (currently private; @0xileri plans to make it public when the build is finished, before judge review).

Demo video: https://chogchemy.up.railway.app/watch

Direct MP4: https://chogchemy.up.railway.app/demo-video.mp4

The video is a narrated screenshot walkthrough of live pages and saved real results, with synthetic voice narration. Duration: about 2 minutes 52 seconds. It does not present image generation as instant.

## Project pitch, one line

Chogchemy turns two Chog NFTs into an artist-guided AI child and a family comic, saved with links to the original parents.

## What we built

Chogchemy lets a Chog Genesis holder create a fictional family from two real Chog NFTs. Connect a holder wallet, choose two parents, create their child, then request a three-scene family comic: a wedding, a new arrival, and a family picnic. The comic uses the saved child as a reference so the story builds on the character already created.

The studio uses two original fusion drawings from our collaborating comic artist, @theejhay01, to guide its outlines, color, texture and shading. The second example combines mushrooms with a cap and a green face with skull teeth; it guides how traits can interact when they are present in the selected parents. The model is told to take character features from the actual parents, rather than copy accessories from the artist references. AI generates the final child and comic. Both are saved, downloadable, and viewable on a public family page alongside the two parent NFT links and the recorded approval status. The family creator can also make a six-reaction sticker pack for chats: GM, crying, celebrating, hugs, sleepy and send help. A single image request creates the whole pack, exported as six transparent PNGs and a ZIP. A first comic is not required for stickers.

The distinctive experience is the complete chain from owned Chogs to a child to a family story. The artist supplies a recognizable visual direction, while the NFTs supply the specific parents and the holder supplies the authority to create.

## Why the Chog NFT matters

A verified Chog Genesis holder wallet unlocks the real studio. The server checks the two parent NFTs and their owners, uses their actual artwork to guide the child, and records their token IDs as its roots. The family comic uses those same parents plus the saved child. Ownership is checked again before generation; a changed parent owner prevents a new comic for that family.

Take the Chog NFTs out and the holder checks, selection of real parent characters, and NFT-linked family record stop working. The no-wallet sample lab only demonstrates procedural placeholders; it does not create real Chog families or AI comics.

## Working demo and testing instructions

Start here: https://chogchemy.up.railway.app

Saved real result from Chogs #1786 and #1870:
https://chogchemy.up.railway.app/characters/5bf843d9408576096235b23092a73230331f0ca0ea0e2e624f0f8911c8422279

Saved comic:
https://chogchemy.up.railway.app/characters/5bf843d9408576096235b23092a73230331f0ca0ea0e2e624f0f8911c8422279#family-comic

No-wallet sample lab: https://chogchemy.up.railway.app/demo

See JUDGE-GUIDE.md for a short public review and the holder flow. The public result needs no wallet and makes no new generation request. New generation uses the configured image provider and drawing allowance.

## Under the hood

- Plain HTML, CSS and JavaScript frontend.
- Node.js HTTP backend with persistent SQLite storage on Railway.
- viem for wallet message verification and Monad ownership reads.
- Chog Genesis on Monad mainnet, chain ID 143.
- Collection: 0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763.
- Orbio image API using openai/gpt-image-2, server-side credentials and reference images.
- Sharp compresses oversized request copies while preserving saved originals.
- EIP-191 sign-in, optional partner approval, fresh ownership checks, and bounded drawing requests.

## Pre-existing materials and disclosures

Chog Genesis is an existing collection; the two parents are existing NFTs. @theejhay01 supplied two original hand-drawn fusion references. Existing open-source libraries and the hosted image model provide infrastructure; coding assistants were used during development. The sample lab and automated fixtures generate procedural placeholder images and are labelled separately from real AI artwork. Local fixtures are excluded from deployment.

The project was developed during this Chogathon build. Confirm both artist references' creation dates and disclose any work created before the event if applicable.

Outputs are artwork records, not minted NFTs. Original NFTs remain in their wallets. Family roots are stored in our database and are not independently attested on-chain. Optional partner approval is labelled honestly; an unsigned partner is not presented as having consented. Existing child approval signatures are not reused as approval for the comic. The project currently has no $CHOG or $CHMY spending integration.

## Feedback and usage

Early feedback from the builder's own live testing surfaced three problems: a comic button that appeared unresponsive, an oversized reference request, and confusion about finding saved children versus comics. We improved error messages, reduced oversized request copies, added a visible My creations section, separated the child and comic steps, and displayed the remaining drawing allowance.

The public gallery currently includes a saved child and completed family comic from Chogs #1786 and #1870. A separate earlier child for the same pair is also visible. These records demonstrate successful saving; they are not a count of unique users. Independent holder feedback and retention data are still to be gathered.

## What's next

Next we will test with more Chog holders, review the generated families with our comic artist, and collect feedback on whether the child clearly inherits traits from both parents and remains recognizable in the comic.

Saved families can now create three more episodes: a first adventure, a first school day, and a birthday surprise. Each story is available once per family, keeps the same parent NFTs and saved child, and uses one additional drawing request. The earlier artwork remains saved. Ownership and quotas are checked again before dispatch. Independent retention data is still to be gathered.

Future work includes more story choices and opt-in collaborations between holders. We will use feedback to test repeat use before expanding the story system.

## Before submitting

1. Builder Discord is @0xileri. Add the artist's Discord if required, and check that the deployed video URL plays for judges.
2. When the build is finished, @0xileri will make the repository public. Verify judge access before submitting.
3. Confirm the pre-existing-work disclosure with both team members.
4. Sign in to the existing Chogathon application. The registration page checked on 11 October 2026 says registrations are closed, with sign-in available for existing applicants; verify final submission access in that account.
5. Review and submit the final text in the hackathon dashboard.
