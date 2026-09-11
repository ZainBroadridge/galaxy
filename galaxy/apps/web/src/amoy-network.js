const env = import.meta.env ?? {};

export const AMOY_CHAIN_ID = '0x13882';
export const AMOY_CHAIN_ID_DECIMAL = 80002;

const AMOY_CHAIN = Object.freeze({
  chainId: AMOY_CHAIN_ID,
  chainName: 'Polygon Amoy',
  nativeCurrency: Object.freeze({ name: 'POL', symbol: 'POL', decimals: 18 }),
  rpcUrls: Object.freeze([
    env.VITE_PUBLIC_RPC_URL || 'https://rpc-amoy.polygon.technology',
  ]),
  blockExplorerUrls: Object.freeze([
    env.VITE_BLOCK_EXPLORER_URL || 'https://amoy.polygonscan.com',
  ]),
});

function errorCodes(error) {
  return [
    error?.code,
    error?.data?.code,
    error?.data?.originalError?.code,
    error?.cause?.code,
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => Number(value))
    .filter(Number.isFinite);
}

function errorMessage(error) {
  return String(
    error?.data?.originalError?.message
      ?? error?.data?.message
      ?? error?.shortMessage
      ?? error?.message
      ?? error
      ?? '',
  ).toLowerCase();
}

export function injectedEvmProvider() {
  if (typeof window === 'undefined') return null;
  const ethereum = window.ethereum;
  if (!ethereum) return null;

  const providers = Array.isArray(ethereum.providers)
    ? ethereum.providers
    : [ethereum];

  return providers.find((provider) => provider?.isMetaMask && !provider?.isBraveWallet)
    ?? providers.find((provider) => provider?.isMetaMask)
    ?? ethereum;
}

export function isWalletRequestRejected(error) {
  return errorCodes(error).includes(4001)
    || errorMessage(error).includes('user rejected')
    || errorMessage(error).includes('user denied');
}

export function isWalletRequestPending(error) {
  return errorCodes(error).includes(-32002)
    || errorMessage(error).includes('request already pending')
    || errorMessage(error).includes('already processing');
}

function isUnknownChain(error) {
  const message = errorMessage(error);
  return errorCodes(error).includes(4902)
    || message.includes('unrecognized chain')
    || message.includes('unknown chain')
    || message.includes('chain has not been added')
    || message.includes('network has not been added');
}

function isDuplicateChain(error) {
  const message = errorMessage(error);
  return message.includes('already added')
    || message.includes('already exists')
    || message.includes('duplicate chain')
    || message.includes('duplicate network')
    || (message.includes('chain id') && message.includes('already'));
}

export function canDeferNetworkSetupUntilConnected(error) {
  const codes = errorCodes(error);
  const message = errorMessage(error);
  return codes.includes(4100)
    || codes.includes(4200)
    || codes.includes(-32601)
    || message.includes('unauthorized')
    || message.includes('not connected')
    || message.includes('connect first')
    || message.includes('request accounts first')
    || message.includes('method not supported');
}

export function friendlyAmoyError(error) {
  const next = new Error('Unable to add or switch to Polygon Amoy.');
  const originalCode = errorCodes(error)[0];

  if (isWalletRequestRejected(error)) {
    next.message = 'Polygon Amoy setup was declined in the wallet. Approve the network request, then try again.';
    next.code = 'WALLET_REQUEST_REJECTED';
  } else if (isWalletRequestPending(error)) {
    next.message = 'A wallet request is already open. Complete it in MetaMask, then try again.';
    next.code = 'WALLET_REQUEST_PENDING';
  } else {
    const detail = String(error?.shortMessage ?? error?.message ?? '').trim();
    next.message = detail
      ? `Unable to add or switch to Polygon Amoy: ${detail}`
      : 'Unable to add or switch to Polygon Amoy.';
    next.code = 'AMOY_SETUP_FAILED';
  }

  if (originalCode !== undefined) next.walletCode = originalCode;
  next.cause = error;
  return next;
}

export function walletProviderUnavailableError() {
  const error = new Error('Connect an EVM wallet to add or switch to Polygon Amoy.');
  error.code = 'WALLET_PROVIDER_UNAVAILABLE';
  return error;
}

function normalizeChainId(value) {
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return String(value).toLowerCase();
  }
}

async function currentChainId(provider) {
  const value = await provider.request({ method: 'eth_chainId' });
  return normalizeChainId(value);
}

async function switchToAmoy(provider) {
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: AMOY_CHAIN_ID }],
  });
}

async function addAmoy(provider) {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: AMOY_CHAIN.chainId,
      chainName: AMOY_CHAIN.chainName,
      nativeCurrency: { ...AMOY_CHAIN.nativeCurrency },
      rpcUrls: [...AMOY_CHAIN.rpcUrls],
      blockExplorerUrls: [...AMOY_CHAIN.blockExplorerUrls],
    }],
  });
}

export async function ensureAmoyNetwork(provider) {
  if (!provider?.request) throw walletProviderUnavailableError();

  if (await currentChainId(provider) === AMOY_CHAIN_ID) {
    return { chainId: AMOY_CHAIN_ID_DECIMAL, added: false, switched: false };
  }

  try {
    await switchToAmoy(provider);
    return { chainId: AMOY_CHAIN_ID_DECIMAL, added: false, switched: true };
  } catch (switchError) {
    if (isWalletRequestRejected(switchError) || isWalletRequestPending(switchError)) {
      throw switchError;
    }
    if (!isUnknownChain(switchError)) throw switchError;
  }

  let added = false;
  try {
    await addAmoy(provider);
    added = true;
  } catch (addError) {
    if (isWalletRequestRejected(addError) || isWalletRequestPending(addError)) {
      throw addError;
    }
    if (!isDuplicateChain(addError)) throw addError;
  }

  // Adding a chain does not guarantee that the wallet selected it. A second
  // switch also repairs wallets that reported "already added" for an Amoy
  // entry saved under another display name.
  if (await currentChainId(provider).catch(() => null) !== AMOY_CHAIN_ID) {
    await switchToAmoy(provider);
  }

  return { chainId: AMOY_CHAIN_ID_DECIMAL, added, switched: true };
}
