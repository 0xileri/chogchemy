import { randomBytes } from 'node:crypto';
import { digest, imageMime } from './art-direction.mjs';

export const episodeStories = Object.freeze([
  { id: 'adventure', title: 'Their first adventure', chapters: ['Pack for adventure', 'Follow the little explorer', 'A discovery together'], scenes: [
    'Both parents and their saved child pack a map and a small bag for a family adventure.',
    'The same child leads both parents along a friendly woodland trail, pointing excitedly at a surprise ahead.',
    'Both parents and that same child discover a beautiful glowing flower and celebrate together beside a cozy campfire.',
  ] },
  { id: 'school', title: 'The first school day', chapters: ['Getting ready', 'A brave first step', 'The story at pickup'], scenes: [
    'Both parents help their saved child pack a tiny school bag at home, with an encouraging family hug.',
    'The same child bravely walks through a cheerful school entrance as both parents wave and cheer nearby.',
    'After school, that same child proudly shows a colorful drawing to both parents and they celebrate together.',
  ] },
  { id: 'birthday', title: 'A birthday surprise', chapters: ['The secret surprise', 'Make a wish', 'A present and a hug'], scenes: [
    'Both parents quietly decorate a room and prepare a birthday cake while their saved child peeks around the door.',
    'That same child blows out candles on the birthday cake as both parents clap happily beside it.',
    'The same child opens a toy gift, then hugs both parents in a joyful family celebration.',
  ] },
]);

const inProgress = episode => ['preparing', 'generating'].includes(episode?.state);
export function createFamilyEpisodeService({ store, chain, getRecord, serial, view, checkQuota, fail, artDirection, imageGenerator, loadReference, now, jobs }) {
  function creator(record, address) {
    if (record.state !== 'generated' || !record.artwork || record.comic?.state !== 'generated') fail(409, 'Save the child and its first family comic before creating another episode.');
    if (address !== record.createdBy || address !== record.parents[0].owner) fail(403, 'Only the original family creator can request a new episode.');
  }
  function episode(record, id) {
    const found = (record.episodes || []).find(e => e.id === id);
    if (!found) fail(404, 'Family episode not found.');
    return found;
  }
  async function checkOwners(record) {
    let snapshot;
    try { snapshot = await chain.owners(record.parents.map(p => p.tokenId)); }
    catch { fail(502, 'Could not check the family Chogs on Monad. Try again in a moment.'); }
    if (record.parents.some((p, i) => p.owner !== snapshot.owners[i].toLowerCase())) fail(409, 'A parent Chog changed ownership. This family can no longer create new episodes.');
    return { checkedAt: now(), checkedBlock: String(snapshot.blockNumber) };
  }
  async function run(id, episodeId, preparationId) {
    let dispatched = false;
    try {
      const initial = getRecord(id), original = episode(initial, episodeId);
      const story = episodeStories.find(s => s.id === original.storyId);
      const parents = await Promise.all(initial.parents.map(p => loadReference(chain, p.tokenId)));
      const child = store.artwork(id);
      if (!child?.length || digest(child) !== initial.artwork.digest || imageMime(child) !== 'image/png') fail(409, 'The saved child artwork could not be verified.');
      let input = { kind: 'comic', story, parents: [...parents, { bytes: child, mime: 'image/png', name: 'Saved fusion child', tokenId: 'child', traits: [] }], artDirection };
      if (imageGenerator.prepareInput) input = await imageGenerator.prepareInput(input);
      imageGenerator.validateInput?.(input);
      const dispatch = await serial(async () => {
        const record = getRecord(id), item = episode(record, episodeId);
        if (item.state !== 'preparing' || item.preparationId !== preparationId) return false;
        creator(record, item.requestedBy);
        const ownership = await checkOwners(record);
        checkQuota(record, false, 'comic');
        Object.assign(item, ownership, { state: 'generating', providerStartedAt: now(), model: imageGenerator.model, provider: imageGenerator.provider || null });
        store.put(record); return true;
      });
      if (!dispatch) return;
      dispatched = true;
      const result = await imageGenerator.generate(input);
      if (!result.bytes?.length || result.bytes.length > 25 * 1024 * 1024 || imageMime(result.bytes) !== 'image/png') throw new Error('Invalid episode output');
      await serial(() => {
        const record = getRecord(id), item = episode(record, episodeId);
        item.state = 'generated';
        item.artwork = { digest: digest(result.bytes), createdAt: now(), model: result.model, mode: result.mode, provider: result.provider || null };
        item.providerRequestId = result.providerRequestId || null;
        store.completeEpisode(record, episodeId, result.bytes);
      });
    } catch (error) {
      await serial(() => {
        const record = getRecord(id), item = episode(record, episodeId);
        if (!inProgress(item) || item.preparationId !== preparationId) return;
        item.state = dispatched ? 'failed' : 'ready';
        item.error = dispatched ? 'No episode was saved. This attempt will not be repeated because it may have been charged. Your earlier artwork is safe.' : error.publicMessage || (Number.isInteger(error.status) ? error.message : 'Could not prepare the family artwork. You can try again before drawing starts.');
        store.put(record);
      });
    }
  }
  return {
    generate(id, address, input) { return serial(async () => {
      const story = episodeStories.find(s => s.id === input?.story);
      if (!story) fail(400, 'Choose adventure, school, or birthday for this episode.');
      const record = getRecord(id); creator(record, address);
      const existing = (record.episodes || []).find(e => e.storyId === story.id);
      if (existing && (inProgress(existing) || existing.state === 'generated')) return view(record, address);
      if (existing?.state === 'failed') fail(409, 'This story attempt may have been charged and cannot be repeated. Choose a different story.');
      if ((record.episodes || []).some(inProgress)) fail(409, 'Wait for the current family episode to finish before starting another.');
      if (!imageGenerator?.configured) fail(503, 'The episode studio is not available yet. Your saved family is still here.');
      checkQuota(record, true, 'comic');
      const ownership = await checkOwners(record);
      record.episodes ||= [];
      const item = existing || { id: randomBytes(32).toString('hex'), number: record.episodes.length + 2, storyId: story.id, title: story.title, chapters: [...story.chapters], recipeVersion: '1' };
      Object.assign(item, { state: 'preparing', preparationId: randomBytes(16).toString('hex'), requestedBy: address, requestedAt: now(), ...ownership, styleLabel: artDirection.label, styleHash: artDirection.hash, childDigest: record.artwork.digest, error: null });
      if (!existing) record.episodes.push(item);
      store.put(record);
      const job = Promise.resolve().then(() => run(id, item.id, item.preparationId)); jobs.add(job);
      job.finally(() => jobs.delete(job)).catch(() => {});
      return view(record, address);
    }); },
    cancel(id, address, input) { return serial(() => {
      const record = getRecord(id); creator(record, address);
      const item = episode(record, input?.episodeId);
      if (item.state !== 'preparing') fail(409, 'Only an episode still preparing can be cancelled.');
      item.state = 'cancelled'; item.error = null; store.put(record); return view(record, address);
    }); },
    artwork(id, episodeId) {
      const record = getRecord(id), item = episode(record, episodeId);
      if (record.state !== 'generated' || item.state !== 'generated' || !item.artwork) fail(404, 'Family episode artwork not found.');
      return store.episodeArtwork(id, episodeId);
    },
  };
}
