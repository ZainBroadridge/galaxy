const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function assertAddress(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${field} must be a normalized EVM address.`);
  }
}

function addBalance(ledger, address, delta) {
  ledger.balances.set(address, (ledger.balances.get(address) ?? 0n) + delta);
}

export function createLedger() {
  return {
    balances: new Map(),
    supply: 0n,
  };
}

export function cloneLedger(ledger) {
  return {
    balances: new Map(ledger.balances),
    supply: ledger.supply,
  };
}

export function applyLedgerTransfer(ledger, { from, to, value }) {
  assertAddress(from, 'from');
  assertAddress(to, 'to');

  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError('Transfer value must be a non-negative bigint.');
  }
  if (value === 0n) return;

  if (from === ZERO_ADDRESS) ledger.supply += value;
  else addBalance(ledger, from, -value);

  if (to === ZERO_ADDRESS) ledger.supply -= value;
  else addBalance(ledger, to, value);
}

export function assertLedgerConsistent(ledger) {
  if (ledger.supply < 0n) {
    throw new Error('Derived token supply is negative.');
  }

  let balanceSum = 0n;
  for (const [address, balance] of ledger.balances) {
    if (balance < 0n) {
      throw new Error(`Derived balance is negative for ${address}.`);
    }
    if (balance > 0n) balanceSum += balance;
  }

  if (balanceSum !== ledger.supply) {
    throw new Error(
      `Derived balance sum (${balanceSum}) does not equal derived supply (${ledger.supply}).`,
    );
  }

  return balanceSum;
}

export function ledgerBalances(ledger, { positiveOnly = false } = {}) {
  return [...ledger.balances.entries()]
    .filter(([, balance]) => !positiveOnly || balance > 0n)
    .sort(([left], [right]) => left.localeCompare(right));
}
