import { randomUUID } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { buildCommunicationSigningMessage } from '@pv/shared';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { getEventRow } from './events.js';

function messageFor(event, input) {
  return {
    chainId: Number(event.chain_id),
    eventId: event.id,
    eventTitle: event.title,
    tokenSymbol: event.token_symbol,
    contractAddress: event.contract_address,
    creatorAddress: event.creator_address,
    authenticityStatus: event.authenticity_status,
    messageId: input.messageId ?? randomUUID(),
    category: input.category,
    audience: input.audience,
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    publishedAt: new Date(input.publishedAt ?? Date.now()).toISOString(),
    expiresAt: new Date(input.expiresAt).toISOString(),
  };
}

function validateActionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Invalid communication action URL.', 'INVALID_ACTION_URL'); }
  if (!config.corsOrigins.includes(url.origin)) {
    throw new HttpError(400, 'Communication links must point to an approved dApp origin.', 'INVALID_ACTION_URL');
  }
}

export async function draftCommunication(eventId, wallet, input) {
  const event = await getEventRow(eventId);
  if (event.creator_address !== normalizeAddress(wallet)) throw new HttpError(403, 'Only the event creator can publish communications.', 'FORBIDDEN');
  if (!event.contract_address || event.deployment_block === null) throw new HttpError(409, 'Deploy the event before publishing communications.', 'EVENT_NOT_READY');
  validateActionUrl(input.actionUrl);
  const message = messageFor(event, input);
  return { message, signingMessage: buildCommunicationSigningMessage(message) };
}

export async function publishCommunication(eventId, wallet, input) {
  const event = await getEventRow(eventId);
  const creator = normalizeAddress(wallet);
  if (event.creator_address !== creator) throw new HttpError(403, 'Only the event creator can publish communications.', 'FORBIDDEN');
  if (!event.contract_address || event.deployment_block === null) {
    throw new HttpError(409, 'Deploy the event before publishing communications.', 'EVENT_NOT_READY');
  }
  const expected = messageFor(event, input.message);
  validateActionUrl(expected.actionUrl);
  if (buildCommunicationSigningMessage(expected) !== buildCommunicationSigningMessage(input.message)) {
    throw new HttpError(400, 'Signed communication fields do not match the event.', 'COMMUNICATION_MISMATCH');
  }
  let signer;
  try { signer = normalizeAddress(verifyMessage(buildCommunicationSigningMessage(expected), input.signature)); } catch { signer = null; }
  if (signer !== creator) throw new HttpError(401, 'Communication signature is invalid.', 'INVALID_SIGNATURE');
  await query(
    `INSERT INTO communications(message_id,event_id,category,audience,title,body,action_url,published_at,expires_at,creator_signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(message_id) DO NOTHING`,
    [expected.messageId, eventId, expected.category, expected.audience, expected.title, expected.body,
      expected.actionUrl, expected.publishedAt, expected.expiresAt, input.signature],
  );
  return expected;
}

export async function subscriptions(wallet) {
  const rows = await query('SELECT token_address,categories,enabled,updated_at FROM snap_subscriptions WHERE wallet_address=$1 ORDER BY updated_at DESC', [normalizeAddress(wallet)]);
  return rows.rows.map((row) => ({ tokenAddress: row.token_address, categories: row.categories, enabled: row.enabled, updatedAt: row.updated_at }));
}

export async function saveSubscription(wallet, input) {
  const address = normalizeAddress(wallet);
  const token = normalizeAddress(input.tokenAddress, 'tokenAddress');
  const result = await query(
    `INSERT INTO snap_subscriptions(wallet_address,token_address,categories,enabled)
     VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT(wallet_address,token_address) DO UPDATE SET categories=EXCLUDED.categories,enabled=EXCLUDED.enabled,updated_at=now()
     RETURNING *`,
    [address, token, JSON.stringify(input.categories), input.enabled],
  );
  return result.rows[0];
}

export async function inbox(wallet) {
  const address = normalizeAddress(wallet);
  const rows = await query(
    `SELECT c.*,e.chain_id,e.title AS event_title,e.token_symbol,e.contract_address,e.creator_address,e.authenticity_status
     FROM communications c JOIN events e ON e.id=c.event_id
     JOIN snapshot_entries se ON se.event_id=e.id AND se.wallet_address=$1
     LEFT JOIN votes v ON v.event_id=e.id AND v.voter_address=$1 AND v.status<>'FAILED'
     LEFT JOIN snap_subscriptions s ON s.wallet_address=$1 AND s.token_address=e.token_address AND s.enabled=true
     WHERE c.revoked_at IS NULL AND c.published_at<=now() AND c.expires_at>now()
       AND e.snap_delivery_mode<>'DISABLED'
       AND (e.snap_delivery_mode='ELIGIBLE' OR s.wallet_address IS NOT NULL)
       AND (c.audience='ALL_ELIGIBLE' OR (c.audience='NOT_VOTED' AND v.id IS NULL) OR (c.audience='SUBSCRIBERS' AND s.wallet_address IS NOT NULL))
       AND (s.categories IS NULL OR s.categories='[]'::jsonb OR s.categories ? c.category)
     ORDER BY c.published_at DESC LIMIT 100`,
    [address],
  );
  return rows.rows.map((row) => ({
    chainId: Number(row.chain_id),
    eventId: row.event_id,
    eventTitle: row.event_title,
    tokenSymbol: row.token_symbol,
    contractAddress: row.contract_address,
    creatorAddress: row.creator_address,
    authenticityStatus: row.authenticity_status,
    messageId: row.message_id,
    category: row.category,
    audience: row.audience,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    signature: row.creator_signature,
  }));
}
