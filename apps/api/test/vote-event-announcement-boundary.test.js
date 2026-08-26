import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('VoteEvent emits the explorer-readable proposal announcement tuple', async () => {
  const [contract, deploy, verify, abi, hardhat] = await Promise.all([
    read('packages/contracts/contracts/VoteEvent.sol'),
    read('apps/api/src/deploy.js'),
    read('apps/api/src/verify.js'),
    read('packages/shared/src/abi.js'),
    read('packages/contracts/hardhat.config.cjs'),
  ]);

  assert.match(contract, /struct ProposalInput\s*\{[\s\S]*string proposalText;[\s\S]*string\[4\] options;[\s\S]*uint256 formId;[\s\S]*uint8 recommendation;/u);
  assert.match(contract, /event AnnouncedProposals\(uint256 proposalCount, ProposalInput\[\] proposals\);/u);
  assert.match(contract, /emit AnnouncedProposals\(proposals_\.length, proposals_\);/u);
  assert.match(deploy, /proposalAnnouncements\(event\)/u);
  assert.match(verify, /tuple\(string,string\[4\],uint256,uint8\)\[\]/u);
  assert.match(abi, /name: 'AnnouncedProposals'/u);
  assert.match(hardhat, /viaIR: true/u);
});
