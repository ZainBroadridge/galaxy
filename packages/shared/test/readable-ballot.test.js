import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, TypedDataEncoder, verifyMessage, verifyTypedData } from 'ethers';
import { ballotTypedData, investorSignInMessage, voteCall } from '../src/index.js';

const proposals = [{ title: 'Approve auditor', description: 'Auditor for FY2026', options: [{ text: 'For' }, { text: 'Against' }] }];
const address = '0x' + '1'.repeat(40);
test('real ECDSA verifies version-four proposal text, index, chain and contract binding', async () => {
  const wallet = Wallet.createRandom();
  const typed = ballotTypedData({ chainId: 80002, contractAddress: address, voter: wallet.address, proposals, choices: [1], ballotVersion: 4 });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  assert.equal(verifyTypedData(typed.domain, typed.types, typed.message, signature), wallet.address);
  const changes = [
    { ...typed.message, selections: [{ ...typed.message.selections[0], selectedOption: 'For' }] },
    { ...typed.message, selections: [{ ...typed.message.selections[0], optionNumber: 1 }] },
    { ...typed.message, selections: [{ ...typed.message.selections[0], proposal: 'Different proposal' }] },
  ];
  for (const message of changes) assert.notEqual(verifyTypedData(typed.domain, typed.types, message, signature), wallet.address);
  assert.notEqual(verifyTypedData({ ...typed.domain, chainId: 1 }, typed.types, typed.message, signature), wallet.address);
  assert.notEqual(verifyTypedData({ ...typed.domain, verifyingContract: '0x' + '2'.repeat(40) }, typed.types, typed.message, signature), wallet.address);
  assert.match(TypedDataEncoder.from(typed.types).encodeType('Ballot'), /VoteSelection\(uint256 proposalNumber,string proposal,uint256 optionNumber,string selectedOption\)/);
  assert.equal(voteCall({ ballotVersion: 4, voter: wallet.address, snapshotBalance: '1', proof: [], choicesBytes: typed.choicesBytes,
    choices: [1], proposals, signature }).args[4][0].selectedOption, 'Against');
});
test('legacy versions two and three retain independently verifiable signatures', async () => {
  const wallet = Wallet.createRandom();
  for (const ballotVersion of [2, 3]) {
    const typed = ballotTypedData({ chainId: 80002, contractAddress: address, voter: wallet.address, choices: [0], ballotVersion });
    const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
    assert.equal(verifyTypedData(typed.domain, typed.types, typed.message, signature), wallet.address);
  }
});
test('the login disclaimer is a different personal-sign authorization, not a ballot signature', async () => {
  const wallet = Wallet.createRandom();
  const message = investorSignInMessage({ origin: 'https://galaxy-api-ten.vercel.app', walletAddress: wallet.address,
    chainId: 80002, nonce: 'a'.repeat(48), issuedAt: '2026-09-08T12:00:00Z', expiresAt: '2026-09-08T12:10:00Z' });
  const signature = await wallet.signMessage(message);
  assert.equal(verifyMessage(message, signature), wallet.address);
  assert.notEqual(verifyMessage(message.replace('80002', '1'), signature), wallet.address);
});
