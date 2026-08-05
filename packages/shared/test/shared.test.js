import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, verifyMessage, verifyTypedData } from 'ethers';
import {
  ballotTypedData,
  buildCommunicationSigningMessage,
  buildTokenCommunicationSigningMessage,
  buildSnapshotTree,
  hashEventMetadata,
  packProposalConfig,
  tokenUnitsPerVote,
  unpackProposalConfig,
  verifySnapshotProof,
} from '../src/index.js';

test('packs and unpacks proposal option counts', () => {
  const packed = packProposalConfig([3, 2, 4]);
  assert.deepEqual(unpackProposalConfig(packed), {
    proposalCount: 3,
    optionCounts: [3, 2, 4],
  });
});

test('builds deterministic snapshot proofs', () => {
  const tree = buildSnapshotTree([
    { walletAddress: '0x0000000000000000000000000000000000000002', rawBalance: '20', votingPower: '2' },
    { walletAddress: '0x0000000000000000000000000000000000000001', rawBalance: '10', votingPower: '1' },
    { walletAddress: '0x0000000000000000000000000000000000000003', rawBalance: '30', votingPower: '3' },
  ]);
  for (const entry of tree.entries) {
    assert.equal(verifySnapshotProof({
      walletAddress: entry.walletAddress,
      rawBalance: entry.rawBalance,
      proof: entry.merkleProof,
      root: tree.root,
    }), true);
  }
});

test('hashes canonical event metadata consistently', () => {
  const first = hashEventMetadata({
    title: 'Meeting',
    description: '',
    proposals: [{ title: 'Proposal', description: '', options: ['For', 'Against'], recommendation: 0 }],
  });
  const second = hashEventMetadata(first.metadata);
  assert.equal(first.hash, second.hash);
});

test('turns a natural token ratio into raw units per vote', () => {
  assert.equal(tokenUnitsPerVote(18, 5), 5_000_000_000_000_000_000n);
});

test('produces recoverable ballot typed data', async () => {
  const wallet = Wallet.createRandom();
  const ballot = ballotTypedData({
    chainId: 80002,
    contractAddress: '0x0000000000000000000000000000000000000010',
    voter: wallet.address,
    choices: [0, 1, 2, 3],
    ballotVersion: 3,
  });
  assert.equal(
    ballot.message.selectedOptions,
    'Proposal 1 = Option 1; Proposal 2 = Option 2; Proposal 3 = Option 3; Proposal 4 = Option 4',
  );
  const ballotSignature = await wallet.signTypedData(ballot.domain, ballot.types, ballot.message);
  assert.equal(
    verifyTypedData(ballot.domain, ballot.types, ballot.message, ballotSignature),
    wallet.address,
  );
});


test('keeps the legacy v2 choices hash for already-deployed events', () => {
  const ballot = ballotTypedData({
    chainId: 80002,
    contractAddress: '0x0000000000000000000000000000000000000010',
    voter: '0x0000000000000000000000000000000000000020',
    choices: [3, 0],
    ballotVersion: 2,
  });
  assert.equal(ballot.domain.version, '2');
  assert.equal(ballot.message.selectedOptions, undefined);
  assert.match(ballot.message.choicesHash, /^0x[0-9a-f]{64}$/u);
});


test('creator-signed communications bind every displayed field', async () => {
  const wallet = Wallet.createRandom();
  const communication = {
    chainId: 80002,
    eventId: '123e4567-e89b-42d3-a456-426614174000',
    eventTitle: 'Annual meeting',
    tokenSymbol: 'TEST',
    contractAddress: '0x0000000000000000000000000000000000000010',
    creatorAddress: wallet.address,
    authenticityStatus: 'SELF_CLAIMED',
    messageId: '123e4567-e89b-42d3-a456-426614174001',
    title: 'Voting is open',
    body: 'Cast your final ballot in the PV dApp.',
    category: 'VOTING_OPEN',
    audience: 'ALL_ELIGIBLE',
    publishedAt: '2026-07-29T10:00:00.000Z',
    expiresAt: '2026-08-01T10:00:00.000Z',
    actionUrl: 'https://example.test/events/123e4567-e89b-42d3-a456-426614174000',
  };
  const signingMessage = buildCommunicationSigningMessage(communication);
  const signature = await wallet.signMessage(signingMessage);
  assert.equal(verifyMessage(signingMessage, signature), wallet.address);
  assert.notEqual(
    verifyMessage(
      buildCommunicationSigningMessage({ ...communication, body: 'Altered body' }),
      signature,
    ),
    wallet.address,
  );
});



test('creator-signed token communications bind token identity and content', async () => {
  const wallet = Wallet.createRandom();
  const communication = {
    scope: 'TOKEN',
    chainId: 80002,
    tokenAddress: '0x0000000000000000000000000000000000000020',
    tokenName: 'Example Token',
    tokenSymbol: 'TEST',
    creatorAddress: wallet.address,
    authenticityStatus: 'TOKEN_OWNER_VERIFIED',
    messageId: '123e4567-e89b-42d3-a456-426614174002',
    title: 'Quarterly issuer update',
    body: 'A regular token-holder announcement.',
    category: 'GENERAL',
    audience: 'CURRENT_HOLDERS',
    publishedAt: '2026-07-29T10:00:00.000Z',
    expiresAt: '2026-08-01T10:00:00.000Z',
    actionUrl: 'https://example.test/comms',
  };
  const signingMessage = buildTokenCommunicationSigningMessage(communication);
  const signature = await wallet.signMessage(signingMessage);
  assert.equal(verifyMessage(signingMessage, signature), wallet.address);
  assert.notEqual(
    verifyMessage(
      buildTokenCommunicationSigningMessage({ ...communication, tokenAddress: '0x0000000000000000000000000000000000000030' }),
      signature,
    ),
    wallet.address,
  );
});

test('supports a single-holder Merkle snapshot', () => {
  const tree = buildSnapshotTree([
    { walletAddress: '0x0000000000000000000000000000000000000001', rawBalance: '25', votingPower: '5' },
  ]);
  assert.equal(tree.entries[0].merkleProof.length, 0);
  assert.equal(verifySnapshotProof({
    walletAddress: tree.entries[0].walletAddress,
    rawBalance: tree.entries[0].rawBalance,
    proof: [],
    root: tree.root,
  }), true);
});

test('rejects invalid proposal packing and non-natural ratios', () => {
  assert.throws(() => packProposalConfig([]));
  assert.throws(() => packProposalConfig([1]));
  assert.throws(() => packProposalConfig(Array(33).fill(2)));
  assert.throws(() => tokenUnitsPerVote(18, 0));
  assert.throws(() => tokenUnitsPerVote(18, 1.5));
});
