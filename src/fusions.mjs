import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { collection } from './chain.mjs';
import { loadArtDirection, digest, imageMime } from './art-direction.mjs';
import { loadParentReference } from './reference-assets.mjs';

export class FusionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new FusionError(status, message); };
const tokenIdValid = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
// Missing policy denotes an existing invitation whose two signatures remain required.
const optionalPartner = record => record.approvalPolicy === 'creator';
const quotaHolders = record => optionalPartner(record) ? [record.createdBy] : [...new Set(record.parents.map(p => p.owner))];
export function approvalMessage(record, owner) {
  return [
    'Chogchemy — approve one character fusion',
    '', `App: ${record.origin}`, `Request ID: ${record.id}`, `Chain ID: ${record.chainId}`, `Collection: ${record.collection}`,
    ...record.parents.map((parent, index) => `Parent ${index === 0 ? 'A' : 'B'}: token ${parent.tokenId} · holder ${parent.owner}`),
    `Approving holder: ${owner}`, `Art direction: ${record.artDirection}`,
    ...(optionalPartner(record) ? ['Approval policy: Partner approval optional; only the verified creator can start generation.'] : []),
    ...(record.artDirectionHash ? [`Style SHA-256: ${record.artDirectionHash}`] : []),
    ...(record.artDirectionSnapshot ? ['Style rules:', ...record.artDirectionSnapshot.rules.map(rule => `• ${rule}`), `Artist reference images: ${record.artDirectionSnapshot.references.length}`] : []),
    `Created: ${new Date(record.createdAt).toISOString()}`, `Expires: ${new Date(record.expires).toISOString()}`,
    '', optionalPartner(record) ? 'I approve using my listed Chog as a visual reference in this one AI-generated character and its ancestry record. The verified creator can proceed without my signature; signing records my optional approval.' : 'I authorize Chogchemy to use the two listed Chogs as visual references for one AI-generated character and record its ancestry, after both listed holders approve.',
    'This permission is limited to this request and art direction. It can be cancelled before generation and becomes invalid if a parent changes ownership or the request expires.',
    'This signature does not transfer an NFT, approve token spending, mint anything, or authorize a blockchain transaction.',
  ].join('\n');
}

export function createFusionService({ store, chain, origin, now = Date.now, imageGenerator = null, artDirection = loadArtDirection(), loadReference = loadParentReference, dailyLimit = 10, holderDailyLimit = 2, concurrency = 2 }) {
  for (const value of [dailyLimit, holderDailyLimit, concurrency]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Generation limits must be positive integers.');
  const jobs = new Set();
  // A provider may have charged a request interrupted by a process restart. Never retry it automatically.
  for (const record of store.all()) {
    if (record.origin !== origin) continue;
    if (record.state === 'preparing') { record.state = 'approved'; record.generation = { error: 'Preparation was interrupted. You can try again.' }; store.put(record); }
    if (record.state === 'generating') { record.state = 'generation_failed'; record.generation.error = 'Generation was interrupted. The provider may have charged this attempt; it will not be retried.'; store.put(record); }
  }
  // Serialize mutations in this server process, including checks that await the RPC.
  let queue = Promise.resolve();
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
  function getRecord(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail(404, 'Fusion invitation not found.');
    const record = store.get(id);
    if (!record || record.origin !== origin || record.collection !== collection.address || record.chainId !== collection.chainId) fail(404, 'Fusion invitation not found.');
    if (record.expires <= now() && ['awaiting_approvals', 'approved', 'preparing'].includes(record.state)) { record.state = 'expired'; store.put(record); }
    return record;
  }
  function participant(record, address) {
    const parent = record.parents.find(p => p.owner === address);
    if (!parent) fail(403, 'Only the two invited holders can approve or cancel this fusion.');
    return parent;
  }
  function open(record) {
    if (!['awaiting_approvals', 'approved'].includes(record.state)) fail(409, `This fusion is ${record.state}. Create a new invitation to continue.`);
  }
  async function owners(ids) {
    try { return await chain.owners(ids); }
    catch { fail(502, 'Could not check both Chogs on Monad. Check the token IDs and retry in a moment.'); }
  }
  async function validate(record) {
    const snapshot = await owners(record.parents.map(p => p.tokenId));
    if (record.parents.some((parent, i) => parent.owner !== snapshot.owners[i].toLowerCase())) {
      record.state = 'invalidated'; record.invalidatedAt = now(); store.put(record);
      fail(409, 'A parent Chog changed ownership. This invitation is invalid; create a new one.');
    }
    // An RPC response can arrive after the invitation deadline.
    if (record.expires <= now()) { record.state = 'expired'; store.put(record); fail(409, 'This fusion expired. Create a new invitation.'); }
    record.checkedAt = now(); record.checkedBlock = String(snapshot.blockNumber);
  }
  function view(record, address = null) {
    return {
      id: record.id, state: record.state, parents: record.parents.map(p => ({ tokenId: p.tokenId, owner: p.owner, approvedAt: p.approval?.at || null })),
      createdAt: record.createdAt, expires: record.expires, checkedAt: record.checkedAt, checkedBlock: record.checkedBlock,
      artDirection: record.artDirection, collection: { address: record.collection, chainId: record.chainId },
      invitationUrl: `${record.origin}/?fusion=${record.id}#fusion`,
      yourRole: address ? record.parents.findIndex(p => p.owner === address) : -1,
      generationAvailable: Boolean(imageGenerator?.configured && record.artDirectionHash === artDirection.hash && record.state === 'approved'),
      generation: record.generation ? { error: record.generation.error || null, startedAt: record.generation.providerStartedAt || null } : null,
      artwork: record.artwork ? { ...record.artwork, url: `/artwork/${record.id}.png` } : null,
      artDirectionHash: record.artDirectionHash || null,
      approvalPolicy: optionalPartner(record) ? 'creator' : 'both_holders',
      createdBy: record.createdBy, creatorVerifiedAt: record.creatorVerifiedAt || null,
      canGenerate: Boolean(address && (optionalPartner(record) ? address === record.createdBy : record.parents.some(p => p.owner === address))),
    };
  }
  function checkQuota(record, checkConcurrency = true) {
    const records = store.all().filter(r => r.origin === origin);
    if (checkConcurrency && records.filter(r => r.id !== record.id && ['preparing', 'generating'].includes(r.state)).length >= concurrency) fail(429, 'The studio is busy. Try again after another fusion finishes.');
    const day = Math.floor(now() / 86400000) * 86400000;
    const attempts = records.filter(r => r.generation?.providerStartedAt >= day);
    if (attempts.length >= dailyLimit || quotaHolders(record).some(holder => attempts.filter(r => quotaHolders(r).includes(holder)).length >= holderDailyLimit)) fail(429, 'The daily artwork limit has been reached. Try again after 00:00 UTC.');
  }
  async function runGeneration(id) {
    let dispatched = false;
    try {
      const initial = getRecord(id);
      const parents = await Promise.all(initial.parents.map(p => loadReference(chain, p.tokenId)));
      imageGenerator.validateInput?.({ parents, artDirection });
      const dispatch = await serial(async () => {
        const record = getRecord(id);
        if (record.state !== 'preparing') return false;
        if (record.artDirectionHash !== artDirection.hash) fail(409, 'The art direction changed. Create a new invitation.');
        if (optionalPartner(record) && (record.createdBy !== record.parents[0].owner || !record.creatorVerifiedAt)) fail(403, 'Verified creator authorization is required.');
        for (const parent of record.parents) {
          if (!parent.approval && optionalPartner(record)) continue;
          if (!parent.approval || !await verifyMessage({ address: parent.owner, message: approvalMessage(record, parent.owner), signature: parent.approval.signature })) fail(403, 'Valid holder approvals are required.');
        }
        await validate(record);
        checkQuota(record, false);
        record.state = 'generating';
        record.generation = { providerStartedAt: now(), mode: imageGenerator.mode, model: imageGenerator.model, provider: imageGenerator.provider || null };
        record.references = parents.map(({ bytes, ...reference }) => reference);
        store.put(record); return true;
      });
      if (!dispatch) return;
      dispatched = true;
      const result = await imageGenerator.generate({ parents, artDirection });
      if (!result.bytes?.length || result.bytes.length > 25 * 1024 * 1024 || imageMime(result.bytes) !== 'image/png') throw new Error('Invalid image output');
      await serial(() => {
        const record = getRecord(id);
        record.state = 'generated';
        record.artwork = { digest: digest(result.bytes), createdAt: now(), model: result.model, mode: result.mode, provider: result.provider || null };
        record.generation.providerRequestId = result.providerRequestId || null;
        store.complete(record, result.bytes);
      });
    } catch (error) {
      await serial(() => {
        const record = getRecord(id);
        if (!['preparing', 'generating'].includes(record.state)) return;
        record.state = dispatched ? 'generation_failed' : 'approved';
        record.generation = { ...record.generation, error: dispatched ? 'The image provider did not return a saved result. This attempt will not be retried because it may have been charged.' : error.publicMessage || (error instanceof FusionError ? error.message : 'Could not prepare the parent artwork. Retry before generation starts.') };
        store.put(record);
      });
    }
  }
  return {
    idle() { return Promise.all([...jobs]); },
    gallery() { return store.all().filter(r => r.origin === origin && r.state === 'generated').sort((a, b) => b.artwork.createdAt - a.artwork.createdAt).slice(0, 24).map(r => view(r)); },
    artwork(id) { const record = getRecord(id); if (record.state !== 'generated') fail(404, 'Artwork not found.'); return store.artwork(id); },
    generate(id, address) { return serial(async () => {
      const record = getRecord(id); participant(record, address);
      if (optionalPartner(record) && address !== record.createdBy) fail(403, 'Only the verified creator can start this fusion. Your approval is optional.');
      if (['generated', 'generating', 'preparing'].includes(record.state)) return view(record, address);
      if (!imageGenerator?.configured) fail(503, 'The artwork studio is not available yet. Your approvals are saved.');
      if (record.state !== 'approved') fail(409, optionalPartner(record) ? 'This fusion is not ready for generation.' : 'Both holders must approve this invitation before generation.');
      if (record.artDirectionHash !== artDirection.hash) fail(409, 'This invitation uses an older art direction. Create a new invitation before generating.');
      checkQuota(record);
      await validate(record);
      record.state = 'preparing'; record.generation = { requestedAt: now() }; store.put(record);
      // Run outside the mutation queue so holders can cancel while references load.
      const job = Promise.resolve().then(() => runGeneration(id)); jobs.add(job);
      job.finally(() => jobs.delete(job)).catch(() => {});
      return view(record, address);
    }); },
    list(address) { return store.list(address).filter(r => r.origin === origin).map(r => view(getRecord(r.id), address)); },
    get(id, address) { return view(getRecord(id), address); },
    create(address, input) { return serial(async () => {
      if (!input || !tokenIdValid(input.parentA) || !tokenIdValid(input.parentB)) fail(400, 'Enter both numeric token IDs from the OpenSea URLs.');
      if (input.parentA === input.parentB) fail(400, 'Choose two different Chogs.');
      if (input.requirePartnerApproval !== undefined && typeof input.requirePartnerApproval !== 'boolean') fail(400, 'Choose whether partner approval is required.');
      const requirePartnerApproval = input.requirePartnerApproval !== false;
      if (store.activeCount(address, now()) >= 20 || store.activeCount(null, now()) >= 1000) fail(429, 'Too many active invitations. Cancel an existing invitation before creating another.');
      const snapshot = await owners([input.parentA, input.parentB]);
      const [ownerA, ownerB] = snapshot.owners.map(value => value.toLowerCase());
      if (ownerA !== address) fail(403, 'Parent A must belong to your verified wallet.');
      if (requirePartnerApproval && ownerA === ownerB) fail(400, 'Choose a partner Chog held by a different wallet, or make partner approval optional.');
      const createdAt = now();
      const record = {
        id: randomBytes(32).toString('hex'), state: requirePartnerApproval ? 'awaiting_approvals' : 'approved', createdBy: address, origin,
        approvalPolicy: requirePartnerApproval ? 'both_holders' : 'creator', creatorVerifiedAt: requirePartnerApproval ? null : createdAt,
        chainId: collection.chainId, collection: collection.address, artDirection: artDirection.label,
        artDirectionHash: artDirection.hash, artDirectionSnapshot: { ...artDirection, images: undefined },
        parents: [{ tokenId: input.parentA, owner: ownerA, approval: null }, { tokenId: input.parentB, owner: ownerB, approval: null }],
        createdAt, expires: createdAt + 24 * 60 * 60 * 1000, checkedAt: createdAt, checkedBlock: String(snapshot.blockNumber),
      };
      store.put(record); return view(record, address);
    }); },
    message(id, address) { return serial(async () => {
      const record = getRecord(id), parent = participant(record, address); open(record);
      if (parent.approval) fail(409, 'You have already approved this invitation.');
      await validate(record); store.put(record);
      return { message: approvalMessage(record, address), request: view(record, address) };
    }); },
    approve(id, address, signature) { return serial(async () => {
      const record = getRecord(id), parent = participant(record, address); open(record);
      if (parent.approval) fail(409, 'You have already approved this invitation.');
      let valid = false;
      try { valid = await verifyMessage({ address, message: approvalMessage(record, address), signature }); } catch { /* Reject invalid signatures. */ }
      if (!valid) fail(403, 'The approval signature does not match this holder and invitation.');
      await validate(record);
      parent.approval = { signature, at: now() };
      record.state = optionalPartner(record) || record.parents.every(p => p.approval) ? 'approved' : 'awaiting_approvals';
      store.put(record); return view(record, address);
    }); },
    recheck(id, address) { return serial(async () => {
      const record = getRecord(id); participant(record, address); open(record);
      await validate(record); store.put(record); return view(record, address);
    }); },
    cancel(id, address) { return serial(async () => {
      const record = getRecord(id); participant(record, address);
      if (record.state !== 'preparing') open(record);
      record.state = 'cancelled'; record.cancelledAt = now(); record.cancelledBy = address;
      store.put(record); return view(record, address);
    }); },
  };
}
