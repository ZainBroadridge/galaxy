/** Text committed at deployment. Keep CRLF handling identical across clients. */
export function proposalAnnouncementText(proposal) {
  const clean = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();
  const title = clean(proposal?.title);
  const description = clean(proposal?.description);
  if (!title) throw new Error('A proposal title is required.');
  return description ? `${title}\n\n${description}` : title;
}

export function readableBallotSelections(proposals, choices) {
  if (!Array.isArray(proposals) || proposals.length < 1 || proposals.length > 32
    || !Array.isArray(choices) || choices.length !== proposals.length) {
    throw new Error('Select one option for every proposal.');
  }
  return proposals.map((proposal, index) => {
    const choice = choices[index];
    if (!Number.isInteger(choice) || choice < 0 || choice >= (proposal?.options?.length ?? 0)) {
      throw new Error(`Invalid option for proposal ${index + 1}.`);
    }
    const option = proposal.options[choice];
    const selectedOption = String(option?.text ?? option ?? '').replace(/\r\n/g, '\n').trim();
    if (!selectedOption) throw new Error(`Missing option text for proposal ${index + 1}.`);
    return { proposalNumber: index + 1, proposal: proposalAnnouncementText(proposal), optionNumber: choice + 1, selectedOption };
  });
}

/** Display text only. The signature hashes each selection as an EIP-712 struct. */
export function readableVoteText(selections) {
  return selections.map((selection, index) => (
    `Proposal ${index + 1}: ${selection.proposal}\nSelected option: ${selection.selectedOption}`
  )).join('\n\n');
}

export const LEGACY_CAST_VOTE = 'castVote(address,uint256,bytes32[],bytes,bytes)';
export const READABLE_CAST_VOTE = 'castVote(address,uint256,bytes32[],bytes,(uint256,string,uint256,string)[],bytes)';

export function voteCall({ ballotVersion, voter, snapshotBalance, proof, choicesBytes, choices, proposals, signature }) {
  const base = [voter, BigInt(snapshotBalance), proof, choicesBytes];
  if (Number(ballotVersion) === 4) {
    return { method: READABLE_CAST_VOTE, args: [...base, readableBallotSelections(proposals, choices), signature] };
  }
  if (![2, 3].includes(Number(ballotVersion))) throw new Error('Unsupported ballot version.');
  return { method: LEGACY_CAST_VOTE, args: [...base, signature] };
}
