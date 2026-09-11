import { readFile } from 'node:fs/promises';

const artifactUrl = new URL(
  '../../../packages/contracts/generated/VoteEvent.json',
  import.meta.url,
);
const verificationUrl = new URL(
  '../../../packages/contracts/generated/VoteEvent.verification.json',
  import.meta.url,
);

let artifact;
let verification;

function requireArtifact(value) {
  if (!value?.bytecode || !value?.deployedBytecode || !Array.isArray(value.abi)) {
    throw new Error('VoteEvent artifact is invalid. Run a clean contract compile.');
  }
  return value;
}

export async function loadArtifact() {
  if (!artifact) {
    artifact = requireArtifact(JSON.parse(await readFile(artifactUrl, 'utf8')));
  }
  if (!artifact.abi.some((item) => item.type === 'function' && item.name === 'castVote' && item.inputs.length === 6)) {
    throw new Error('Stale VoteEvent bytecode: compile and export the v4 contract before deploying the redesigned application.');
  }
  return artifact;
}

export async function loadVerificationInput() {
  if (!verification) {
    verification = JSON.parse(await readFile(verificationUrl, 'utf8'));
  }

  const deployment = await loadArtifact();
  if (!verification?.input || !verification?.compilerVersion || !verification?.contractName) {
    throw new Error('VoteEvent verification artifact is invalid. Run a clean contract compile.');
  }
  if (!verification.bytecode || verification.bytecode !== deployment.bytecode) {
    throw new Error(
      'VoteEvent deployment and verification artifacts do not match. '
        + 'Run a clean contract compile before deploying.',
    );
  }
  if (
    !verification.deployedBytecode
    || verification.deployedBytecode !== deployment.deployedBytecode
  ) {
    throw new Error(
      'VoteEvent runtime and verification artifacts do not match. '
        + 'Run a clean contract compile before deploying.',
    );
  }

  return verification;
}

export async function loadLegacyVerificationInput(version) {
  if (Number(version) !== 3) throw new Error('Verification source for this legacy contract is unavailable. Do not submit v4 source for an older deployment.');
  return JSON.parse(await readFile(new URL('../../../packages/contracts/legacy/VoteEvent-v3.verification.json', import.meta.url), 'utf8'));
}
