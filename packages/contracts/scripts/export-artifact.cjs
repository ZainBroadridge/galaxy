const fs = require('node:fs');
const path = require('node:path');

const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'VoteEvent.sol', 'VoteEvent.json');
const buildInfoDirectory = path.join(__dirname, '..', 'artifacts', 'build-info');
const generatedDirectory = path.join(__dirname, '..', 'generated');

if (!fs.existsSync(artifactPath)) throw new Error(`Hardhat artifact not found: ${artifactPath}`);
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const bytes = Math.max(0, (artifact.deployedBytecode.length - 2) / 2);
if (bytes > 24_576) throw new Error(`VoteEvent deployed bytecode is ${bytes} bytes, above the EVM limit.`);

const buildInfoFile = fs.readdirSync(buildInfoDirectory)
  .map((name) => path.join(buildInfoDirectory, name))
  .find((file) => {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value.output?.contracts?.[artifact.sourceName]?.[artifact.contractName];
  });
if (!buildInfoFile) throw new Error('Hardhat build-info for VoteEvent was not found.');
const buildInfo = JSON.parse(fs.readFileSync(buildInfoFile, 'utf8'));

fs.mkdirSync(generatedDirectory, { recursive: true });
fs.writeFileSync(path.join(generatedDirectory, 'VoteEvent.json'), JSON.stringify({
  contractName: artifact.contractName,
  sourceName: artifact.sourceName,
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  deployedBytecode: artifact.deployedBytecode,
}, null, 2));
fs.writeFileSync(path.join(generatedDirectory, 'VoteEvent.verification.json'), JSON.stringify({
  contractName: `${artifact.sourceName}:${artifact.contractName}`,
  compilerVersion: `v${buildInfo.solcLongVersion}`,
  input: buildInfo.input,
}, null, 2));
console.log(`Exported VoteEvent deployment and verification artifacts (${bytes} deployed bytes).`);
