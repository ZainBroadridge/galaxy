import { lstat, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUER_PRESETS } from '../packages/shared/src/issuer-branding.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const directories = ['apps/web/public/issuer-logos', 'apps/api/assets/issuer-logos', 'docs/brand-sources'];
const reportPath = 'docs/brand-sources/installed-artwork.json';
const extensions = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);

async function statOrNull(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function assertLocalParents(root, relative) {
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const info = await statOrNull(current);
    if (!info) return;
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Refusing non-directory or linked path: ${relative}`);
  }
}

/** Offline, opt-in removal of one retired preset's bundled artwork, not uploads or database records. */
export async function pruneIssuerArtwork(root, issuerId, { apply = false } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(issuerId ?? '')) throw new Error('Provide a lowercase issuer ID, not a path.');
  if (ISSUER_PRESETS.some((preset) => preset.id === issuerId)) throw new Error('An active issuer cannot be pruned.');
  const files = [];
  for (const directory of directories) {
    await assertLocalParents(root, `${directory}/entry`);
    const fullDirectory = path.join(root, directory);
    if (!(await statOrNull(fullDirectory))) continue;
    for (const name of await readdir(fullDirectory)) {
      const lower = name.toLowerCase();
      const extension = path.extname(lower);
      const stem = lower.slice(0, -extension.length);
      if (!extensions.has(extension) || !(stem === issuerId || stem === `${issuerId}-logo`
        || stem.startsWith(`${issuerId}-brand-`) || stem.startsWith(`${issuerId}-logo-`))) continue;
      const relative = `${directory}/${name}`;
      const info = await lstat(path.join(root, relative));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing a non-regular artwork file: ${relative}`);
      files.push(relative);
    }
  }

  // Validate the optional installation record before changing any files.
  await assertLocalParents(root, reportPath);
  const reportInfo = await statOrNull(path.join(root, reportPath));
  let updatedReport = null;
  if (reportInfo) {
    if (!reportInfo.isFile() || reportInfo.isSymbolicLink()) throw new Error('Installation record is not a regular file.');
    const installed = JSON.parse(await readFile(path.join(root, reportPath), 'utf8'));
    if (!Array.isArray(installed)) throw new Error('Installation record must contain an array.');
    const retained = installed.filter((entry) => String(entry?.id ?? '').toLowerCase() !== issuerId);
    if (retained.length !== installed.length) updatedReport = retained;
  }
  if (apply) {
    if (updatedReport) {
      const destination = path.join(root, reportPath);
      const temporary = `${destination}.${process.pid}.tmp`;
      let ownsTemporary = false;
      try {
        await writeFile(temporary, `${JSON.stringify(updatedReport, null, 2)}\n`, { flag: 'wx' });
        ownsTemporary = true;
        await rename(temporary, destination);
        ownsTemporary = false;
      } finally {
        if (ownsTemporary) await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    }
    for (const relative of files) {
      await unlink(path.join(root, relative)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return { files: files.sort(), recordUpdated: updatedReport !== null, applied: apply };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] !== '--issuer' || !args[1] || args.length > 3 || (args[2] && args[2] !== '--apply')) {
    console.error('Usage: node scripts/prune-issuer-artwork.mjs --issuer <retired-id> [--apply]');
    process.exitCode = 1;
  } else {
    try {
      const result = await pruneIssuerArtwork(projectRoot, args[1], { apply: args[2] === '--apply' });
      for (const file of result.files) console.log(`${result.applied ? 'Removed' : 'Would remove'}: ${file}`);
      if (result.recordUpdated) console.log(`${result.applied ? 'Updated' : 'Would update'}: ${reportPath}`);
      if (!result.files.length && !result.recordUpdated) console.log('No retired artwork remains in the managed directories.');
      else if (!result.applied) console.log('Preview only. Add --apply to perform these removals.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
