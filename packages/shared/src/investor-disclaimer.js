export const INVESTOR_DISCLAIMER_VERSION = '2026-09-08-v1';
export const INVESTOR_DISCLAIMER = [
  'Welcome to the Broadridge ProxyVote tokenized-investment prototype.',
  'This is an experimental application on Polygon Amoy testnet. It is not a production proxy-voting service, an investment recommendation, or a guarantee of shareholder rights.',
  'By signing, I confirm that I control this wallet, have read this disclaimer, and agree to enter the prototype and review the voting opportunities associated with this wallet.',
  'This sign-in does not cast a vote, approve token spending, or transfer assets. A separate final-ballot signature is required to vote.',
  'I understand that confirmed votes are final in this prototype and that my wallet address and voting selections will be publicly visible on the blockchain.',
  'I will never provide my private key or seed phrase to this site.',
].join('\n\n');

export function investorSignInMessage({ origin, walletAddress, chainId, nonce, issuedAt, expiresAt }) {
  const uri = new URL(origin);
  if (!['https:', 'http:'].includes(uri.protocol) || uri.origin !== origin) {
    throw new Error('A canonical application origin is required.');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress) || !/^[0-9a-f]{48}$/.test(nonce)) {
    throw new Error('Invalid wallet sign-in challenge.');
  }
  return [
    `${uri.host} requests your signature to sign in to ProxyVote.`,
    `Wallet: ${walletAddress}`, '', INVESTOR_DISCLAIMER, '',
    `URI: ${uri.origin}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
    `Expires At: ${new Date(expiresAt).toISOString()}`,
    `Disclaimer Version: ${INVESTOR_DISCLAIMER_VERSION}`,
  ].join('\n');
}
