import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const normalize = (text) => text.replace(/\r\n/g, '\n').trim();

try {
  const artifact = await json('packages/contracts/generated/VoteEvent.json');
  const verification = await json('packages/contracts/generated/VoteEvent.verification.json');
  const source = await readFile(new URL('packages/contracts/contracts/VoteEvent.sol', root), 'utf8');
  const call = artifact.abi.find((item) => item.type === 'function' && item.name === 'castVote' && item.inputs.length === 6);
  assert.ok(call, 'Stale generated contract: run the clean compile and artifact export before release.');
  assert.equal(call.inputs.map((item) => item.type).join(','), 'address,uint256,bytes32[],bytes,tuple[],bytes');
  assert.equal(call.inputs[4].components.map((item) => `${item.type} ${item.name}`).join(','),
    'uint256 proposalNumber,string proposal,uint256 optionNumber,string selectedOption');
  const log = artifact.abi.find((item) => item.type === 'event' && item.name === 'VoteCast');
  assert.equal(log?.inputs[2]?.type, 'string', 'VoteCast must expose readable selected options.');
  assert.equal(verification.input.settings.viaIR, true);
  assert.equal(verification.input.settings.evmVersion, 'cancun');
  assert.equal(artifact.bytecode, verification.bytecode, 'Creation bytecode and verification input disagree.');
  assert.equal(artifact.deployedBytecode, verification.deployedBytecode, 'Runtime bytecode and verification input disagree.');
  assert.equal(normalize(source), normalize(verification.input.sources[artifact.sourceName].content), 'Verification source does not match VoteEvent.sol.');
  assert.ok((artifact.deployedBytecode.length - 2) / 2 <= 24_576, 'Contract exceeds EIP-170 runtime limit.');
  const legacy = await json('packages/contracts/legacy/VoteEvent-v3.json');
  const legacyVerification = await json('packages/contracts/legacy/VoteEvent-v3.verification.json');
  assert.ok(legacy.abi.some((item) => item.type === 'function' && item.name === 'castVote' && item.inputs.length === 5));
  assert.equal(legacy.bytecode, legacyVerification.bytecode);
  console.log('Investor release artifacts aligned: v4 readable ballot, matching source/bytecode, archived v3 retained.');
} catch (error) {
  console.error(`Investor release check failed: ${error.message}`);
  process.exitCode = 1;
}
