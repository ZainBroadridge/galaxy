import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptRecipient } from '../src/mail/email-recipients.js';

// Fixtures are independent of the manually maintained WALLET_EMAILS entries.
const mixedWallet = `0x${'AbCd'.repeat(10)}`;
const lowerWallet = mixedWallet.toLowerCase();
const otherWallet = `0x${'1234'.repeat(10)}`;
const fallback = { VOTE_RECEIPT_EMAIL_TO: 'fallback@example.com' };

test('a pasted mixed-case mapping overrides the fallback for its lowercase voting wallet', () => {
  const mappings = Object.freeze({ [mixedWallet]: 'voter@example.com' });
  assert.equal(receiptRecipient(lowerWallet, fallback, mappings), 'voter@example.com');
  assert.deepEqual(Object.keys(mappings), [mixedWallet]);
});

test('a lowercase mapping accepts a mixed-case voter address', () => {
  assert.equal(receiptRecipient(mixedWallet, {}, { [lowerWallet]: 'voter@example.com' }), 'voter@example.com');
});

test('pasted surrounding whitespace in a wallet key or input does not lose the mapping', () => {
  assert.equal(receiptRecipient(`  ${mixedWallet}  `, {}, { [`  ${mixedWallet}  `]: 'voter@example.com' }), 'voter@example.com');
});

test('two differently cased entries for one wallet are rejected instead of choosing a recipient', () => {
  assert.throws(() => receiptRecipient(lowerWallet, fallback, {
    [lowerWallet]: 'first@example.com',
    [mixedWallet]: 'second@example.com',
  }), /Multiple receipt email mappings/);
});

test('an unmapped wallet uses the configured fallback recipient', () => {
  assert.equal(receiptRecipient(otherWallet, { VOTE_RECEIPT_EMAIL_TO: ' fallback@example.com ' }, {
    [mixedWallet]: 'voter@example.com',
  }), 'fallback@example.com');
});

test('an unmapped wallet without a fallback reports the missing recipient', () => {
  assert.throws(() => receiptRecipient(otherWallet, {}, { [mixedWallet]: 'voter@example.com' }), /No receipt email is mapped/);
});

test('an explicitly empty mapping never sends that wallet receipt to the fallback', () => {
  for (const recipient of ['', '  ', null, undefined]) {
    assert.throws(() => receiptRecipient(lowerWallet, fallback, { [mixedWallet]: recipient }), /No receipt email is mapped/);
  }
});

test('invalid mapped emails and header injection are rejected without using the fallback', () => {
  for (const recipient of ['invalid', 'one@example.com,two@example.com', 'one@example.com\r\nBcc: two@example.com']) {
    assert.throws(() => receiptRecipient(lowerWallet, fallback, { [mixedWallet]: recipient }), /not a single email address/);
  }
});

test('invalid wallet addresses are rejected even when a fallback exists', () => {
  for (const wallet of [undefined, '', '0x1234', `0x${'z'.repeat(40)}`]) {
    assert.throws(() => receiptRecipient(wallet, fallback, {}), /requires a wallet address/);
  }
});

test('inherited object properties cannot act as recipient mappings', () => {
  const mappings = Object.create({ [lowerWallet]: 'inherited@example.com' });
  assert.equal(receiptRecipient(lowerWallet, fallback, mappings), 'fallback@example.com');
});

test('distinct wallets receive their own mapped recipients', () => {
  const mappings = Object.freeze({ [mixedWallet]: 'first@example.com', [otherWallet]: 'second@example.com' });
  assert.equal(receiptRecipient(lowerWallet, fallback, mappings), 'first@example.com');
  assert.equal(receiptRecipient(otherWallet, fallback, mappings), 'second@example.com');
});
