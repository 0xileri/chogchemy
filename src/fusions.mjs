import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { collection } from './chain.mjs';

export class FusionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new FusionError(status, message); };
const tokenIdValid = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
export function approvalMessage(record, owner) {
  return [
    'Chogchemy — approve one character fusion',
    '', `App: ${record.origin}`, `Request ID: ${record.id}`, `Chain ID: ${record.chainId}`, `Collection: ${record.collection}`,
    ...record.parents.map((parent, index) => `Parent ${index === 0 ? 'A' : 'B'}: token ${parent.tokenId} · holder ${parent.owner}`),
    `Approving holder: ${owner}`, `Art direction: ${record.artDirection}`,
    `Created: ${new Date(record.createdAt).toISOString()}`, `Expires: ${new Date(record.expires).toISOString()}`,
    '', 'I authorize Chogchemy to use the two listed Chogs as visual references for one AI-generated character and record its ancestry, after both listed holders approve.',
    'This permission is limited to this request and art direction. It can be cancelled before generation and becomes invalid if a parent changes ownership or the request expires.',
    'This signature does not transfer an NFT, approve token spending, mint anything, or authorize a blockchain transaction.',
  ].join('\n');
}

export function createFusionService({ store, chain, origin, now = Date.now }) {
  // Serialize mutations in this server process, including checks that await the RPC.
  let queue = Promise.resolve();
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
  function getRecord(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail(404, 'Fusion invitation not found.');
    const record = store.get(id);
    if (!record || record.origin !== origin || record.collection !== collection.address || record.chainId !== collection.chainId) fail(404, 'Fusion invitation not found.');
    if (record.expires <= now() && ['awaiting_approvals', 'approved'].includes(record.state)) { record.state = 'expired'; store.put(record); }
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
      generationAvailable: false,
    };
  }
  return {
    list(address) { return store.list(address).filter(r => r.origin === origin).map(r => view(getRecord(r.id), address)); },
    get(id, address) { return view(getRecord(id), address); },
    create(address, input) { return serial(async () => {
      if (!input || !tokenIdValid(input.parentA) || !tokenIdValid(input.parentB)) fail(400, 'Enter both numeric token IDs from the OpenSea URLs.');
      if (input.parentA === input.parentB) fail(400, 'Choose two different Chogs.');
      if (store.activeCount(address, now()) >= 20 || store.activeCount(null, now()) >= 1000) fail(429, 'Too many active invitations. Cancel an existing invitation before creating another.');
      const snapshot = await owners([input.parentA, input.parentB]);
      const [ownerA, ownerB] = snapshot.owners.map(value => value.toLowerCase());
      if (ownerA !== address) fail(403, 'Parent A must belong to your verified wallet.');
      if (ownerA === ownerB) fail(400, 'Choose a partner Chog held by a different wallet.');
      const createdAt = now();
      const record = {
        id: randomBytes(32).toString('hex'), state: 'awaiting_approvals', createdBy: address, origin,
        chainId: collection.chainId, collection: collection.address, artDirection: 'chogchemy-artist-v1',
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
      record.state = record.parents.every(p => p.approval) ? 'approved' : 'awaiting_approvals';
      store.put(record); return view(record, address);
    }); },
    recheck(id, address) { return serial(async () => {
      const record = getRecord(id); participant(record, address); open(record);
      await validate(record); store.put(record); return view(record, address);
    }); },
    cancel(id, address) { return serial(async () => {
      const record = getRecord(id); participant(record, address); open(record);
      record.state = 'cancelled'; record.cancelledAt = now(); record.cancelledBy = address;
      store.put(record); return view(record, address);
    }); },
  };
}
