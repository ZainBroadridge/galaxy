# Galaxy verification and interface enhancements

## Apply this package to the current Galaxy application

This ZIP bundles the 33 complete replacement/additional source, asset and test
files supplied in the preceding update. Their bytes have not been changed while
packaging. Two delivery documents are added: this guide and an exact Git staging
manifest. It is a replacement overlay, not a fresh repository or B20_CB fork.

Required baseline: the Galaxy source archive at
`eb6dad8396c65fc5fcafff193d7a8a90aec597b3`, with the investor/issuer redesign and
issuer-branding correction already applied. Existing migrations 006 and 007,
version-aware ballot support, and installed issuer artwork must remain in place.
Do not apply this overlay to an older, pre-redesign Galaxy checkout.

The ZIP starts with apps/ and docs/. Copy their contents into the existing
repository root and replace matching files. Do not remove the existing project.
Preserve .env files, node_modules, generated contract artifacts, fonts, issuer
logos, and all files not included in this ZIP. Save a separate copy of any local
uncommitted work before replacing full files.

## Scope

### Verification

- Snapshot/deployment readiness is separate from explorer source publication.
- A mined, validated deployment with a completed snapshot displays 100% creation
  progress even while its separate verification job is pending or failed.
- The verifier checks published source and a valid ABI for the contract address
  before trusting a saved, possibly stale verification request identifier.
- Ordinary pending responses defer the existing durable job without consuming
  failure attempts. No new scheduler, queue or dependency is introduced.
- Actual verification failures remain visible separately.
- Failed source-verification work can be retried via Recheck source verification
  without reconstructing the snapshot or redeploying the contract.
- The existence of an explorer URL alone is NOT treated as proof of deployment.

### Investor pages

- Consistent Broadridge web palette, regardless of issuer PDF colors.
- Conditional platform/issuer logo placement, bounded titles, aligned tags and
  document layouts, smaller board-vote control and restored broadcast spinner.
- Meeting search controls removed; page width, type scale and spacing adjusted.
- Confirmation links are blue and document links are red.
- Corrected shared brand lockup and cache-distinct favicon filenames.
- Reown and the existing verified disclaimer-signature flow are retained. The
  reference wallet picker used demo authentication; its mock flow is not copied.

### Issuer pages

- Combined brand lockup and decorative particle background on the password gate.
- Centered navigation and a red icon-style issuer exit control.
- Field-width, keyboard-accessible fuzzy issuer autocomplete.
- Disney removed from creation suggestions, not from historical event branding.
- Autofill placed in the Event details heading; required fields marked.
- The completed snapshot-start notice no longer remains displayed.

### Unchanged by this update

No snapshot reconstruction, relayer, deployment transaction, PDF writer, receipt
PDF theme, smart contract, signature protocol, notification recipient policy,
package manifest, lockfile, environment variable, migration or hosting-config
change is included. Do not re-run the artwork/font download scripts for this
update; existing installed assets are retained. The existing Dinari text fallback
remains unless approved Dinari artwork is separately provided.

## Validation status

For this packaging pass:

- All 33 replacement files matched the individual files from the previous update.
- The 20 focused explorer/workflow/interface tests passed on the supplied source
  archive plus the corrected redesign and this overlay.
- Relative imports resolved in 144 source files in that assembled check tree.
- The ZIP passed integrity checks and an extraction/hash comparison.

This is NOT a claim that a production Vite build, the complete API test suite,
real MetaMask signing, a live database migration, the production explorer, or a
browser-based pixel comparison passed here. Those full integration checks remain
outstanding. The package is supplied for application and local verification as
requested, without delaying delivery over the testing-environment limitations.

## CMD instructions after replacing files

Use VS Code's Command Prompt terminal, not PowerShell. Use the original Galaxy
repository, not B20_CB. Do not reset or force-push an existing branch.

### 1. Inspect the working tree

```bat
cd /d C:\Users\QureshiM\Desktop\mini-galaxy-pv-v2.1
git branch --show-current
git status --short
```

Use a dedicated review branch based on the current checkout:

```bat
git switch -c pv-verification-ui-enhancements-20260909
```

If that branch already exists and is already selected, stay on it; do not run
reset. Unrelated uncommitted edits should be reviewed and kept out of this commit.

### 2. Local checks

```bat
node --test apps\api\test\explorer-verification.test.js apps\api\test\verification-workflow.test.js apps\api\test\interface-enhancements.test.js
npm run check:syntax
npm run check:imports
npm run build:web
```

The focused test command should report 20 passed and 0 failed. Run the full suite
when available:

```bat
npm run test --workspace ./apps/api
```

No new dependency installation is required by this overlay. A missing-package
error indicates an existing local installation problem; do not delete the lock
file or change dependencies to hide it. Use your approved npm/JFrog configuration
for any repair. Do not treat a failed local build as a successful deployment.

No db:migrate, Solidity compile, Snap publication, or asset sync is required for
this incremental update over the already-deployed redesign.

### 3. Review and stage only this package

```bat
git diff --stat
git add --pathspec-from-file=docs/VERIFICATION_INTERFACE_FILES.txt
git diff --cached --name-only
git diff --cached --stat
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
```

The manifest includes the 33 implementation/test/asset files plus the two delivery
documents. New files already applied in the previous turn can show no diff.
Do not use git add . to mix unrelated work into this update. Previously staged
unrelated changes remain staged; inspect the cached names before committing.

The whitespace check accepts the existing CRLF convention but still checks
trailing spaces. LF/CRLF conversion warnings alone do not mean a build failed.

### 4. Commit and push the review branch

```bat
git commit -m "Separate explorer verification and refine investor issuer interfaces" && git push -u origin pv-verification-ui-enhancements-20260909
```

Use the repository's existing origin and approved network configuration. This
command does not change a remote, remove proxy settings, or force-push history.

### 5. Promote to main when ready

If the local checks succeed and the review commit is ready for deployment:

```bat
git switch main && git pull --ff-only origin main && git merge --ff-only pv-verification-ui-enhancements-20260909 && git push origin main
git status
```

If the fast-forward merge is refused, keep both branches and review intervening
changes; do not use reset --hard or a force push. A PR merge through the normal
repository workflow is also suitable.

## Deployment and the existing stuck event

Both services must receive this commit:

- Render: verifier, deferred-job handling and event/build-status separation.
- Vercel: organiser progress view and all investor/issuer interface changes.

A Git push triggers deployment only when the services are configured to deploy
that branch. Otherwise deploy the same commit manually in each service. Preserve
the existing environment values, database, API origin, CORS configuration and
relayer wallet. No existing contract needs redeployment for this update.

After both services show the new commit:

1. Refresh the organiser event page. A completed, validated deployment should
   show 100% creation progress; source verification has a separate status.
2. Pending verification jobs run again when due and the backend is awake.
3. A previously FAILED verification job needs one click on Recheck source
   verification. It checks the existing address and does not create another
   snapshot or contract.
4. Do not delete snapshot entries, clear transaction hashes, or mark an event
   VERIFIED manually just because its explorer links exist.
5. Check the investor meeting tabs, ballot, single/multiple-document layout,
   issuer autocomplete and issuer entry/exit. The PDF receipt design is unchanged.

## Files

See VERIFICATION_INTERFACE_FILES.txt in this directory for the complete manifest.
The published external SHA-256 file covers the ZIP. No secrets, installed
packages, build output, font binaries, PDF documents, or extra repository history
are included in this package.
