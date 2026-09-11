import { readFile, writeFile } from 'node:fs/promises';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1];
}

const origin = String(option('origin') ?? '').replace(/\/$/u, '');
const packageName = String(option('package') ?? '');
const repository = String(option('repository') ?? '').replace(/\/$/u, '');

if (!/^https:\/\/[^/]+$/u.test(origin)) {
  throw new Error('Use --origin https://your-production-dapp.example');
}
if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
  throw new Error('Use --package @your-npm-scope/pv-communications-snap');
}
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/iu.test(repository)) {
  throw new Error('Use --repository https://github.com/OWNER/REPOSITORY.git');
}

const packagePath = new URL('../apps/snap/package.json', import.meta.url);
const manifestPath = new URL('../apps/snap/snap.manifest.json', import.meta.url);
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

packageJson.name = packageName;
packageJson.repository = { type: 'git', url: repository };
manifest.version = packageJson.version;
manifest.repository = { type: 'git', url: repository };
manifest.source.location.npm.packageName = packageName;
manifest.initialPermissions['endowment:rpc'].allowedOrigins = [origin];
manifest.initialConnections = { [origin]: {} };

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
]);

console.log(`Configured ${packageName}`);
console.log(`Authorized dApp origin: ${origin}`);
console.log(`After npm publish, set VITE_SNAP_ID=npm:${packageName} in Vercel.`);
