import { getAddress, keccak256 } from 'ethers';

export const BALLOT_TYPES_V2 = Object.freeze({
  Ballot: [
    { name: 'voter', type: 'address' },
    { name: 'choicesHash', type: 'bytes32' },
  ],
});

export const BALLOT_TYPES_V3 = Object.freeze({
  Ballot: [
    { name: 'voter', type: 'address' },
    { name: 'selectedOptions', type: 'string' },
  ],
});

export function choicesToBytes(choices) {
  if (!Array.isArray(choices) || choices.length === 0 || choices.length > 32) {
    throw new Error('Choices must contain 1-32 option indexes.');
  }
  const bytes = new Uint8Array(choices.length);
  choices.forEach((choice, index) => {
    const value = Number(choice);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Choice ${index + 1} is not an unsigned byte.`);
    }
    bytes[index] = value;
  });
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function selectedOptionsText(choices) {
  if (!Array.isArray(choices) || choices.length === 0 || choices.length > 32) {
    throw new Error('Choices must contain 1-32 option indexes.');
  }
  return choices.map((choice, proposalIndex) => {
    const optionIndex = Number(choice);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
      throw new Error(`Choice ${proposalIndex + 1} must be option 1, 2, 3, or 4.`);
    }
    return `Proposal ${proposalIndex + 1} = Option ${optionIndex + 1}`;
  }).join('; ');
}

export function ballotTypedData({ chainId, contractAddress, voter, choices, ballotVersion = 3 }) {
  const version = Number(ballotVersion);
  if (![2, 3].includes(version)) throw new Error(`Unsupported ballot version: ${ballotVersion}.`);
  const choicesBytes = choicesToBytes(choices);
  const voterAddress = getAddress(voter);
  const isReadable = version === 3;
  return {
    domain: {
      name: 'PV VoteEvent',
      version: String(version),
      chainId: Number(chainId),
      verifyingContract: getAddress(contractAddress),
    },
    types: isReadable ? BALLOT_TYPES_V3 : BALLOT_TYPES_V2,
    primaryType: 'Ballot',
    message: isReadable
      ? { voter: voterAddress, selectedOptions: selectedOptionsText(choices) }
      : { voter: voterAddress, choicesHash: keccak256(choicesBytes) },
    choicesBytes,
  };
}
