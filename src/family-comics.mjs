import { digest, imageMime } from './art-direction.mjs';

// Comics use a fresh creator request, not the signatures for the original fusion.
export function createFamilyComicService({ store, chain, getRecord, serial, view, checkQuota, fail, artDirection, imageGenerator, loadReference, now, jobs }) {
  function creator(record, address) {
    if (record.state !== 'generated' || !record.artwork) fail(409, 'Create and save the child artwork before making a family comic.');
    if (address !== record.createdBy || address !== record.parents[0].owner) fail(403, 'Only the original creator can request this family comic.');
  }
  async function checkOwners(record) {
    let snapshot;
    try { snapshot = await chain.owners(record.parents.map(p => p.tokenId)); }
    catch { fail(502, 'Could not check the family Chogs on Monad. Try again in a moment.'); }
    if (record.parents.some((p, i) => p.owner !== snapshot.owners[i].toLowerCase())) fail(409, 'A parent Chog changed ownership. This family can no longer create a comic.');
    return { checkedAt: now(), checkedBlock: String(snapshot.blockNumber) };
  }
  async function run(id) {
    let dispatched = false;
    try {
      const initial = getRecord(id);
      const parents = await Promise.all(initial.parents.map(p => loadReference(chain, p.tokenId)));
      const child = store.artwork(id);
      if (!child?.length || digest(child) !== initial.artwork.digest || imageMime(child) !== 'image/png') fail(409, 'The saved child artwork could not be verified.');
      const input = { kind: 'comic', parents: [...parents, { bytes: child, mime: 'image/png', name: 'Saved fusion child', tokenId: 'child', traits: [] }], artDirection };
      imageGenerator.validateInput?.(input);
      const dispatch = await serial(async () => {
        const record = getRecord(id);
        if (record.comic?.state !== 'preparing') return false;
        creator(record, record.comic.requestedBy);
        const ownership = await checkOwners(record);
        checkQuota(record, false, 'comic');
        record.comic = { ...record.comic, ...ownership, state: 'generating', providerStartedAt: now(), model: imageGenerator.model, provider: imageGenerator.provider || null };
        store.put(record); return true;
      });
      if (!dispatch) return;
      dispatched = true;
      const result = await imageGenerator.generate(input);
      if (!result.bytes?.length || result.bytes.length > 25 * 1024 * 1024 || imageMime(result.bytes) !== 'image/png') throw new Error('Invalid comic output');
      await serial(() => {
        const record = getRecord(id);
        record.comic.state = 'generated';
        record.comic.artwork = { digest: digest(result.bytes), createdAt: now(), model: result.model, mode: result.mode, provider: result.provider || null };
        record.comic.providerRequestId = result.providerRequestId || null;
        store.completeComic(record, result.bytes);
      });
    } catch (error) {
      await serial(() => {
        const record = getRecord(id);
        if (!['preparing', 'generating'].includes(record.comic?.state)) return;
        record.comic.state = dispatched ? 'failed' : 'ready';
        record.comic.error = dispatched ? 'The comic provider did not return a saved result. This attempt will not be retried because it may have been charged.' : error.publicMessage || (Number.isInteger(error.status) ? error.message : 'Could not prepare the family artwork. You can try again before drawing starts.');
        store.put(record);
      });
    }
  }
  return {
    generate(id, address) { return serial(async () => {
      const record = getRecord(id); creator(record, address);
      if (['preparing', 'generating', 'generated'].includes(record.comic?.state)) return view(record, address);
      if (record.comic?.state === 'failed') fail(409, 'This comic attempt may have been charged and cannot be repeated. Your child artwork is still saved.');
      if (!imageGenerator?.configured) fail(503, 'The comic studio is not available yet. Your child artwork is saved.');
      checkQuota(record, true, 'comic');
      const ownership = await checkOwners(record);
      record.comic = { state: 'preparing', recipeVersion: '1', title: 'Our Chog Family', requestedBy: address, requestedAt: now(), ...ownership, styleLabel: artDirection.label, styleHash: artDirection.hash, childDigest: record.artwork.digest, error: null };
      store.put(record);
      const job = Promise.resolve().then(() => run(id)); jobs.add(job);
      job.finally(() => jobs.delete(job)).catch(() => {});
      return view(record, address);
    }); },
    cancel(id, address) { return serial(() => {
      const record = getRecord(id); creator(record, address);
      if (record.comic?.state !== 'preparing') fail(409, 'Only a comic still preparing can be cancelled.');
      record.comic.state = 'cancelled'; record.comic.error = null; store.put(record);
      return view(record, address);
    }); },
    artwork(id) {
      const record = getRecord(id);
      if (record.state !== 'generated' || record.comic?.state !== 'generated') fail(404, 'Family comic not found.');
      return store.comicArtwork(id);
    },
  };
}
