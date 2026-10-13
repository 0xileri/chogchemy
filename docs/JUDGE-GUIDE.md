# Test Chogchemy

## Meme studio — the main experience

1. Open https://chogchemy.up.railway.app. Browse the 100 templates, search by name and filter by category; this makes no image-generation request.
2. Connect a Chog holder wallet and choose the NFT to star in the scene. Pick a template and optionally describe the character to replace.
3. Add optional top/bottom captions. These appear in separate caption bars, not the original template's text boxes. Click **Create my Chog meme** once. One dispatched request uses one of the shared drawing allowance.
4. Check progress or reopen the request from **My memes**. Cancelling is possible only during preparation; a dispatched provider failure is not automatically repeated.
5. Open the finished public meme page, download the PNG, and try **Enlarge artwork**, **Zoom in**, **Zoom out**, Escape, and keyboard focus return. The original NFT stays in its wallet.
6. Ask the artist to check that the actual NFT traits remain recognizable and the template's joke/pose still works. Real meme output quality has not been established by synthetic tests.

Template source and all 100 links are recorded in MEME-CATALOG.md. They are popular on Imgflip, not a universal top-100 ranking.

## Family review — no wallet needed

1. Open https://chogchemy.up.railway.app/families. The family studio explains the three steps: connect, create child, create comic.
2. Scroll to Explore creations and open the item marked **Comic saved**, from Chogs #1786 and #1870.
3. Inspect **Your saved Chog child**, the original parent links, and the holder/approval labels.
4. Scroll to **Your family comic**. Review the wedding, new arrival and picnic. The saved child should remain recognizable in the comic.
5. Try **Download comic**, **Copy family link**, and reopening the copied URL in another tab. Refresh the page; the saved result should remain visible.
6. Open https://chogchemy.up.railway.app/demo to try a sample fusion without a wallet. This is procedural placeholder artwork, not a live AI generation.

Direct family page:
https://chogchemy.up.railway.app/characters/5bf843d9408576096235b23092a73230331f0ca0ea0e2e624f0f8911c8422279#family-comic

## Holder creation flow

Open https://chogchemy.up.railway.app/families in a browser with MetaMask or Rabby and a wallet that owns a Chog Genesis NFT on Monad mainnet. Do not share wallet keys.

1. Click **Connect wallet** and sign the login message. Your Chogs are discovered automatically. If discovery fails, use the manual token ID fallback.
2. Select your first parent and enter a distinct second Chog token ID. Its artwork preview should appear. Token ID means the number at the end of its OpenSea item URL.
3. Leave partner approval optional for the simplest flow. Click **Check the parents**, review the two parents, then **Create the child**. To test a signed collaboration instead, choose the optional approval checkbox before creating the request and have both holders approve it.
4. Wait for the child to be saved. Generation may take a few minutes. Child and comic are separate drawing requests.
5. Click **Go to the comic**, then **Create the family comic** as the original creator. Both parent owners must still match the family record.
6. When the comic is saved, download it and open its public family page.
7. Refresh, reconnect if needed, and select the family under **My creations**. Saved artwork and comic should still be accessible.

The configured live allowance is four dispatched requests per accountable holder and ten globally per UTC day. Availability depends on current usage. Failed dispatched provider requests count too; requests are not automatically repeated. The site displays the applicable reset time locally. Do not repeatedly click generation to try to bypass an error.

## Artist review

Ask @theejhay01 to review:

- Are traits from both selected parents visible in the child?
- Does the child retain its face, colors and accessories across comic scenes?
- Are the parents distinguishable and the three scenes easy to read?
- Does the output follow the agreed outlines, color palette and texture?

Record the review honestly. If a result is weak, preserve it as a test example and refine the next request; do not present manual edits as an untouched AI result.

## What this build does not claim

It does not mint, burn or transfer NFTs. The saved roots and signatures are database records. It has no token spending integration, no public user retention study yet, and no unlimited-episode generator. Smart-contract wallet sign-in is not supported yet.

## Continue a saved family

After saving the first comic, the original creator can open the creation and scroll to **Create their next episode**. Choose adventure, school, or birthday, review the three chapter titles and allowance, then click **Create the next episode**. Each story is available once per family. The episode is saved below, downloadable, and linked on the public family page. Cancel is available during preparation; dispatched attempts are not automatically repeated. Earlier artworks stay saved and each new episode uses one request from the shared daily allowance.

## Make a family sticker pack

After saving a child, use **Make chat stickers** to reach its sticker section. Connect the original creator wallet if needed and click **Create my sticker pack**. One request prepares all six reactions. When saved, each transparent 512px PNG is individually downloadable; **Download all six** supplies a ZIP with a readme. The public family page has the same downloads. Add the PNGs using your chat app's supported sticker tool; the ZIP does not automatically install them. New requests are creator-only, ownership checked, and subject to the same daily allowance as children and comics. Generation and layout quality still need review with real outputs; synthetic fixtures test the interface and extraction only.
