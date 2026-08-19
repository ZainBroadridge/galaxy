import { api } from './api.js';

const publicKey = String(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '').trim();
const bindingKey = 'pv-v2-browser-push-binding';
const serviceWorkerPath = '/pv-push-sw.js?v=click-routing-2';
const serviceWorkerScope = '/';
const openNotificationMessage = 'PV_PUSH_OPEN_NOTIFICATION';
const messageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const navigationListenerMarker = Symbol.for('pv.browserPushNavigationListener');

function supported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function notificationPath(messageId) {
  return `/notifications?messageId=${encodeURIComponent(messageId)}`;
}

function handleServiceWorkerMessage(event) {
  const type = event.data?.type;
  const messageId = String(event.data?.messageId ?? '').toLowerCase();
  if (type !== openNotificationMessage || !messageIdPattern.test(messageId)) return;

  const target = notificationPath(messageId);
  const current = `${window.location.pathname}${window.location.search}`;
  const priorState = window.history.state && typeof window.history.state === 'object'
    ? window.history.state
    : {};
  const nextState = { ...priorState, pvPushMessageId: messageId };

  if (current === target) window.history.replaceState(nextState, '', target);
  else window.history.pushState(nextState, '', target);

  // BrowserRouter listens for popstate. This performs a local SPA transition,
  // so an already-open dApp does not need a full page request through a proxy.
  window.dispatchEvent(new PopStateEvent('popstate', { state: nextState }));
}

if (supported() && !window[navigationListenerMarker]) {
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
  window[navigationListenerMarker] = true;
}

// Users who already enabled browser alerts should receive click-handler fixes
// on any dApp load, without registering a service worker for users who never
// opted in.
if (supported()) {
  navigator.serviceWorker.getRegistration(serviceWorkerScope)
    .then((existing) => existing ? registration() : null)
    .catch(() => null);
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

function applicationServerKey(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function waitForActivation(worker, timeoutMs = 4_000) {
  if (!worker || worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve) => {
    let timeout;
    const finish = () => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') finish();
    };
    timeout = setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', onStateChange);
  });
}

async function registration() {
  const current = await navigator.serviceWorker.register(serviceWorkerPath, {
    scope: serviceWorkerScope,
    updateViaCache: 'none',
  });

  // Force an update check whenever the Notifications page evaluates push state.
  // This avoids an old click handler being retained by a browser or proxy cache.
  await current.update().catch(() => null);
  await waitForActivation(current.installing || current.waiting);
  return current;
}

function state(walletAddress, subscription = null) {
  const binding = readBinding();
  const normalizedWallet = walletAddress?.toLowerCase() ?? null;
  return {
    configured: Boolean(publicKey),
    supported: supported(),
    permission: supported() ? Notification.permission : 'unsupported',
    subscribed: Boolean(subscription),
    enabledForWallet: Boolean(
      subscription
      && binding?.endpoint === subscription.endpoint
      && binding.walletAddress === normalizedWallet,
    ),
    boundWalletAddress: binding?.walletAddress ?? null,
  };
}

export async function browserPushState(walletAddress) {
  if (!supported() || !publicKey) return state(walletAddress);
  const currentRegistration = await registration();
  const subscription = await currentRegistration.pushManager.getSubscription() ?? null;
  return state(walletAddress, subscription);
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

  const currentRegistration = await registration();
  let subscription = await currentRegistration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await currentRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  }

  const serialized = subscription.toJSON();
  if (!serialized.keys?.p256dh || !serialized.keys?.auth) {
    throw new Error('The browser returned an incomplete push subscription.');
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
  return state(walletAddress, subscription);
}

export async function disableBrowserPush(walletAddress) {
  if (!supported()) return state(walletAddress);
  const currentRegistration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
  const subscription = await currentRegistration?.pushManager.getSubscription() ?? null;
  const binding = readBinding();
  const boundWallet = binding?.walletAddress ?? walletAddress?.toLowerCase();

  if (subscription && boundWallet) {
    await api('/v1/communications/push-subscription', {
      method: 'DELETE',
      auth: false,
      body: { walletAddress: boundWallet, endpoint: subscription.endpoint },
    }).catch(() => null);
    await subscription.unsubscribe();
  }
  saveBinding(null);
  return state(walletAddress);
}
