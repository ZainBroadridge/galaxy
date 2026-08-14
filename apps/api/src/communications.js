import { randomUUID } from 'node:crypto';
import { Contract, verifyMessage } from 'ethers';
import {
  AUTHENTICITY_STATUS,
  COMMUNICATION_AUDIENCE,
  COMMUNICATION_CATEGORY,
  STANDARD_ERC20_ABI,
  buildCommunicationSigningMessage,
  buildTokenCommunicationSigningMessage,
} from '@pv/shared';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { getEventRow } from './events.js';
import { provider, relayer } from './rpc.js';
import { inspectToken } from './tokens.js';

const NON_HOLDER_SUBSCRIBER_CATEGORIES = new Set([
  COMMUNICATION_CATEGORY.GENERAL,
  COMMUNICATION_CATEGORY.RESULTS_AVAILABLE,
]);

function commonMessage(input) {
  return {
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

function eventMessageFor(event, input, creatorAddress = event.creator_address) {
  return {
    chainId: Number(event.chain_id),
    eventId: event.id,
    eventTitle: event.title,
    tokenSymbol: event.token_symbol,
    contractAddress: event.contract_address,
    creatorAddress,
    authenticityStatus: event.authenticity_status,
    ...commonMessage(input),
  };
}

function tokenMessageFor(token, creator, authenticityStatus, input) {
  return {
    scope: 'TOKEN',
    chainId: config.chainId,
    tokenAddress: token.tokenAddress,
    tokenName: token.name,
    tokenSymbol: token.symbol,
    creatorAddress: creator,
    authenticityStatus,
    ...commonMessage(input),
  };
}

function validateActionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Invalid communication action URL.', 'INVALID_ACTION_URL'); }
  if (!config.corsOrigins.includes(url.origin)) {
    throw new HttpError(400, 'Communication links must point to an approved dApp origin.', 'INVALID_ACTION_URL');
  }
}

function tokenAuthenticity(token, creator, audience) {
  if (token.owner === creator) return AUTHENTICITY_STATUS.TOKEN_OWNER_VERIFIED;
  if (audience === COMMUNICATION_AUDIENCE.CURRENT_HOLDERS) {
    const authority = token.owner
      ? ` Verified ${token.authoritySource?.toLowerCase() ?? 'authority'}: ${token.owner}.`
      : '';
    throw new HttpError(
      403,
      `Current-holder broadcasts require the connected wallet to match the token owner() address or, when owner() is unavailable, the verified deployment creator.${authority} Use Subscribers for self-claimed token news.`,
      'TOKEN_AUTHORITY_REQUIRED',
      {
        connectedWallet: creator,
        verifiedAuthority: token.owner,
        authoritySource: token.authoritySource,
      },
    );
  }
  return AUTHENTICITY_STATUS.SELF_CLAIMED;
}

async function insertEventCommunication(event, message, signature) {
  await query(
    `INSERT INTO communications(
       message_id,event_id,scope,chain_id,creator_address,authenticity_status,
       category,audience,title,body,action_url,published_at,expires_at,
       creator_signature,signed_contract_address
     ) VALUES ($1,$2,'EVENT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(message_id) DO NOTHING`,
    [
      message.messageId,
      event.id,
      message.chainId,
      message.creatorAddress,
      message.authenticityStatus,
      message.category,
      message.audience,
      message.title,
      message.body,
      message.actionUrl,
      message.publishedAt,
      message.expiresAt,
      signature,
      message.contractAddress,
    ],
  );
}

export async function draftCommunication(eventId, wallet, input) {
  const event = await getEventRow(eventId);
  if (event.creator_address !== normalizeAddress(wallet)) throw new HttpError(403, 'Only the event creator can publish communications.', 'FORBIDDEN');
  if (!event.contract_address || event.deployment_block === null) throw new HttpError(409, 'Deploy the event before publishing communications.', 'EVENT_NOT_READY');
  validateActionUrl(input.actionUrl);
  const message = eventMessageFor(event, input);
  return { message, signingMessage: buildCommunicationSigningMessage(message) };
}

export async function publishCommunication(eventId, wallet, input) {
  const event = await getEventRow(eventId);
  const creator = normalizeAddress(wallet);
  if (event.creator_address !== creator) throw new HttpError(403, 'Only the event creator can publish communications.', 'FORBIDDEN');
  if (!event.contract_address || event.deployment_block === null) {
    throw new HttpError(409, 'Deploy the event before publishing communications.', 'EVENT_NOT_READY');
  }
  const expected = eventMessageFor(event, input.message);
  validateActionUrl(expected.actionUrl);
  if (buildCommunicationSigningMessage(expected) !== buildCommunicationSigningMessage(input.message)) {
    throw new HttpError(400, 'Signed communication fields do not match the event.', 'COMMUNICATION_MISMATCH');
  }
  let signer;
  try { signer = normalizeAddress(verifyMessage(buildCommunicationSigningMessage(expected), input.signature)); } catch { signer = null; }
  if (signer !== creator) throw new HttpError(401, 'Communication signature is invalid.', 'INVALID_SIGNATURE');
  await insertEventCommunication(event, expected, input.signature);
  return expected;
}

export async function publishPlatformCommunication(eventId, input) {
  const event = await getEventRow(eventId);
  const publisher = normalizeAddress(input.publisherAddress, 'publisherAddress');
  if (event.creator_address !== publisher) {
    throw new HttpError(403, 'Only the event creator can issue an announcement for this event.', 'FORBIDDEN');
  }
  if (!event.contract_address || event.deployment_block === null) {
    throw new HttpError(409, 'Deploy the event before publishing communications.', 'EVENT_NOT_READY');
  }
  validateActionUrl(input.actionUrl);
  const message = eventMessageFor(event, input, relayer.address.toLowerCase());
  const signature = await relayer.signMessage(buildCommunicationSigningMessage(message));
  await insertEventCommunication(event, message, signature);
  return { ...message, signature, issuedBy: 'PLATFORM' };
}

export async function draftTokenCommunication(wallet, input) {
  const creator = normalizeAddress(wallet);
  const token = await inspectToken(input.tokenAddress);
  const authenticityStatus = tokenAuthenticity(token, creator, input.audience);
  validateActionUrl(input.actionUrl);
  const message = tokenMessageFor(token, creator, authenticityStatus, input);
  return { message, signingMessage: buildTokenCommunicationSigningMessage(message) };
}

export async function publishTokenCommunication(wallet, input) {
  const creator = normalizeAddress(wallet);
  const token = await inspectToken(input.message.tokenAddress);
  const authenticityStatus = tokenAuthenticity(token, creator, input.message.audience);
  const expected = tokenMessageFor(token, creator, authenticityStatus, input.message);
  validateActionUrl(expected.actionUrl);
  if (buildTokenCommunicationSigningMessage(expected) !== buildTokenCommunicationSigningMessage(input.message)) {
    throw new HttpError(400, 'Signed communication fields do not match the token.', 'COMMUNICATION_MISMATCH');
  }
  let signer;
  try { signer = normalizeAddress(verifyMessage(buildTokenCommunicationSigningMessage(expected), input.signature)); } catch { signer = null; }
  if (signer !== creator) throw new HttpError(401, 'Communication signature is invalid.', 'INVALID_SIGNATURE');
  await query(
    `INSERT INTO communications(
       message_id,event_id,scope,chain_id,token_address,token_name,token_symbol,creator_address,authenticity_status,
       category,audience,title,body,action_url,published_at,expires_at,creator_signature
     ) VALUES ($1,NULL,'TOKEN',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(message_id) DO NOTHING`,
    [expected.messageId, expected.chainId, expected.tokenAddress, expected.tokenName, expected.tokenSymbol,
      expected.creatorAddress, expected.authenticityStatus, expected.category, expected.audience, expected.title,
      expected.body, expected.actionUrl, expected.publishedAt, expected.expiresAt, input.signature],
  );
  return expected;
}

export async function subscriptions(wallet) {
  const rows = await query(
    `SELECT token_address,enabled,updated_at
       FROM snap_subscriptions
      WHERE wallet_address=$1
      ORDER BY updated_at DESC`,
    [normalizeAddress(wallet)],
  );
  return rows.rows.map((row) => ({
    tokenAddress: row.token_address,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }));
}

export async function saveSubscription(wallet, input) {
  const address = normalizeAddress(wallet);
  const token = normalizeAddress(input.tokenAddress, 'tokenAddress');
  const result = await query(
    `INSERT INTO snap_subscriptions(wallet_address,token_address,categories,enabled)
     VALUES ($1,$2,'[]'::jsonb,$3)
     ON CONFLICT(wallet_address,token_address) DO UPDATE
       SET categories='[]'::jsonb,enabled=EXCLUDED.enabled,updated_at=now()
     RETURNING token_address,enabled,updated_at`,
    [address, token, input.enabled],
  );
  const row = result.rows[0];
  return { tokenAddress: row.token_address, enabled: row.enabled, updatedAt: row.updated_at };
}

function serializeEventCommunication(row) {
  return {
    scope: 'EVENT',
    chainId: Number(row.chain_id),
    eventId: row.event_id,
    eventTitle: row.event_title,
    tokenSymbol: row.token_symbol,
    contractAddress: row.signed_contract_address ?? row.contract_address,
    creatorAddress: row.communication_creator_address ?? row.event_creator_address,
    authenticityStatus: row.communication_authenticity_status ?? row.event_authenticity_status,
    messageId: row.message_id,
    category: row.category,
    audience: row.audience,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    signature: row.creator_signature,
    issuedBy: row.communication_creator_address ? 'PLATFORM_OR_CREATOR' : 'LEGACY_CREATOR',
  };
}

function serializeTokenCommunication(row) {
  return {
    scope: 'TOKEN',
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
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
  };
}

export async function inbox(wallet) {
  const address = normalizeAddress(wallet);
  const [eventRows, tokenRows] = await Promise.all([
    query(
      `SELECT c.*,
              c.creator_address AS communication_creator_address,
              c.authenticity_status AS communication_authenticity_status,
              e.chain_id,e.title AS event_title,e.token_symbol,e.contract_address,
              e.creator_address AS event_creator_address,
              e.authenticity_status AS event_authenticity_status
       FROM communications c JOIN events e ON e.id=c.event_id
       JOIN snapshot_entries se ON se.event_id=e.id AND se.wallet_address=$1
       LEFT JOIN votes v ON v.event_id=e.id AND v.voter_address=$1 AND v.status<>'FAILED'
       LEFT JOIN snap_subscriptions s ON s.wallet_address=$1 AND s.token_address=e.token_address AND s.enabled=true
       WHERE c.scope='EVENT' AND c.revoked_at IS NULL AND c.published_at<=now() AND c.expires_at>now()
         AND e.snap_delivery_mode<>'DISABLED'
         AND (e.snap_delivery_mode='ELIGIBLE' OR s.wallet_address IS NOT NULL)
         AND (c.audience='ALL_ELIGIBLE' OR (c.audience='NOT_VOTED' AND v.id IS NULL) OR (c.audience='SUBSCRIBERS' AND s.wallet_address IS NOT NULL))
       ORDER BY c.published_at DESC LIMIT 100`,
      [address],
    ),
    query(
      `SELECT c.*,s.wallet_address AS subscribed_wallet
       FROM communications c
       LEFT JOIN snap_subscriptions s ON s.wallet_address=$1 AND s.token_address=c.token_address AND s.enabled=true
       WHERE c.scope='TOKEN' AND c.revoked_at IS NULL AND c.published_at<=now() AND c.expires_at>now()
         AND (
           c.audience='CURRENT_HOLDERS'
           OR (c.audience='SUBSCRIBERS' AND s.wallet_address IS NOT NULL)
         )
       ORDER BY c.published_at DESC LIMIT 100`,
      [address],
    ),
  ]);

  const balanceChecks = new Map();
  const isCurrentHolder = (tokenAddress) => {
    if (!balanceChecks.has(tokenAddress)) {
      const check = new Contract(tokenAddress, STANDARD_ERC20_ABI, provider)
        .balanceOf(address)
        .then((balance) => balance > 0n)
        .catch(() => false);
      balanceChecks.set(tokenAddress, check);
    }
    return balanceChecks.get(tokenAddress);
  };
  const tokenVisibility = await Promise.all(tokenRows.rows.map(async (row) => {
    if (row.audience === COMMUNICATION_AUDIENCE.CURRENT_HOLDERS) {
      return isCurrentHolder(row.token_address);
    }
    if (!row.subscribed_wallet) return false;
    if (NON_HOLDER_SUBSCRIBER_CATEGORIES.has(row.category)) return true;
    return isCurrentHolder(row.token_address);
  }));
  const messages = [
    ...eventRows.rows.map(serializeEventCommunication),
    ...tokenRows.rows.filter((_row, index) => tokenVisibility[index]).map(serializeTokenCommunication),
  ];
  return messages
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())
    .slice(0, 100);
}
