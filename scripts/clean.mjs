import { rm } from 'node:fs/promises';

for (const directory of ['apps/web/dist', 'apps/snap/dist', 'coverage']) {
  await rm(directory, { recursive: true, force: true });
}
console.log('Removed generated frontend, Snap, and coverage output.');
