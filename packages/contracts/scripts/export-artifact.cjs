const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const artifactPath = path.join(
  __dirname,
  '..',
  'artifacts',
  'contracts',
  'VoteEvent.sol',
  'VoteEvent.json',
);
const buildInfoDirectory = path.join(__dirname, '..', 'artifacts', 'build-info');
const generatedDirectory = path.join(__dirname, '..', 'generated');

function withHexPrefix(value = '') {
  return value.startsWith('0x') ? value : `0x${value}`;
}

function contractOutput(buildInfo, artifact) {
  return buildInfo.output?.contracts?.[artifact.sourceName]?.[artifact.contractName];
}

function matchesArtifact(buildInfo, artifact) {
  const output = contractOutput(buildInfo, artifact);
  if (!output) return false;

  const creationBytecode = withHexPrefix(output.evm?.bytecode?.object);
  const runtimeBytecode = withHexPrefix(output.evm?.deployedBytecode?.object);

  return creationBytecode === artifact.bytecode
    && runtimeBytecode === artifact.deployedBytecode;
}

if (!fs.existsSync(artifactPath)) {
  throw new Error(`Hardhat artifact not found: ${artifactPath}`);
}
if (!fs.existsSync(buildInfoDirectory)) {
  throw new Error('Hardhat build-info directory was not found. Run a clean compile.');
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const deployedBytes = Math.max(0, (artifact.deployedBytecode.length - 2) / 2);
if (deployedBytes > 24_576) {
  throw new Error(
    `VoteEvent deployed bytecode is ${deployedBytes} bytes, above the EVM limit.`,
  );
}

const matchingBuilds = fs.readdirSync(buildInfoDirectory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const file = path.join(buildInfoDirectory, name);
    const buildInfo = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, buildInfo, modifiedAt: fs.statSync(file).mtimeMs };
  })
  .filter(({ buildInfo }) => matchesArtifact(buildInfo, artifact))
  .sort((left, right) => right.modifiedAt - left.modifiedAt);

if (matchingBuilds.length === 0) {
  throw new Error(
    'No Hardhat build-info exactly matches the current VoteEvent deployment artifact. '
      + 'Run "npm run clean --workspace ./packages/contracts" and then "npm run compile".',
  );
}

const { buildInfo, file: buildInfoFile } = matchingBuilds[0];
const bytecodeSha256 = crypto
  .createHash('sha256')
  .update(artifact.bytecode)
  .digest('hex');

fs.mkdirSync(generatedDirectory, { recursive: true });
fs.writeFileSync(
  path.join(generatedDirectory, 'VoteEvent.json'),
  `${JSON.stringify({
    contractName: artifact.contractName,
    sourceName: artifact.sourceName,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
  }, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(generatedDirectory, 'VoteEvent.verification.json'),
  `${JSON.stringify({
    contractName: `${artifact.sourceName}:${artifact.contractName}`,
    compilerVersion: `v${buildInfo.solcLongVersion}`,
    bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
    bytecodeSha256,
    input: buildInfo.input,
  }, null, 2)}\n`,
);

console.log(
  `Exported matching VoteEvent deployment and verification artifacts `
    + `(${deployedBytes} deployed bytes; build-info ${path.basename(buildInfoFile)}).`,
);
