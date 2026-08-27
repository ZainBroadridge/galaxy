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
import { canReceiveEventCommunication, eventRecipientContext } from './communication-recipient-policy.js';
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

export async function ensureNotificationState(wallet) {
  const address = normalizeAddress(wallet, 'walletAddress');
  let result = await query(
    `SELECT started_at,last_read_at
       FROM wallet_notification_state
      WHERE wallet_address=$1`,
    [address],
  );
  if (!result.rowCount) {
    await query(
      `INSERT INTO wallet_notification_state(wallet_address)
       VALUES ($1)
       ON CONFLICT(wallet_address) DO NOTHING`,
      [address],
    );
    result = await query(
      `SELECT started_at,last_read_at
         FROM wallet_notification_state
        WHERE wallet_address=$1`,
      [address],
    );
  }
  return {
    walletAddress: address,
    startedAt: result.rows[0].started_at,
    lastReadAt: result.rows[0].last_read_at,
  };
}

export async function markInboxRead(wallet) {
  const state = await ensureNotificationState(wallet);
  const result = await query(
    `UPDATE wallet_notification_state
        SET last_read_at=now(),updated_at=now()
      WHERE wallet_address=$1
      RETURNING last_read_at`,
    [state.walletAddress],
  );
  return {
    walletAddress: state.walletAddress,
    lastReadAt: result.rows[0].last_read_at,
  };
}

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
    scope: 'EVENT',
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

async function insertTokenCommunication(message, signature) {
  await query(
    `INSERT INTO communications(
       message_id,event_id,scope,chain_id,token_address,token_name,token_symbol,creator_address,authenticity_status,
       category,audience,title,body,action_url,published_at,expires_at,creator_signature
     ) VALUES ($1,NULL,'TOKEN',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(message_id) DO NOTHING`,
    [
      message.messageId,
      message.chainId,
      message.tokenAddress,
      message.tokenName,
      message.tokenSymbol,
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
  // Establish the organiser's inbox baseline before inserting the message. If
  // this is their first notification action, creating state afterwards would
  // classify the newly published communication as historical and hide it.
  await ensureNotificationState(publisher);
  const message = eventMessageFor(event, input, relayer.address.toLowerCase());
  const signature = await relayer.signMessage(buildCommunicationSigningMessage(message));
  await insertEventCommunication(event, message, signature);
  return { ...message, signature, issuedBy: 'PLATFORM' };
}

export async function publishPlatformTokenCommunication(input) {
  const publisher = normalizeAddress(input.publisherAddress, 'publisherAddress');
  const token = await inspectToken(input.tokenAddress);
  const authenticityStatus = tokenAuthenticity(token, publisher, input.audience);
  validateActionUrl(input.actionUrl);
  await ensureNotificationState(publisher);
  const message = tokenMessageFor(
    token,
    relayer.address.toLowerCase(),
    authenticityStatus,
    input,
  );
  const signature = await relayer.signMessage(buildTokenCommunicationSigningMessage(message));
  await insertTokenCommunication(message, signature);
  return {
    ...message,
    signature,
    issuedBy: 'PLATFORM',
    publisherAddress: publisher,
  };
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
  await insertTokenCommunication(expected, input.signature);
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
  await ensureNotificationState(address);
  const result = await query(
    `INSERT INTO snap_subscriptions(wallet_address,token_address,categories,enabled)
     VALUES ($1,$2,'[]'::jsonb,$3)
     ON CONFLICT(wallet_address,token_address) DO UPDATE SET
       categories='[]'::jsonb,
       enabled=EXCLUDED.enabled,
       updated_at=CASE
         WHEN snap_subscriptions.enabled=false AND EXCLUDED.enabled=true THEN now()
         ELSE snap_subscriptions.updated_at
       END
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
    deliveredAt: row.created_at,
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
    deliveredAt: row.created_at,
    expiresAt: row.expires_at,
    signature: row.creator_signature,
  };
}

export async function eventBrowserPushRecipients(messageId) {
  const persisted = await query(
    `SELECT scope
       FROM communications
      WHERE message_id=$1
      LIMIT 1`,
    [messageId],
  );
  if (!persisted.rowCount) {
    return {
      persisted: false,
      eventScoped: true,
      candidateCount: 0,
      recipients: [],
    };
  }
  if (persisted.rows[0].scope !== 'EVENT') {
    return {
      persisted: true,
      eventScoped: false,
      candidateCount: 0,
      recipients: [],
    };
  }

  const candidates = await query(
    `SELECT push.wallet_address,push.endpoint,push.p256dh,push.auth,
            c.audience,e.snap_delivery_mode,
            (se.wallet_address IS NOT NULL) AS recipient_is_eligible,
            (v.id IS NOT NULL) AS recipient_has_voted,
            (
              s.wallet_address IS NOT NULL
              AND c.created_at>=s.updated_at
            ) AS recipient_is_subscribed,
            (
              c.message_id::text=coalesce(e.announcement_message->>'messageId','')
            ) AS is_automatic_announcement
       FROM web_push_subscriptions push
       JOIN communications c
         ON c.message_id=$1
        AND c.scope='EVENT'
       JOIN events e ON e.id=c.event_id
       JOIN snapshot_entries se
         ON se.event_id=e.id
        AND se.wallet_address=push.wallet_address
       LEFT JOIN votes v
         ON v.event_id=e.id
        AND v.voter_address=push.wallet_address
        AND v.status<>'FAILED'
       LEFT JOIN snap_subscriptions s
         ON s.wallet_address=push.wallet_address
        AND s.token_address=e.token_address
        AND s.enabled=true
      WHERE c.revoked_at IS NULL
        AND c.published_at<=now()
        AND c.expires_at>now()
        AND c.created_at>=push.created_at
      ORDER BY push.updated_at DESC`,
    [messageId],
  );

  return {
    persisted: true,
    eventScoped: true,
    candidateCount: candidates.rowCount,
    recipients: candidates.rows.filter((row) => (
      canReceiveEventCommunication(eventRecipientContext(row))
    )),
  };
}

export async function inbox(wallet, options = {}) {
  const address = normalizeAddress(wallet);
  const state = await ensureNotificationState(address);
  const messageId = typeof options.messageId === 'string'
    ? options.messageId.toLowerCase()
    : null;
  const requestedStart = options.startedAt ? new Date(options.startedAt) : null;
  const deliveryStartedAt = requestedStart && Number.isFinite(requestedStart.getTime())
    ? requestedStart
    : state.startedAt;
  const resultLimit = messageId ? 1 : 100;

  const [eventRows, tokenRows] = await Promise.all([
    query(
      `SELECT c.*,
              c.creator_address AS communication_creator_address,
              c.authenticity_status AS communication_authenticity_status,
              e.chain_id,e.title AS event_title,e.token_symbol,e.contract_address,
              e.creator_address AS event_creator_address,
              e.authenticity_status AS event_authenticity_status,
              e.snap_delivery_mode,
              (se.wallet_address IS NOT NULL) AS recipient_is_eligible,
              (v.id IS NOT NULL) AS recipient_has_voted,
              (
                s.wallet_address IS NOT NULL
                AND c.created_at>=s.updated_at
              ) AS recipient_is_subscribed,
              (
                c.message_id::text=coalesce(e.announcement_message->>'messageId','')
              ) AS is_automatic_announcement
       FROM communications c
       JOIN events e ON e.id=c.event_id
       JOIN snapshot_entries se
         ON se.event_id=e.id
        AND se.wallet_address=$1
       LEFT JOIN votes v
         ON v.event_id=e.id
        AND v.voter_address=$1
        AND v.status<>'FAILED'
       LEFT JOIN snap_subscriptions s
         ON s.wallet_address=$1
        AND s.token_address=e.token_address
        AND s.enabled=true
       WHERE c.scope='EVENT'
         AND c.revoked_at IS NULL
         AND c.published_at<=now()
         AND c.expires_at>now()
         AND c.created_at >= $2
         AND ($3::uuid IS NULL OR c.message_id=$3::uuid)
       ORDER BY c.created_at DESC`,
      [address, deliveryStartedAt, messageId],
    ),
    query(
      `SELECT c.*,s.wallet_address AS subscribed_wallet,s.updated_at AS subscribed_at
       FROM communications c
       LEFT JOIN snap_subscriptions s ON s.wallet_address=$1 AND s.token_address=c.token_address AND s.enabled=true
       WHERE c.scope='TOKEN' AND c.revoked_at IS NULL AND c.published_at<=now() AND c.expires_at>now()
         AND c.created_at >= $2
         AND ($3::uuid IS NULL OR c.message_id=$3::uuid)
         AND (
           c.audience='CURRENT_HOLDERS'
           OR (
             c.audience='SUBSCRIBERS'
             AND s.wallet_address IS NOT NULL
             AND c.created_at >= s.updated_at
           )
         )
       ORDER BY c.created_at DESC LIMIT $4`,
      [address, deliveryStartedAt, messageId, resultLimit],
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
  const lastReadAt = state.lastReadAt ? new Date(state.lastReadAt).getTime() : null;
  const eventMessages = eventRows.rows
    .filter((row) => canReceiveEventCommunication(eventRecipientContext(row)))
    .map(serializeEventCommunication);
  const messages = [
    ...eventMessages,
    ...tokenRows.rows.filter((_row, index) => tokenVisibility[index]).map(serializeTokenCommunication),
  ];
  return messages
    .sort((left, right) => (
      new Date(right.deliveredAt ?? right.publishedAt).getTime()
      - new Date(left.deliveredAt ?? left.publishedAt).getTime()
    ))
    .slice(0, 100)
    .map((message) => ({
      ...message,
      read: lastReadAt !== null
        && new Date(message.deliveredAt ?? message.publishedAt).getTime() <= lastReadAt,
    }));
}
