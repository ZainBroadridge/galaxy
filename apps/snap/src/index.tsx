import type {
  OnCronjobHandler,
  OnHomePageHandler,
  OnRpcRequestHandler,
} from '@metamask/snaps-sdk';
import { UnauthorizedError } from '@metamask/snaps-sdk';
import { Box, Heading, Link, Text } from '@metamask/snaps-sdk/jsx';
import { getAddress, keccak256, toUtf8Bytes, verifyMessage } from 'ethers';

const CHAIN_ID = 80002;
const DAPP_ORIGIN = 'https://galaxy-api-ten.vercel.app';
const API_BASE_URL = 'https://mini-galaxy-pv-v2-bz12.onrender.com';
const POLL_METHOD = 'pollCommunications';
const MAX_MESSAGES = 100;
const MAX_IN_APP_NOTIFICATIONS = 3;
const REQUEST_TIMEOUT_MS = 12_000;

const CATEGORIES = new Set([
  'EVENT_ANNOUNCEMENT',
  'VOTING_OPEN',
  'DEADLINE_REMINDER',
  'DOCUMENT_UPDATE',
  'RESULTS_AVAILABLE',
  'GENERAL',
]);
const AUDIENCES = new Set([
  'ALL_ELIGIBLE',
  'NOT_VOTED',
  'SUBSCRIBERS',
  'CURRENT_HOLDERS',
]);
const AUTHENTICITY = new Set([
  'COMMUNITY',
  'SELF_CLAIMED',
  'TOKEN_OWNER_VERIFIED',
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
  backgroundEnabled: boolean;
  messages: Communication[];
  lastCheckedAt: string | null;
  lastError: string | null;
  lastDeliveryError: string | null;
  lastNativeNotificationAt: string | null;
  updatedAt: string | null;
};

type PollResult = {
  ok: boolean;
  acceptedMessageIds: string[];
  total: number;
  rejected: number;
  notificationErrors: string[];
  nativeNotified: boolean;
  error?: string;
};

const EMPTY_STATE: SnapState = {
  walletAddress: null,
  backgroundEnabled: false,
  messages: [],
  lastCheckedAt: null,
  lastError: null,
  lastDeliveryError: null,
  lastNativeNotificationAt: null,
  updatedAt: null,
};

async function readUnencryptedState(): Promise<SnapState> {
  const stored = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get', encrypted: false },
  }) as Partial<SnapState> | null;

  return {
    walletAddress: stored?.walletAddress ?? null,
    backgroundEnabled: stored?.backgroundEnabled === true,
    messages: Array.isArray(stored?.messages) ? stored.messages : [],
    lastCheckedAt: stored?.lastCheckedAt ?? null,
    lastError: typeof stored?.lastError === 'string' ? stored.lastError : null,
    lastDeliveryError: typeof stored?.lastDeliveryError === 'string' ? stored.lastDeliveryError : null,
    lastNativeNotificationAt: stored?.lastNativeNotificationAt ?? null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

async function writeState(state: SnapState): Promise<void> {
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: state,
      encrypted: false,
    },
  });
}

async function migrateLegacyState(): Promise<SnapState> {
  const current = await readUnencryptedState();
  if (
    current.walletAddress
    || current.messages.length
    || current.updatedAt
  ) {
    return current;
  }

  try {
    const legacy = await snap.request({
      method: 'snap_manageState',
      params: { operation: 'get' },
    }) as Partial<SnapState> | null;

    if (!legacy) return current;

    const migrated: SnapState = {
      ...EMPTY_STATE,
      walletAddress: legacy.walletAddress ?? null,
      messages: Array.isArray(legacy.messages) ? legacy.messages : [],
      updatedAt: legacy.updatedAt ?? null,
    };
    await writeState(migrated);
    await snap.request({
      method: 'snap_manageState',
      params: { operation: 'clear' },
    });
    return migrated;
  } catch {
    return current;
  }
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
  try {
    return getAddress(text(value, name, 42)).toLowerCase();
  } catch {
    throw new Error(`${name} is not a valid EVM address.`);
  }
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

function verifiedCommunication(value: unknown): Communication {
  const input = object(value, 'communication');
  const chainId = Number(input.chainId);
  if (chainId !== CHAIN_ID) {
    throw new Error('Only Polygon Amoy communications are accepted.');
  }

  const scope: Communication['scope'] = input.scope === 'TOKEN' ? 'TOKEN' : 'EVENT';
  const actionUrl = text(input.actionUrl, 'actionUrl', 2_000);
  let parsedAction: URL;
  try {
    parsedAction = new URL(actionUrl);
  } catch {
    throw new Error('actionUrl is invalid.');
  }
  if (parsedAction.origin !== DAPP_ORIGIN) {
    throw new UnauthorizedError('Communication link is outside the Mini Galaxy dApp.');
  }

  const publishedAt = date(input.publishedAt, 'publishedAt');
  const expiresAt = date(input.expiresAt, 'expiresAt');
  if (Date.parse(publishedAt) > Date.now() + 5 * 60_000) {
    throw new Error('Future communication rejected.');
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new Error('Expired communication rejected.');
  }
  if (Date.parse(expiresAt) <= Date.parse(publishedAt)) {
    throw new Error('Invalid communication expiry.');
  }

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

  const signingMessage = scope === 'TOKEN'
    ? tokenSigningMessage(unsigned)
    : eventSigningMessage(unsigned);

  let recovered: string;
  try {
    recovered = getAddress(verifyMessage(signingMessage, unsigned.signature)).toLowerCase();
  } catch {
    throw new Error('Communication creator signature is invalid.');
  }
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

function activeMessages(messages: Communication[]): Communication[] {
  const now = Date.now();
  return messages.filter((message) => Date.parse(message.expiresAt) > now);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function notifyInApp(message: Communication): Promise<void> {
  await snap.request({
    method: 'snap_notify',
    params: {
      type: 'inApp',
      message: `${message.tokenSymbol}: ${message.title}`.slice(0, 80),
    },
  });
}

async function notifyNative(messages: Communication[]): Promise<void> {
  const notification = messages.length === 1
    ? `${messages[0].tokenSymbol}: ${messages[0].title}`
    : `${messages.length} new investor communications`;

  await snap.request({
    method: 'snap_notify',
    params: {
      type: 'native',
      message: notification.slice(0, 80),
    },
  });
}

async function fetchInbox(walletAddress: string): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/communications/inbox?wallet=${encodeURIComponent(walletAddress)}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Communications API returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('Communications API returned an invalid response.');
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollCommunications(throwOnError = false): Promise<PollResult> {
  const state = await readUnencryptedState();
  if (!state.backgroundEnabled || !state.walletAddress) {
    return {
      ok: true,
      acceptedMessageIds: [],
      total: state.messages.length,
      rejected: 0,
      notificationErrors: [],
      nativeNotified: false,
    };
  }

  const checkedAt = new Date().toISOString();
  try {
    const payload = await fetchInbox(state.walletAddress);
    const incoming: Communication[] = [];
    let rejected = 0;

    for (const item of payload) {
      try {
        incoming.push(verifiedCommunication(item));
      } catch {
        rejected += 1;
      }
    }

    const existingMessages = activeMessages(state.messages);
    const known = new Set(existingMessages.map((message) => message.messageId));
    const fresh = incoming.filter((message) => !known.has(message.messageId));
    const messages = [...fresh, ...existingMessages].slice(0, MAX_MESSAGES);

    let lastNativeNotificationAt = state.lastNativeNotificationAt;
    let lastDeliveryError = state.lastDeliveryError;
    const notificationErrors: string[] = [];
    let nativeNotified = false;

    const nextState: SnapState = {
      ...state,
      messages,
      lastCheckedAt: checkedAt,
      lastError: null,
      updatedAt: checkedAt,
    };

    // Commit the verified inbox first. Notification presentation is best-effort
    // and must never cause a message to disappear from MetaMask state.
    await writeState(nextState);

    for (const message of fresh.slice(0, MAX_IN_APP_NOTIFICATIONS)) {
      try {
        await notifyInApp(message);
      } catch (error) {
        notificationErrors.push(`In-app alert: ${errorMessage(error)}`);
      }
    }

    // Fresh message IDs are already deduplicated, so one native notification per
    // fresh batch is sufficient and does not need an additional five-minute gate.
    if (fresh.length > 0) {
      try {
        await notifyNative(fresh);
        nativeNotified = true;
        lastNativeNotificationAt = checkedAt;
      } catch (error) {
        notificationErrors.push(`Native alert: ${errorMessage(error)}`);
      }
      lastDeliveryError = notificationErrors.length
        ? notificationErrors.join(' | ')
        : null;
    }

    const finalState: SnapState = {
      ...nextState,
      lastDeliveryError,
      lastNativeNotificationAt,
    };
    await writeState(finalState);

    return {
      ok: true,
      acceptedMessageIds: fresh.map((message) => message.messageId),
      total: messages.length,
      rejected,
      notificationErrors,
      nativeNotified,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeState({
      ...state,
      lastCheckedAt: checkedAt,
      lastError: message,
      updatedAt: checkedAt,
    });
    if (throwOnError) throw error;
    return {
      ok: false,
      acceptedMessageIds: [],
      total: state.messages.length,
      rejected: 0,
      notificationErrors: [],
      nativeNotified: false,
      error: message,
    };
  }
}

function assertTrustedDapp(origin: string): void {
  if (origin !== DAPP_ORIGIN) {
    throw new UnauthorizedError('Only the Mini Galaxy companion dApp may configure this Snap.');
  }
}

export const onCronjob: OnCronjobHandler = async ({ request }) => {
  if (request.method !== POLL_METHOD) {
    throw new Error(`Method not found: ${request.method}`);
  }
  return pollCommunications(false);
};

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  assertTrustedDapp(origin);

  switch (request.method) {
    case 'ping':
      return { ok: true, protocolVersion: 4, chainId: CHAIN_ID };

    case 'configureBackgroundAlerts': {
      const params = object(request.params, 'params');
      const walletAddress = address(params.walletAddress, 'walletAddress');
      const state = await migrateLegacyState();
      const walletChanged = Boolean(
        state.walletAddress && state.walletAddress !== walletAddress,
      );
      await writeState({
        ...state,
        walletAddress,
        backgroundEnabled: true,
        messages: walletChanged ? [] : activeMessages(state.messages),
        lastError: null,
        lastDeliveryError: walletChanged ? null : state.lastDeliveryError,
        updatedAt: new Date().toISOString(),
      });
      const result = await pollCommunications(true);
      return { ...result, walletAddress, walletChanged, backgroundEnabled: true };
    }

    case 'checkNow':
      return pollCommunications(true);

    case 'disableBackgroundAlerts': {
      const state = await readUnencryptedState();
      await writeState({
        ...state,
        backgroundEnabled: false,
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true, backgroundEnabled: false };
    }

    case 'getInbox':
      return readUnencryptedState();

    case 'markAsRead': {
      const params = object(request.params, 'params');
      const messageId = uuid(params.messageId, 'messageId');
      const state = await readUnencryptedState();
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
      const state = await readUnencryptedState();
      await writeState({
        ...state,
        messages: [],
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    default:
      throw new Error(`Method not found: ${request.method}`);
  }
};

function displayTime(value: string | null): string {
  if (!value) return 'Not yet';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown';
  return `${new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function shortWallet(value: string | null): string {
  if (!value) return 'Not configured';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export const onHomePage: OnHomePageHandler = async () => {
  const state = await readUnencryptedState().catch(() => EMPTY_STATE);
  const messages = activeMessages(state.messages);
  const unread = messages.filter((message) => !message.read).length;
  const latest = messages[0] ?? null;

  // Keep this tree deliberately simple. MetaMask validates every Snap JSX child;
  // a nested array produced by Array.map caused the previous home-page assertion.
  return {
    content: (
      <Box>
        <Heading>PV Investor Communications</Heading>
        <Text>{`Background alerts: ${state.backgroundEnabled ? 'Enabled' : 'Disabled'}`}</Text>
        <Text>{`Wallet: ${shortWallet(state.walletAddress)}`}</Text>
        <Text>{`Last checked: ${displayTime(state.lastCheckedAt)}`}</Text>
        <Text>{`Stored notices: ${messages.length}; unread: ${unread}`}</Text>
        <Text>{state.lastError
          ? `Last background check failed: ${state.lastError}`
          : 'Last background check: No polling error recorded'}</Text>
        <Text>{state.lastDeliveryError
          ? `Last alert issue: ${state.lastDeliveryError}`
          : 'Last alert delivery: No Snap error recorded'}</Text>
        {latest ? (
          <Box>
            <Heading>Latest communication</Heading>
            <Text>{latest.title}</Text>
            <Text>{contextTitle(latest)}</Text>
            <Text>{latest.body.slice(0, 500)}</Text>
            <Text>{`Published: ${displayTime(latest.publishedAt)}`}</Text>
            <Link href={latest.actionUrl}>
              {latest.scope === 'TOKEN' ? 'Open Notifications' : 'Open voting event'}
            </Link>
          </Box>
        ) : (
          <Text>{state.backgroundEnabled
            ? 'New verified notices are checked automatically every minute.'
            : 'Open the dApp and enable background alerts.'}</Text>
        )}
        <Text>{messages.length > 1
          ? `${messages.length - 1} additional communication(s) are stored in the MetaMask inbox.`
          : 'The full notification history is also available in the dApp.'}</Text>
      </Box>
    ),
  };
};
