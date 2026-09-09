import { Contract } from 'ethers';
import { STANDARD_ERC20_ABI } from '@pv/shared';
import { query } from './db.js';
import { HttpError, normalizeAddress } from './errors.js';
import { provider } from './rpc.js';
import { serializeEvent } from './serializers.js';

export async function investorMeetings(walletInput) {
  const wallet = normalizeAddress(walletInput);
  const result = await query(
    `SELECT e.*,se.raw_balance,se.voting_power,v.status AS vote_status,v.created_at AS vote_created_at,
            v.transaction_hash,
            (e.discovery_mode='PUBLIC_ELIGIBLE' OR
              (e.discovery_mode='SUBSCRIBERS_ONLY' AND EXISTS (
                SELECT 1 FROM snap_subscriptions s WHERE s.wallet_address=$1
                  AND s.token_address=e.token_address AND s.enabled=true))) AS discoverable
       FROM snapshot_entries se
       JOIN events e ON e.id=se.event_id
       LEFT JOIN votes v ON v.event_id=e.id AND v.voter_address=$1
      WHERE se.wallet_address=$1 AND e.deployment_block IS NOT NULL AND e.status<>'FAILED'
      ORDER BY e.voting_end_at,e.id`, [wallet],
  );
  return result.rows.map((row) => serializeEvent(row, {
    discoverable: row.discoverable,
    eligibility: { eligible: true, snapshotBalance: String(row.raw_balance), votingPower: String(row.voting_power),
      hasVoted: Boolean(row.vote_status && row.vote_status !== 'FAILED') },
    voteStatus: row.vote_status,
    voteCreatedAt: row.vote_created_at,
    voteTransactionHash: row.transaction_hash,
  }));
}

/** One live balance for the signed-in viewer; never part of snapshot reconstruction. */
export async function currentInvestorHolding(eventId, walletInput) {
  const wallet = normalizeAddress(walletInput);
  const found = await query(
    `SELECT e.token_address,e.token_decimals,e.token_symbol FROM events e
       JOIN snapshot_entries se ON se.event_id=e.id AND se.wallet_address=$2 WHERE e.id=$1`, [eventId, wallet],
  );
  if (!found.rowCount) throw new HttpError(403, 'This wallet is not eligible for this event.', 'NOT_ELIGIBLE');
  const row = found.rows[0];
  const block = await provider.getBlockNumber();
  const rawBalance = await new Contract(row.token_address, STANDARD_ERC20_ABI, provider).balanceOf(wallet, { blockTag: block });
  return { rawBalance: rawBalance.toString(), tokenDecimals: Number(row.token_decimals), tokenSymbol: row.token_symbol,
    blockNumber: block, fetchedAt: new Date().toISOString() };
}
