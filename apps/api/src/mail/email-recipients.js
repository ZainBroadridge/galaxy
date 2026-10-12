// Add approved wallet-to-email mappings here. Keep this module backend-only.
// An explicit wallet mapping takes precedence over the temporary demo recipient.
// Wallet keys may use lowercase or mixed case. Keep one entry per wallet.
export const WALLET_EMAILS = Object.freeze({
  '0xca430770ACA59D44BbC4ae0abacBA52cb8E39867': 'zainnq18@gmail.com',
  '0xf7D7b4Ca09362746Bf058e4A4BBd9C066Ebeefb6': 'sudhanvahariharan@gmail.com',
  '0x5AabCdb7cA2195906Ca86B78097ADb28c5C0c8Cf' : 'Aman.mundra@605studios.xyz',
  '0x8e5860DbA228DB1d0335B4B3F0fC2883Ea1c232C': 'souravsarkar312@gmail.com'
});

export function receiptRecipient(wallet, environment = process.env, mappings = WALLET_EMAILS) {
  const key = String(wallet ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(key)) throw new Error('Receipt recipient lookup requires a wallet address.');
  // Normalise both sides so pasted wallet addresses match stored voter addresses.
  const matches = Object.keys(mappings).filter((mappedWallet) => mappedWallet.trim().toLowerCase() === key);
  if (matches.length > 1) {
    throw new Error('Multiple receipt email mappings exist for this wallet. Keep one entry per wallet.');
  }
  const selected = matches.length === 1 ? mappings[matches[0]] : environment.VOTE_RECEIPT_EMAIL_TO;
  const address = String(selected ?? '').trim();
  if (!address) throw new Error('No receipt email is mapped to this wallet. Configure VOTE_RECEIPT_EMAIL_TO or WALLET_EMAILS.');
  if (address.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/u.test(address)
    || /[\r\n]/u.test(address)) throw new Error('The configured receipt recipient is not a single email address.');
  return address;
}
