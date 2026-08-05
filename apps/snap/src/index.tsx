import type { OnHomePageHandler, OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { UnauthorizedError } from '@metamask/snaps-sdk';
import { Bold, Box, Heading, Link, Text } from '@metamask/snaps-sdk/jsx';
import { getAddress, keccak256, toUtf8Bytes, verifyMessage } from 'ethers';

const CHAIN_ID = 80002;
const MAX_MESSAGES = 100;
const MAX_NOTIFICATIONS_PER_SYNC = 3;
const CATEGORIES = new Set([
  'EVENT_ANNOUNCEMENT', 'VOTING_OPEN', 'DEADLINE_REMINDER',
  'DOCUMENT_UPDATE', 'RESULTS_AVAILABLE', 'GENERAL',
]);
const AUDIENCES = new Set(['ALL_ELIGIBLE', 'NOT_VOTED', 'SUBSCRIBERS', 'CURRENT_HOLDERS']);
const AUTHENTICITY = new Set([
  'COMMUNITY', 'SELF_CLAIMED', 'TOKEN_OWNER_VERIFIED',
]);

type Communication = {
  scope: 'EVENT' | 'TOKEN';
  chainId: number;
  messageId: string;
  eventId: string | null;
  eventTitle: string | null;
  contractAddress: string | null;
  tokenAddress: string | null;
  tokenName: string | null;
  tokenSymbol: string;
  creatorAddress: string;
  authenticityStatus: string;
  title: string;
  body: string;
  category: string;
  audience: string;
  publishedAt: string;
  expiresAt: string;
  actionUrl: string;
  signature: string;
  read: boolean;
  receivedAt: string;
};

type SnapState = {
  walletAddress: string | null;
  messages: Communication[];
  updatedAt: string | null;
};

const EMPTY_STATE: SnapState = { walletAddress: null, messages: [], updatedAt: null };

async function readState(): Promise<SnapState> {
  const stored = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  }) as Partial<SnapState> | null;
  return {
    walletAddress: stored?.walletAddress ?? null,
    messages: Array.isArray(stored?.messages) ? stored.messages : [],
    updatedAt: stored?.updatedAt ?? null,
  };
}

async function writeState(state: SnapState): Promise<void> {
  await snap.request({
    method: 'snap_manageState',
    params: { operation: 'update', newState: state },
  });
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximum = 12_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function uuid(value: unknown, name: string): string {
  const result = text(value, name, 96).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(result)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return result;
}

function address(value: unknown, name: string): string {
  try { return getAddress(text(value, name, 42)).toLowerCase(); }
  catch { throw new Error(`${name} is not a valid EVM address.`); }
}

function enumValue(value: unknown, name: string, values: Set<string>): string {
  const result = text(value, name, 64);
  if (!values.has(result)) throw new Error(`${name} is unsupported.`);
  return result;
}

function date(value: unknown, name: string): string {
  const result = new Date(text(value, name, 64));
  if (!Number.isFinite(result.getTime())) throw new Error(`${name} is invalid.`);
  return result.toISOString();
}

function oneLine(value: unknown): string {
  return String(value ?? '').trim().replace(/\r?\n/gu, ' ');
}

function bodyHash(body: string): string {
  return keccak256(toUtf8Bytes(body.replace(/\r\n/gu, '\n')));
}

function eventSigningMessage(message: Communication): string {
  return [
    'PV_COMMUNICATION_V2',
    `chainId:${oneLine(message.chainId)}`,
    `eventId:${oneLine(message.eventId)}`,
    `eventTitle:${oneLine(message.eventTitle)}`,
    `tokenSymbol:${oneLine(message.tokenSymbol)}`,
    `contract:${oneLine(message.contractAddress).toLowerCase()}`,
    `creator:${oneLine(message.creatorAddress).toLowerCase()}`,
    `authenticityStatus:${oneLine(message.authenticityStatus)}`,
    `messageId:${oneLine(message.messageId)}`,
    `title:${oneLine(message.title)}`,
    `bodyHash:${bodyHash(message.body)}`,
    `category:${oneLine(message.category)}`,
    `audience:${oneLine(message.audience)}`,
    `publishedAt:${oneLine(message.publishedAt)}`,
    `expiresAt:${oneLine(message.expiresAt)}`,
    `actionUrl:${oneLine(message.actionUrl)}`,
  ].join('\n');
}

function tokenSigningMessage(message: Communication): string {
  return [
    'PV_TOKEN_COMMUNICATION_V1',
    `chainId:${oneLine(message.chainId)}`,
    `tokenAddress:${oneLine(message.tokenAddress).toLowerCase()}`,
    `tokenName:${oneLine(message.tokenName)}`,
    `tokenSymbol:${oneLine(message.tokenSymbol)}`,
    `creator:${oneLine(message.creatorAddress).toLowerCase()}`,
    `authenticityStatus:${oneLine(message.authenticityStatus)}`,
    `messageId:${oneLine(message.messageId)}`,
    `title:${oneLine(message.title)}`,
    `bodyHash:${bodyHash(message.body)}`,
    `category:${oneLine(message.category)}`,
    `audience:${oneLine(message.audience)}`,
    `publishedAt:${oneLine(message.publishedAt)}`,
    `expiresAt:${oneLine(message.expiresAt)}`,
    `actionUrl:${oneLine(message.actionUrl)}`,
  ].join('\n');
}

function verifiedCommunication(value: unknown, dappOrigin: string): Communication {
  const input = object(value, 'communication');
  const chainId = Number(input.chainId);
  if (chainId !== CHAIN_ID) throw new Error('Only Polygon Amoy communications are accepted.');
  const scope = input.scope === 'TOKEN' ? 'TOKEN' : 'EVENT';

  const actionUrl = text(input.actionUrl, 'actionUrl', 2_000);
  let parsedAction: URL;
  try { parsedAction = new URL(actionUrl); }
  catch { throw new Error('actionUrl is invalid.'); }
  if (parsedAction.origin !== dappOrigin) {
    throw new UnauthorizedError('Communication link is outside the connected PV dApp.');
  }

  const publishedAt = date(input.publishedAt, 'publishedAt');
  const expiresAt = date(input.expiresAt, 'expiresAt');
  if (Date.parse(publishedAt) > Date.now() + 5 * 60_000) throw new Error('Future communication rejected.');
  if (Date.parse(expiresAt) <= Date.now()) throw new Error('Expired communication rejected.');
  if (Date.parse(expiresAt) <= Date.parse(publishedAt)) throw new Error('Invalid communication expiry.');

  const common = {
    scope,
    chainId,
    messageId: uuid(input.messageId, 'messageId'),
    tokenSymbol: text(input.tokenSymbol, 'tokenSymbol', 40),
    creatorAddress: address(input.creatorAddress, 'creatorAddress'),
    authenticityStatus: enumValue(input.authenticityStatus, 'authenticityStatus', AUTHENTICITY),
    title: text(input.title, 'title', 180),
    body: text(input.body, 'body'),
    category: enumValue(input.category, 'category', CATEGORIES),
    audience: enumValue(input.audience, 'audience', AUDIENCES),
    publishedAt,
    expiresAt,
    actionUrl,
    signature: text(input.signature, 'signature', 512),
  };
  const unsigned: Communication = scope === 'TOKEN'
    ? {
        ...common,
        eventId: null,
        eventTitle: null,
        contractAddress: null,
        tokenAddress: address(input.tokenAddress, 'tokenAddress'),
        tokenName: text(input.tokenName, 'tokenName', 120),
        read: false,
        receivedAt: new Date().toISOString(),
      }
    : {
        ...common,
        eventId: uuid(input.eventId, 'eventId'),
        eventTitle: text(input.eventTitle, 'eventTitle', 180),
        contractAddress: address(input.contractAddress, 'contractAddress'),
        tokenAddress: null,
        tokenName: null,
        read: false,
        receivedAt: new Date().toISOString(),
      };

  let recovered: string;
  const messageToVerify = scope === 'TOKEN' ? tokenSigningMessage(unsigned) : eventSigningMessage(unsigned);
  try { recovered = getAddress(verifyMessage(messageToVerify, unsigned.signature)).toLowerCase(); }
  catch { throw new Error('Communication creator signature is invalid.'); }
  if (recovered !== unsigned.creatorAddress) {
    throw new UnauthorizedError('Communication was not signed by the declared creator.');
  }
  return unsigned;
}

function contextTitle(message: Communication): string {
  return message.scope === 'TOKEN'
    ? `${message.tokenName} (${message.tokenSymbol})`
    : String(message.eventTitle);
}

async function notify(message: Communication): Promise<void> {
  await snap.request({
    method: 'snap_notify',
    params: {
      type: 'inApp',
      message: `${message.tokenSymbol}: ${message.title}`.slice(0, 80),
      title: message.title.slice(0, 80),
      content: (
        <Box>
          <Text><Bold>{contextTitle(message)}</Bold></Text>
          <Text>{message.body.slice(0, 1_200)}</Text>
          <Text>Creator signature verified</Text>
          <Text>{message.authenticityStatus.replaceAll('_', ' ')}</Text>
        </Box>
      ),
      footerLink: {
        href: message.actionUrl,
        text: message.scope === 'TOKEN' ? 'Open communication' : 'Open voting event',
      },
    },
  });
}

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  switch (request.method) {
    case 'ping':
      return { ok: true, protocolVersion: 3, chainId: CHAIN_ID };

    case 'setWalletContext': {
      const params = object(request.params, 'params');
      const walletAddress = address(params.walletAddress, 'walletAddress');
      const state = await readState();
      const changed = Boolean(state.walletAddress && state.walletAddress !== walletAddress);
      await writeState({
        walletAddress,
        messages: changed ? [] : state.messages,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true, walletAddress, walletChanged: changed };
    }

    case 'ingestCommunications': {
      const params = object(request.params, 'params');
      if (!Array.isArray(params.messages) || params.messages.length > 100) {
        throw new Error('messages must contain at most 100 items.');
      }
      const state = await readState();
      if (!state.walletAddress) throw new UnauthorizedError('Set the wallet context before syncing.');

      const incoming = params.messages.map((item) => verifiedCommunication(item, origin));
      const existing = new Set(state.messages.map((item) => item.messageId));
      const fresh = incoming.filter((item) => !existing.has(item.messageId));
      const messages = [...fresh, ...state.messages].slice(0, MAX_MESSAGES);
      await writeState({ ...state, messages, updatedAt: new Date().toISOString() });

      let notificationsShown = 0;
      const notificationErrors: string[] = [];
      for (const message of fresh.slice(0, MAX_NOTIFICATIONS_PER_SYNC)) {
        try { await notify(message); notificationsShown += 1; }
        catch (error) { notificationErrors.push(error instanceof Error ? error.message : String(error)); }
      }

      return {
        acceptedMessageIds: fresh.map((item) => item.messageId),
        acknowledgedMessageIds: incoming.map((item) => item.messageId),
        total: messages.length,
        notificationsShown,
        notificationErrors,
      };
    }

    case 'getInbox':
      return readState();

    case 'markAsRead': {
      const params = object(request.params, 'params');
      const messageId = uuid(params.messageId, 'messageId');
      const state = await readState();
      await writeState({
        ...state,
        messages: state.messages.map((message) => (
          message.messageId === messageId ? { ...message, read: true } : message
        )),
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    case 'clearInbox': {
      const state = await readState();
      await writeState({ ...state, messages: [], updatedAt: new Date().toISOString() });
      return { ok: true };
    }

    default:
      throw new Error(`Method not found: ${request.method}`);
  }
};

export const onHomePage: OnHomePageHandler = async () => {
  const state = await readState().catch(() => EMPTY_STATE);
  const unread = state.messages.filter((message) => !message.read).length;
  return {
    content: (
      <Box>
        <Heading>PV Investor Communications</Heading>
        <Text><Bold>{unread}</Bold> unread message(s)</Text>
        {state.messages.length === 0 ? (
          <Text>Open the Mini Galaxy PV dApp and choose Sync now.</Text>
        ) : state.messages.slice(0, 10).map((message) => (
          <Box key={message.messageId}>
            <Heading>{message.title}</Heading>
            <Text>{contextTitle(message)}</Text>
            <Text>{message.body.slice(0, 500)}</Text>
            <Text>Creator signature verified</Text>
            <Link href={message.actionUrl}>{message.scope === 'TOKEN' ? 'Open communication' : 'Open voting event'}</Link>
          </Box>
        ))}
      </Box>
    ),
  };
};
