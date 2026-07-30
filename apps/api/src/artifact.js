import { readFile } from 'node:fs/promises';

const artifactUrl = new URL('../../../packages/contracts/generated/VoteEvent.json', import.meta.url);
const verificationUrl = new URL('../../../packages/contracts/generated/VoteEvent.verification.json', import.meta.url);
let artifact; let verification;

export async function loadArtifact() {
  if (!artifact) artifact = JSON.parse(await readFile(artifactUrl, 'utf8'));
  if (!artifact?.bytecode || !Array.isArray(artifact.abi)) throw new Error('VoteEvent artifact is invalid. Run npm run compile.');
  return artifact;
}

export async function loadVerificationInput() {
  if (!verification) verification = JSON.parse(await readFile(verificationUrl, 'utf8'));
  return verification;
}
