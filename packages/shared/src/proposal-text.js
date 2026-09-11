import { MAX_OPTION_LABEL_LENGTH, MAX_PROPOSAL_TITLE_LENGTH } from './constants.js';

/** Creation-time rules only: never shorten or revalidate stored voting metadata. */
export function proposalTextIssues(proposals) {
  const issues = [];
  if (!Array.isArray(proposals)) return issues;
  const check = (value, maximum, path, label) => {
    // Structural/type checks remain the responsibility of the API schema.
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (!text) issues.push({ path, message: `${label} is required.` });
    else if (text.length > maximum) issues.push({ path, message: `${label} must be ${maximum} characters or fewer (currently ${text.length}).` });
    else if (/[\r\n\t\u2028\u2029]/u.test(text)) issues.push({ path, message: `${label} must be on one line.` });
  };
  proposals.forEach((proposal, index) => {
    check(proposal?.title, MAX_PROPOSAL_TITLE_LENGTH, ['proposals', index, 'title'], `Proposal ${index + 1} title`);
    if (!Array.isArray(proposal?.options)) return;
    proposal.options.forEach((option, optionIndex) => {
      check(option, MAX_OPTION_LABEL_LENGTH, ['proposals', index, 'options', optionIndex], `Proposal ${index + 1}, option ${optionIndex + 1}`);
    });
  });
  return issues;
}
