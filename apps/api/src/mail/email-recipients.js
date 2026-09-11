// Add approved wallet-to-email mappings here. Keep this module backend-only.
// An explicit wallet mapping takes precedence over the temporary demo recipient.
export const WALLET_EMAILS = Object.freeze({});

export function receiptRecipient(wallet, environment = process.env, mappings = WALLET_EMAILS) {
  const key = String(wallet ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(key)) throw new Error('Receipt recipient lookup requires a wallet address.');
  const selected = Object.hasOwn(mappings, key) ? mappings[key] : environment.VOTE_RECEIPT_EMAIL_TO;
  const address = String(selected ?? '').trim();
  if (!address) throw new Error('No receipt email is mapped to this wallet. Configure VOTE_RECEIPT_EMAIL_TO or WALLET_EMAILS.');
  if (address.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/u.test(address)
    || /[\r\n]/u.test(address)) throw new Error('The configured receipt recipient is not a single email address.');
  return address;
}
