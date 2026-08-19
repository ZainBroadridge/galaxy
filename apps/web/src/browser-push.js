import { api } from './api.js';

const publicKey = String(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '').trim();
const bindingKey = 'pv-v2-browser-push-binding';
const issueKey = 'pv-v2-browser-push-issue';
const serviceWorkerPath = '/pv-push-sw.js?v=click-routing-4';
const serviceWorkerScope = '/';
const openNotificationMessage = 'PV_PUSH_OPEN_NOTIFICATION';
const bootstrapParameter = 'pvPushMessageId';
const messageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function supported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function notificationPath(messageId) {
  return `/notifications?messageId=${encodeURIComponent(messageId)}`;
}

function normalizedMessageId(value) {
  const result = String(value ?? '').toLowerCase();
  return messageIdPattern.test(result) ? result : null;
}

export function browserPushNotificationPath(messageId) {
  const normalized = normalizedMessageId(messageId);
  return normalized ? notificationPath(normalized) : '/notifications';
}

export function consumeBrowserPushBootstrap() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return normalizedMessageId(params.get(bootstrapParameter));
}

export function listenForBrowserPushOpen(handler) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const listener = (event) => {
    if (event.data?.type !== openNotificationMessage) return;
    const messageId = normalizedMessageId(event.data?.messageId);
    if (messageId) handler(messageId);
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

function readBinding() {
  try {
    const value = JSON.parse(localStorage.getItem(bindingKey) || 'null');
    if (!value?.endpoint || !value?.walletAddress) return null;
    return {
      endpoint: String(value.endpoint),
      walletAddress: String(value.walletAddress).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function saveBinding(value) {
  if (value) localStorage.setItem(bindingKey, JSON.stringify(value));
  else localStorage.removeItem(bindingKey);
}

function readIssue() {
  try {
    const value = JSON.parse(sessionStorage.getItem(issueKey) || 'null');
    if (!value?.message) return null;
    return {
      code: String(value.code || 'BROWSER_PUSH_ERROR'),
      message: String(value.message),
    };
  } catch {
    return null;
  }
}

function saveIssue(value) {
  try {
    if (!value) sessionStorage.removeItem(issueKey);
    else sessionStorage.setItem(issueKey, JSON.stringify(value));
  } catch {
    // Diagnostics are a convenience and must never block notifications.
  }
}

function errorText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message) return value.message;
  if (typeof value?.message === 'string' && value.message.trim()) return value.message.trim();
  if (typeof value?.error?.message === 'string') return value.error.message;
  if (typeof value?.data?.message === 'string') return value.data.message;
  try {
    const encoded = JSON.stringify(value);
    if (encoded && encoded !== '{}') return encoded;
  } catch {
    // Fall through to a stable generic message.
  }
  return 'Browser push failed without a readable error.';
}

function browserPushError(code, message, cause = undefined) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = 'BrowserPushError';
  error.code = code;
  return error;
}

async function isBraveBrowser() {
  try {
    return Boolean(navigator.brave && await navigator.brave.isBrave?.());
  } catch {
    return false;
  }
}

async function subscriptionError(value) {
  const detail = errorText(value);
  const fingerprint = `${value?.name ?? ''} ${detail}`.toLowerCase();

  if (fingerprint.includes('push service error') || value?.name === 'AbortError') {
    const brave = await isBraveBrowser();
    const message = brave
      ? 'Brave could not register with its push service. Enable "Use Google services for push messaging" in brave://settings/privacy. If that setting is locked or this still fails, the office proxy or firewall is blocking the managed browser push service; ask IT to allow it. The dApp cannot bypass an administrator policy.'
      : 'The browser could not register with its push service. On a managed office device, ask IT to allow the browser push service and exempt it from proxy or TLS inspection. The dApp cannot bypass an administrator policy.';
    return browserPushError('PUSH_SERVICE_UNAVAILABLE', message, value);
  }

  if (value?.name === 'InvalidAccessError' || fingerprint.includes('applicationserverkey')) {
    return browserPushError(
      'INVALID_VAPID_PUBLIC_KEY',
      'The Web Push public key configured in Vercel is invalid. Replace VITE_WEB_PUSH_PUBLIC_KEY with the public key from the same VAPID pair used by Render.',
      value,
    );
  }

  return browserPushError('PUSH_SUBSCRIPTION_FAILED', detail, value);
}

function applicationServerKey(value) {
  let bytes;
  try {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
    const decoded = atob(base64);
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch (error) {
    throw browserPushError(
      'INVALID_VAPID_PUBLIC_KEY',
      'VITE_WEB_PUSH_PUBLIC_KEY is not valid URL-safe Base64.',
      error,
    );
  }

  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw browserPushError(
      'INVALID_VAPID_PUBLIC_KEY',
      'VITE_WEB_PUSH_PUBLIC_KEY must be an uncompressed 65-byte P-256 public key.',
    );
  }
  return bytes;
}

function sameApplicationServerKey(subscription, expected) {
  const actual = subscription?.options?.applicationServerKey;
  if (!actual) return true;
  const bytes = new Uint8Array(actual);
  if (bytes.length !== expected.length) return false;
  return bytes.every((value, index) => value === expected[index]);
}

function waitForActivation(worker, timeoutMs = 5_000) {
  if (!worker || worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    const onStateChange = () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return;
      clearTimeout(timeout);
      worker.removeEventListener('statechange', onStateChange);
      resolve();
    };
    worker.addEventListener('statechange', onStateChange);
  });
}

async function registration() {
  const current = await navigator.serviceWorker.register(serviceWorkerPath, {
    scope: serviceWorkerScope,
    updateViaCache: 'none',
  });
  await current.update().catch(() => null);
  await waitForActivation(current.installing || current.waiting);
  return navigator.serviceWorker.ready;
}

function state(walletAddress, subscription = null, extra = {}) {
  const binding = readBinding();
  const normalizedWallet = walletAddress?.toLowerCase() ?? null;
  return {
    configured: Boolean(publicKey),
    supported: supported(),
    browser: typeof navigator !== 'undefined' && navigator.brave ? 'brave' : 'chromium',
    permission: supported() ? Notification.permission : 'unsupported',
    subscribed: Boolean(subscription),
    enabledForWallet: Boolean(
      subscription
      && binding?.endpoint === subscription.endpoint
      && binding.walletAddress === normalizedWallet,
    ),
    boundWalletAddress: binding?.walletAddress ?? null,
    issue: readIssue(),
    ...extra,
  };
}

export async function browserPushState(walletAddress) {
  if (!supported() || !publicKey) return state(walletAddress);
  try {
    const currentRegistration = await registration();
    const subscription = await currentRegistration.pushManager.getSubscription() ?? null;
    return state(walletAddress, subscription, { serviceWorkerReady: true });
  } catch (error) {
    return state(walletAddress, null, {
      serviceWorkerReady: false,
      issue: {
        code: error?.code || 'SERVICE_WORKER_ERROR',
        message: errorText(error),
      },
    });
  }
}

async function removeServerBinding(subscription, walletAddress) {
  if (!subscription?.endpoint || !walletAddress) return;
  await api('/v1/communications/push-subscription', {
    method: 'DELETE',
    auth: false,
    body: { walletAddress, endpoint: subscription.endpoint },
  }).catch(() => null);
}

export async function enableBrowserPush(walletAddress) {
  if (!walletAddress) throw new Error('Connect a wallet before enabling browser notifications.');
  if (!publicKey) throw new Error('Browser notifications are not configured for this deployment.');
  if (!supported()) throw new Error('This browser does not support Web Push notifications.');

  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== 'granted') {
    throw new Error('Browser notification permission was not granted.');
  }

  const key = applicationServerKey(publicKey);
  const currentRegistration = await registration();
  let subscription = await currentRegistration.pushManager.getSubscription();

  if (subscription && !sameApplicationServerKey(subscription, key)) {
    const binding = readBinding();
    await removeServerBinding(subscription, binding?.walletAddress);
    await subscription.unsubscribe().catch(() => null);
    saveBinding(null);
    subscription = null;
  }

  if (!subscription) {
    try {
      subscription = await currentRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    } catch (value) {
      const error = await subscriptionError(value);
      saveIssue({ code: error.code, message: error.message });
      throw error;
    }
  }

  const serialized = subscription.toJSON();
  if (!serialized.keys?.p256dh || !serialized.keys?.auth) {
    const error = browserPushError(
      'INCOMPLETE_PUSH_SUBSCRIPTION',
      'The browser returned an incomplete push subscription.',
    );
    saveIssue({ code: error.code, message: error.message });
    throw error;
  }

  await api('/v1/communications/push-subscription', {
    method: 'PUT',
    auth: false,
    body: {
      walletAddress,
      subscription: {
        endpoint: subscription.endpoint,
        keys: serialized.keys,
      },
    },
  });
  saveBinding({ endpoint: subscription.endpoint, walletAddress: walletAddress.toLowerCase() });
  saveIssue(null);
  return state(walletAddress, subscription, { serviceWorkerReady: true });
}

export async function showBrowserPushClickTest(messageId) {
  const normalized = normalizedMessageId(messageId);
  if (!normalized) throw new Error('A received communication is required to test click routing.');
  if (!supported()) throw new Error('This browser does not support service-worker notifications.');
  if (Notification.permission !== 'granted') {
    throw new Error('Allow browser notifications before testing click routing.');
  }
  const currentRegistration = await registration();
  await currentRegistration.showNotification('Mini Galaxy Proxy Voting', {
    body: 'Click to open the corresponding dApp notification.',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: `pv-click-test-${normalized}`,
    renotify: true,
    data: { messageId: normalized },
  });
  return { messageId: normalized };
}

export async function disableBrowserPush(walletAddress) {
  if (!supported()) return state(walletAddress);
  const currentRegistration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
  const subscription = await currentRegistration?.pushManager.getSubscription() ?? null;
  const binding = readBinding();
  const boundWallet = binding?.walletAddress ?? walletAddress?.toLowerCase();

  if (subscription && boundWallet) {
    await removeServerBinding(subscription, boundWallet);
    await subscription.unsubscribe();
  }
  saveBinding(null);
  saveIssue(null);
  return state(walletAddress);
}
