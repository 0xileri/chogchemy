import { randomBytes } from 'node:crypto';
import { collection } from './chain.mjs';
import { digest, imageMime } from './art-direction.mjs';
import { memeTemplate, loadMemeTemplate, captionMeme, normalizeMemeCaptions, restoreLegacyMemeScene } from './meme-catalog.mjs';
import { isCurrentCommunityPrompt } from './community-prompts.mjs';

export function createMemeService({ store, chain, origin, serial, jobs, checkQuota, fail, artDirection, imageGenerator, loadReference, now, templateLoader = loadMemeTemplate }) {
  let exportsInProgress = 0;
  const text = (value, limit) => { if (value === undefined) return ''; if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) fail(400, 'Keep captions to 80 characters and the character description to 120.'); return value.trim(); };
  const templateFor = record => { const template = memeTemplate(record.templateId); return record.captionLayout ? { ...template, layout: record.captionLayout, captionSlots: record.captionLayout.boxes } : template; };
  function captions(value, template) { try { return normalizeMemeCaptions(value, template); } catch (error) { fail(400, error.message); } }
  function get(id) {
    const record = typeof id === 'string' && /^[a-f0-9]{64}$/.test(id) ? store.get(id) : null;
    if (!record || record.kind !== 'meme' || record.origin !== origin || record.collection !== collection.address || record.chainId !== collection.chainId) fail(404, 'Meme not found.');
    return record;
  }
  function view(record, address) {
    return { id: record.id, state: record.state, tokenId: record.parents[0].tokenId, createdBy: record.createdBy,
      template: templateFor(record), topCaption: record.topCaption, bottomCaption: record.bottomCaption, characterRole: record.characterRole,
      captions: record.captions || [], challengeId: record.challengeId || null,
      createdAt: record.createdAt, checkedAt: record.checkedAt, checkedBlock: record.checkedBlock, artDirection: record.artDirection, artDirectionHash: record.artDirectionHash,
      error: record.generation?.error || null, artwork: record.artwork ? { ...record.artwork, url: `/meme-artwork/${record.id}.png` } : null,
      pageUrl: `${origin}/memes/${record.id}`, studioUrl: `${origin}/?meme=${record.id}#meme-result`,
      canGenerate: address === record.createdBy && record.state === 'approved' && record.expires > now() && record.artDirectionHash === artDirection.hash && Boolean(imageGenerator?.configured),
      canCancel: address === record.createdBy && record.state === 'preparing',
      recaptionAvailable: record.state === 'generated' && Boolean(record.artwork),
      canRecaption: address === record.createdBy && record.state === 'generated' && Boolean(record.artwork),
      recaptionNotice: !record.scene && (record.topCaption || record.bottomCaption || record.artwork?.mode === 'fixture') ? 'This older scene is recovered by removing its original caption bars. The exported scene may be slightly softer; the original saved PNG stays unchanged.' : null,
    };
  }
  async function verifyOwner(record) {
    let snapshot;
    try { snapshot = await chain.owners([record.parents[0].tokenId]); } catch { fail(502, 'Could not check your Chog on Monad. Try again in a moment.'); }
    if (snapshot.owners[0]?.toLowerCase() !== record.createdBy) { record.state = 'invalidated'; store.put(record); fail(409, 'This Chog changed ownership. Choose a Chog you currently own.'); }
    if (record.expires <= now()) { record.state = 'expired'; store.put(record); fail(409, 'This meme request expired. Start a new one.'); }
    record.checkedAt = now(); record.checkedBlock = String(snapshot.blockNumber);
  }
  async function run(id) {
    let dispatched = false;
    try {
      const initial = get(id), template = templateFor(initial);
      const [chog, scene] = await Promise.all([loadReference(chain, initial.parents[0].tokenId), templateLoader(template)]);
      let input = { kind: 'meme', parents: [chog, scene], artDirection, template, characterRole: initial.characterRole };
      if (imageGenerator.prepareInput) input = await imageGenerator.prepareInput(input);
      imageGenerator.validateInput?.(input);
      const ready = await serial(async () => {
        const record = get(id); if (record.state !== 'preparing') return false;
        if (record.artDirectionHash !== artDirection.hash) fail(409, 'The art direction changed. Start a new meme.');
        await verifyOwner(record); checkQuota(record, false);
        record.state = 'generating'; record.references = [chog, scene].map(({ bytes, ...reference }) => reference);
        record.generation = { ...record.generation, providerStartedAt: now(), provider: imageGenerator.provider || null, model: imageGenerator.model };
        store.put(record); return true;
      });
      if (!ready) return;
      dispatched = true;
      const output = await imageGenerator.generate(input);
      if (!output.bytes?.length || output.bytes.length > 25 * 1024 * 1024 || imageMime(output.bytes) !== 'image/png') throw new Error('Invalid image output.');
      const bytes = await captionMeme(output.bytes, initial.topCaption, initial.bottomCaption, output.mode === 'fixture', { template, captions: initial.captions });
      await serial(() => {
        const record = get(id); record.state = 'generated';
        record.artwork = { digest: digest(bytes), createdAt: now(), mode: output.mode, model: output.model, provider: output.provider || null };
        record.scene = { digest: digest(output.bytes), createdAt: now() };
        record.captionRenderingVersion = 2;
        record.generation.providerRequestId = output.providerRequestId || null;
        store.complete(record, bytes, output.bytes);
      });
    } catch (error) {
      await serial(() => {
        const record = get(id); if (!['preparing', 'generating'].includes(record.state)) return;
        record.state = dispatched ? 'generation_failed' : 'approved';
        record.generation = { ...record.generation, error: dispatched ? 'No meme was saved. This attempt may have been charged and will not be retried automatically.' : error.publicMessage || (error.status ? error.message : 'Could not prepare the Chog or template. You can retry preparation.') };
        store.put(record);
      });
    }
  }
  async function start(record, address) {
    if (record.createdBy !== address) fail(403, 'Only this meme’s creator can generate it.');
    if (['preparing', 'generating', 'generated'].includes(record.state)) return view(record, address);
    if (record.state !== 'approved') fail(409, 'Start a new meme to continue. Dispatched attempts cannot be retried.');
    if (!imageGenerator?.configured) fail(503, 'The artwork studio is not configured yet.');
    if (record.artDirectionHash !== artDirection.hash) fail(409, 'This request uses an older art direction. Start a new meme.');
    checkQuota(record); await verifyOwner(record);
    record.state = 'preparing'; record.generation = { requestedAt: now() }; store.put(record);
    const job = Promise.resolve().then(() => run(record.id)); jobs.add(job); job.finally(() => jobs.delete(job)).catch(() => {});
    return view(record, address);
  }
  return {
    create(address, input) { return serial(async () => {
      if (!input || typeof input.tokenId !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(input.tokenId) || BigInt(input.tokenId) >= 2n ** 256n || !memeTemplate(input.templateId)) fail(400, 'Choose a valid Chog token and meme template.');
      if (typeof input.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(input.nonce)) fail(400, 'Refresh the meme studio before creating.');
      const data = { tokenId: input.tokenId, templateId: input.templateId, topCaption: text(input.topCaption, 80), bottomCaption: text(input.bottomCaption, 80), characterRole: text(input.characterRole, 120) };
      if (input.captions !== undefined) data.captions = captions(input.captions, memeTemplate(input.templateId));
      if (input.challengeId !== undefined && input.challengeId !== '') {
        if (typeof input.challengeId !== 'string' || input.challengeId.length > 80) fail(400, 'Choose the current community prompt, or leave challenge entry unchecked.');
        data.challengeId = input.challengeId;
      }
      const requestHash = digest(JSON.stringify(data));
      const existing = store.all().find(r => r.kind === 'meme' && r.origin === origin && r.createdBy === address && r.nonce === input.nonce);
      if (existing) { if (existing.requestHash !== requestHash) fail(409, 'This request key belongs to a different meme. Start a new draft.'); return view(existing, address); }
      if (data.challengeId && !isCurrentCommunityPrompt(data.challengeId, now())) fail(400, 'Choose the current community prompt, or leave challenge entry unchecked.');
      if (store.activeCount(address, now()) >= 20 || store.activeCount(null, now()) >= 1000) fail(429, 'Too many unfinished creations. Finish or cancel an earlier request.');
      const record = { id: randomBytes(32).toString('hex'), kind: 'meme', origin, createdBy: address, approvalPolicy: 'creator', state: 'approved',
        chainId: collection.chainId, collection: collection.address, parents: [{ tokenId: input.tokenId, owner: address }],
        ...data, nonce: input.nonce, requestHash, createdAt: now(), expires: now() + 86400000, artDirection: artDirection.label, artDirectionHash: artDirection.hash };
      if (data.captions) record.captionLayout = structuredClone(memeTemplate(input.templateId).layout);
      return start(record, address);
    }); },
    generate(id, address) { return serial(() => start(get(id), address)); },
    cancel(id, address) { return serial(() => { const r = get(id); if (r.createdBy !== address) fail(403, 'Only this meme’s creator can cancel.'); if (!['approved', 'preparing'].includes(r.state)) fail(409, 'A dispatched meme cannot be cancelled.'); r.state = 'cancelled'; store.put(r); return view(r, address); }); },
    get(id, address) { return view(get(id), address); },
    list(address) { return store.all().filter(r => r.kind === 'meme' && r.origin === origin && r.createdBy === address).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map(r => view(r, address)); },
    gallery() { return store.all().filter(r => r.kind === 'meme' && r.origin === origin && r.state === 'generated').sort((a, b) => b.artwork.createdAt - a.artwork.createdAt).slice(0, 24).map(r => view(r)); },
    artwork(id) { const r = get(id); if (r.state !== 'generated') fail(404, 'Meme artwork not found.'); return store.artwork(id); },
    async recaption(id, address, input) {
      const record = get(id);
      if (record.createdBy !== address) fail(403, 'Only this meme’s creator can export new captions.');
      if (record.state !== 'generated' || !record.artwork) fail(409, 'Wait until the meme is saved before editing captions.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Choose your captions before exporting.');
      const template = templateFor(record);
      const selectedCaptions = input.captions === undefined ? record.captions : captions(input.captions, template);
      const topCaption = input.topCaption === undefined ? record.topCaption : text(input.topCaption, 80);
      const bottomCaption = input.bottomCaption === undefined ? record.bottomCaption : text(input.bottomCaption, 80);
      if (exportsInProgress >= 2) fail(429, 'Two caption exports are already running. Try again in a moment.');
      exportsInProgress++;
      try {
        let scene = store.memeScene?.(record.id), source = 'saved_scene';
        if (record.scene) {
          if (!scene || digest(scene) !== record.scene.digest) fail(409, 'The caption-free scene is unavailable. Your original saved PNG is still downloadable.');
        } else {
          const original = store.artwork(record.id);
          if (!original) fail(404, 'Meme artwork not found.');
          let restored;
          try { restored = await restoreLegacyMemeScene(original, record); } catch (error) { fail(409, error.message); }
          scene = restored.bytes; source = restored.source;
        }
        const bytes = await captionMeme(scene, topCaption, bottomCaption, record.artwork.mode === 'fixture', { template, captions: selectedCaptions });
        return { bytes, source, digest: digest(bytes), filename: `chogchemy-meme-${record.parents[0].tokenId}-captions.png` };
      } finally { exportsInProgress--; }
    },
  };
}
