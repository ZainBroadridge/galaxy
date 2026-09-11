import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

loadEnvironment();
loadEnvironment({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

if (process.env.CONFIRM_DATABASE_RESET !== 'RESET_PV_V2') {
  throw new Error('Set CONFIRM_DATABASE_RESET=RESET_PV_V2 to reset the dedicated V2 Neon database.');
}

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_DIRECT or DATABASE_URL is required.');

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Dedicated V2 database reset. Run npm run db:migrate next.');
} finally {
  await client.end();
}
