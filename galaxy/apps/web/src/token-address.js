const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

export const TOKEN_INSPECTION_DEBOUNCE_MS = 550;

export function normalizeTokenAddress(value) {
  return String(value ?? '').trim();
}

export function validateTokenAddressInput(value) {
  const raw = String(value ?? '');
  const tokenAddress = normalizeTokenAddress(raw);

  if (!tokenAddress) {
    return {
      valid: false,
      tokenAddress,
      normalizedWhitespace: false,
      message: 'Enter an ERC-20 token address.',
    };
  }

  if (/\s/u.test(tokenAddress)) {
    return {
      valid: false,
      tokenAddress,
      normalizedWhitespace: false,
      message: 'Remove spaces from the token address. An EVM address cannot contain internal whitespace.',
    };
  }

  if (!tokenAddress.startsWith('0x')) {
    return {
      valid: false,
      tokenAddress,
      normalizedWhitespace: false,
      message: 'Token address must start with 0x.',
    };
  }

  if (tokenAddress.length !== 42) {
    return {
      valid: false,
      tokenAddress,
      normalizedWhitespace: false,
      message: 'Token address must contain 42 characters: 0x followed by 40 hexadecimal characters.',
    };
  }

  if (!EVM_ADDRESS_PATTERN.test(tokenAddress)) {
    return {
      valid: false,
      tokenAddress,
      normalizedWhitespace: false,
      message: 'Token address can contain only hexadecimal characters (0-9 and A-F) after 0x.',
    };
  }

  return {
    valid: true,
    tokenAddress,
    normalizedWhitespace: tokenAddress !== raw,
    message: null,
  };
}
