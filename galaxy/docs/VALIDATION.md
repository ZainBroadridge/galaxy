# Delivery validation

## Completed in the delivery environment

```text
JavaScript syntax/transpile check
Relative-import resolution
Project structure validation
Architecture audit
Exactly one Solidity source
No apps/indexer directory
No API eth_getLogs scan
One Render web service and no Render worker
Reown AppKit dependencies present
Snap package/manifest metadata aligned
Generated VoteEvent source-verification input matches VoteEvent.sol
Generated deployment artifact contains ABI and bytecode
ZIP integrity and source-manifest verification (performed at packaging)
```

## Generated contract artifacts

The uploaded project already contained a Hardhat build of the unchanged `VoteEvent.sol`. The delivery includes:

```text
packages/contracts/generated/VoteEvent.json
packages/contracts/generated/VoteEvent.verification.json
```

The verification input was regenerated from the matching Hardhat build-info and is checked against the current Solidity source by `npm run check:structure`.

## Dependency-backed checks

This execution environment could not resolve the npm registry (`EAI_AGAIN`), so a fresh dependency installation and the following commands could not be rerun here:

```text
hardhat compile/test
shared tests
Vite production build
MetaMask Snap production build
local Neon/Alchemy/Amoy end-to-end test
```

Run `npm install` followed by `npm run check` on your machine and in GitHub Actions before production cutover. The dependency versions are pinned exactly; the first successful install creates a new `package-lock.json`, which should be committed.
