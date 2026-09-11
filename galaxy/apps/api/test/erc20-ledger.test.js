import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLedgerTransfer,
  assertLedgerConsistent,
  cloneLedger,
  createLedger,
  ledgerBalances,
} from '../src/erc20-ledger.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const ALICE = '0x0000000000000000000000000000000000000001';
const BOB = '0x0000000000000000000000000000000000000002';

function transfer(ledger, from, to, value) {
  applyLedgerTransfer(ledger, { from, to, value: BigInt(value) });
}

test('replays mint, transfer, and burn events exactly', () => {
  const ledger = createLedger();

  transfer(ledger, ZERO, ALICE, 1_000);
  transfer(ledger, ALICE, BOB, 300);
  transfer(ledger, BOB, ZERO, 50);

  assert.equal(assertLedgerConsistent(ledger), 950n);
  assert.deepEqual(ledgerBalances(ledger), [
    [ALICE, 700n],
    [BOB, 250n],
  ]);
});

test('preserves an immutable record-date ledger while replay continues', () => {
  const current = createLedger();
  transfer(current, ZERO, ALICE, 100);

  const recordDate = cloneLedger(current);
  transfer(current, ALICE, BOB, 40);

  assert.deepEqual(ledgerBalances(recordDate), [[ALICE, 100n]]);
  assert.deepEqual(ledgerBalances(current), [
    [ALICE, 60n],
    [BOB, 40n],
  ]);
});

test('rejects incomplete transfer history that produces a negative balance', () => {
  const ledger = createLedger();
  transfer(ledger, ALICE, BOB, 10);

  assert.throws(
    () => assertLedgerConsistent(ledger),
    /negative for 0x0000000000000000000000000000000000000001/u,
  );
});

test('keeps zero-balance discovered addresses for current-state reconciliation', () => {
  const ledger = createLedger();
  transfer(ledger, ZERO, ALICE, 25);
  transfer(ledger, ALICE, BOB, 25);

  assert.equal(assertLedgerConsistent(ledger), 25n);
  assert.deepEqual(ledgerBalances(ledger), [
    [ALICE, 0n],
    [BOB, 25n],
  ]);
  assert.deepEqual(ledgerBalances(ledger, { positiveOnly: true }), [[BOB, 25n]]);
});
