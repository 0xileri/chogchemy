# Test Chogchemy

## Public review — no wallet needed

1. Open https://chogchemy.up.railway.app. The site explains the three steps: connect, create child, create comic.
2. Scroll to Explore creations and open the item marked **Comic saved**, from Chogs #1786 and #1870.
3. Inspect **Your saved Chog child**, the original parent links, and the holder/approval labels.
4. Scroll to **Your family comic**. Review the wedding, new arrival and picnic. The saved child should remain recognizable in the comic.
5. Try **Download comic**, **Copy family link**, and reopening the copied URL in another tab. Refresh the page; the saved result should remain visible.
6. Open https://chogchemy.up.railway.app/demo to try a sample fusion without a wallet. This is procedural placeholder artwork, not a live AI generation.

Direct family page:
https://chogchemy.up.railway.app/characters/5bf843d9408576096235b23092a73230331f0ca0ea0e2e624f0f8911c8422279#family-comic

## Holder creation flow

Use a browser with MetaMask or Rabby and a wallet that owns a Chog Genesis NFT on Monad mainnet. Do not share wallet keys.

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

It does not mint, burn or transfer NFTs. The saved roots and signatures are database records. It has no token spending integration, no public user retention study yet, and no multiple-episode generator. Smart-contract wallet sign-in is not supported yet.
