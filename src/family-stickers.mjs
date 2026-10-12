import { randomBytes } from 'node:crypto';
import { digest, imageMime } from './art-direction.mjs';
import { stickerReactions, createStickerAssets } from './sticker-assets.mjs';

export function createFamilyStickerService({ store, chain, getRecord, serial, view, checkQuota, fail, artDirection, imageGenerator, loadReference, now, jobs }) {
  function creator(record, address) {
    if (record.state !== 'generated' || !record.artwork) fail(409, 'Save the child artwork before creating a family sticker pack.');
    if (address !== record.createdBy || address !== record.parents[0].owner) fail(403, 'Only the original family creator can request its sticker pack.');
  }
  async function checkOwners(record) {
    let snapshot;
    try { snapshot = await chain.owners(record.parents.map(p => p.tokenId)); }
    catch { fail(502, 'Could not check the family Chogs on Monad. Try again in a moment.'); }
    if (record.parents.some((p, i) => p.owner !== snapshot.owners[i].toLowerCase())) fail(409, 'A parent Chog changed ownership. This family can no longer create a sticker pack.');
    return { checkedAt: now(), checkedBlock: String(snapshot.blockNumber) };
  }
  async function run(id, preparationId) {
    let dispatched = false;
    try {
      const initial = getRecord(id), parents = await Promise.all(initial.parents.map(p => loadReference(chain, p.tokenId))), child = store.artwork(id);
      if (!child?.length || digest(child) !== initial.artwork.digest || imageMime(child) !== 'image/png') fail(409, 'The saved child artwork could not be verified.');
      let input = { kind: 'stickers', parents: [...parents, { bytes: child, mime: 'image/png', tokenId: 'child', name: 'Saved fusion child', traits: [] }], artDirection };
      if (imageGenerator.prepareInput) input = await imageGenerator.prepareInput(input);
      imageGenerator.validateInput?.(input);
      const dispatch = await serial(async () => {
        const record = getRecord(id), pack = record.stickers;
        if (pack?.state !== 'preparing' || pack.preparationId !== preparationId) return false;
        creator(record, pack.requestedBy);
        const ownership = await checkOwners(record); checkQuota(record, false, 'comic');
        Object.assign(pack, ownership, { state: 'generating', providerStartedAt: now(), model: imageGenerator.model, provider: imageGenerator.provider || null });
        store.put(record); return true;
      });
      if (!dispatch) return;
      dispatched = true;
      const result = await imageGenerator.generate(input);
      if (!result.bytes?.length || result.bytes.length > 25 * 1024 * 1024 || imageMime(result.bytes) !== 'image/png') throw new Error('Invalid sticker sheet output');
      const assets = await createStickerAssets(result.bytes, { fixture: result.mode === 'fixture' });
      await serial(() => {
        const record = getRecord(id), pack = record.stickers;
        Object.assign(pack, { state: 'generated', artwork: { sheetDigest: digest(result.bytes), createdAt: now(), model: result.model, mode: result.mode, provider: result.provider || null, zipDigest: digest(assets.zip), items: stickerReactions.map(r => ({ id: r.id, name: r.name, digest: digest(assets[r.id]), width: 512, height: 512 })) }, providerRequestId: result.providerRequestId || null });
        store.completeStickerPack(record, assets);
      });
    } catch (error) {
      await serial(() => {
        const record = getRecord(id), pack = record.stickers;
        if (!['preparing', 'generating'].includes(pack?.state) || pack.preparationId !== preparationId) return;
        pack.state = dispatched ? 'failed' : 'ready';
        pack.error = dispatched ? 'No sticker pack was saved. This attempt will not be repeated because it may have been charged. Your earlier artwork is safe.' : error.publicMessage || (Number.isInteger(error.status) ? error.message : 'Could not prepare the family artwork. You can try again before drawing starts.');
        store.put(record);
      });
    }
  }
  return {
    generate(id, address) { return serial(async () => {
      const record = getRecord(id); creator(record, address);
      if (['preparing', 'generating', 'generated'].includes(record.stickers?.state)) return view(record, address);
      if (record.stickers?.state === 'failed') fail(409, 'This sticker attempt may have been charged and cannot be repeated. Your family artwork is still saved.');
      if (!imageGenerator?.configured) fail(503, 'The sticker studio is not available yet. Your saved family is still here.');
      checkQuota(record, true, 'comic'); const ownership = await checkOwners(record);
      record.stickers = { state: 'preparing', preparationId: randomBytes(16).toString('hex'), recipeVersion: '1', requestedBy: address, requestedAt: now(), ...ownership, styleLabel: artDirection.label, styleHash: artDirection.hash, childDigest: record.artwork.digest, error: null };
      store.put(record);
      const job = Promise.resolve().then(() => run(id, record.stickers.preparationId)); jobs.add(job);
      job.finally(() => jobs.delete(job)).catch(() => {});
      return view(record, address);
    }); },
    cancel(id, address) { return serial(() => {
      const record = getRecord(id); creator(record, address);
      if (record.stickers?.state !== 'preparing') fail(409, 'Only a sticker pack still preparing can be cancelled.');
      record.stickers.state = 'cancelled'; record.stickers.error = null; store.put(record); return view(record, address);
    }); },
    asset(id, name) {
      const record = getRecord(id);
      if (record.state !== 'generated' || record.stickers?.state !== 'generated' || !['zip', ...stickerReactions.map(r => r.id)].includes(name)) fail(404, 'Sticker download not found.');
      return store.stickerAsset(id, name);
    },
  };
}
