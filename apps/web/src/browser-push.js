import { api } from './api.js';

const publicKey = String(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '').trim();
const bindingKey = 'pv-v2-browser-push-binding';

function supported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
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

async function registration() {
  await navigator.serviceWorker.register('/pv-push-sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
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
  const currentRegistration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await currentRegistration?.pushManager.getSubscription() ?? null;
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
  const currentRegistration = await navigator.serviceWorker.getRegistration('/');
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
