# Troubleshooting

## Wallet Comms says “Failed to fetch”

Check in this order:

1. Open the Render `/health` endpoint directly. A free service may be asleep and need to wake.
2. Confirm Vercel `VITE_API_BASE_URL` is the new Render service, with no trailing route such as `/api`.
3. Confirm Render `CORS_ORIGINS` contains the exact Vercel origin, including `https://` and no path.
4. Confirm the old backend/indexer service is stopped.
5. Redeploy Render after changing environment variables.

The web client converts browser network/CORS failures into a message naming the configured API origin.

## API 429

The corrected application does not rate-limit GET/status/inbox reads globally and Wallet Comms has no timer.

A 429 should now mean one of:

- more than 12 authentication attempts for the same wallet in one minute;
- more than 40 authenticated writes for the same wallet in one minute;
- the five-event daily relayer-spam limit (`EVENT_LIMIT`);
- an upstream Alchemy 429 handled inside a durable snapshot job.

Use the response `error.code` to identify which case occurred. If constant 429 traffic remains, an old hosted tab or old Render indexer is still running.

## Snap will not install

- Use the desktop MetaMask Extension; a generic WalletConnect provider cannot install a Snap.
- Connect the same account in MetaMask and Reown before Sync.
- Local development requires `VITE_SNAP_ID=local:http://localhost:8080` and `npm run dev:snap`.
- A hosted Vercel dApp cannot install a `local:` Snap ID.
- Production requires a public npm package ID such as `npm:@scope/pv-communications-snap`.
- The Snap manifest `allowedOrigins` and `initialConnections` must exactly match the production Vercel origin.
- Package and manifest versions must match.
- Use **Update Snap** after publishing a new version.

Notification throttling is non-fatal: accepted messages remain in the Snap inbox even when MetaMask declines a popup.

## Snapshot fails immediately with an Alchemy 400

Confirm `RPC_HTTP_URL` is the Polygon Amoy Alchemy HTTPS endpoint, not a WebSocket URL and not an Ethereum endpoint.

The endpoint must support:

- `alchemy_getAssetTransfers`;
- historical `eth_getCode`;
- historical `eth_call` for `totalSupply()`.

The snapshot intentionally rejects nonstandard token history rather than silently producing a wrong root.

## Snapshot exceeds the history limit

Default maximum:

```text
ALCHEMY_PAGE_SIZE=1000
ALCHEMY_MAX_PAGES=100
```

That permits 100,000 indexed transfers. Increase `ALCHEMY_MAX_PAGES` only after checking that the token's history and number of eligible holders are suitable for a free web service and the selected voting timeline.

## Event is stuck after a Render restart

Stale running jobs are automatically reclaimable after `JOB_LOCK_MINUTES` (default eight minutes). Opening the event page wakes a sleeping free Render service. The status page then resumes polling one consolidated endpoint.

Do not manually delete job or relayer rows. Use **Retry safely** only after the UI reports a final failure.

## Contract deployed but source verification failed

Set a valid Etherscan V2 API key in Render:

```text
ETHERSCAN_API_KEY
VERIFY_CONTRACTS=true
```

The deployment transaction and contract address remain valid. Use **Retry safely** on the organiser event page after correcting the key. Verification does not redeploy the contract.

## Ballot reappears after voting

The corrected event view reads Neon first and falls back to `VoteEvent.hasVoted(wallet)` when the local vote row is absent or failed. If the old behavior remains, the browser is still using the previous Vercel build or old API hostname.
