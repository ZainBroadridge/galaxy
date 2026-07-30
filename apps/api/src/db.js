import pg from 'pg';
import { config } from './config.js';

const remote = config.databaseUrl && !config.databaseUrl.includes('localhost');
export const db = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: remote ? { rejectUnauthorized: false } : undefined,
});

db.on('error', (error) => console.error('PostgreSQL pool error', error));
export const query = (text, params = []) => db.query(text, params);

export async function transaction(callback) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock(name, callback) {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [name]);
    return await callback(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]).catch(() => {});
    client.release();
  }
}
