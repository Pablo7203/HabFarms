# HabFarms Desktop — hosted Staging core offline acceptance

**Status (23 October 2026): FAILED — BLOCKERS REMAIN.** This is an evidence checkpoint, not a hosted acceptance claim. Scope is daily production and mortality only.

## Verified environment and source

- Staging Vercel project: `habfarms-staging`, project ID `prj_kVFfydcwPQaoBamCSKtJy5Q0STXT`, site `https://habfarms-staging.vercel.app`. The visible ready deployment was `6FVwoBcHaqDTjvUprmAxAgxHj1Y4`, from `staging` commit `afdf85c95a4d74aa7c2390e84cf15e1af1c9a86f`.
- Staging Supabase project: `habfarms-staging`, ref `faxvvvwkmdqwnlikczls`, API host `faxvvvwkmdqwnlikczls.supabase.co`. Auth Site URL is the Staging Vercel site.
- A read-only Staging SQL query showed 12 farms, migration ledger head `202610230092`, and no `202610210088` ledger row, `desktop_sync_receipts` relation, or `sync_desktop_operation_v1(jsonb)` function. Versions 089–092 are already applied, so migration 088 is now out of order.
- The main checkout's Supabase CLI link points to `brxnglrbmrfdoyizzyik`, which is neither this Staging project nor the documented Production project. It must not be used for this acceptance.
- No Production environment was accessed or modified during this acceptance work.

## Local integration prepared

The isolated worktree at `C:\Users\Thoma\.codex\worktrees\desktop-staging-core\My work` starts at the deployed Staging commit above. It stages only the Desktop app and proof code, authenticated Desktop sync route and contract, migration 088 and its SQL test, and ESLint configuration for these files. Newer Staging web changes and migrations 089–092 were retained. The route accepts a server-only base64 PEM signing key for a hosted environment and checks it against the public key pinned in the native client. The Desktop UI has an explicit `DESKTOP · STAGING QA` marker when built with `VITE_DESKTOP_ENV=staging`.

Local checks completed: frozen offline `pnpm install`; 9/9 contract proofs; 9/9 Desktop projection proofs; 4/4 existing Staging logic-security tests; focused ESLint with zero errors and one existing React Hook warning; Next type generation and typecheck; production Next build with local placeholder public environment values. None of these checks used the hosted Staging database.

## Hosted acceptance blockers

1. A verified pre-migration backup and recovery path for the existing 12-farm Staging data has not been established. Do not apply migration 088 or reset the database yet.
2. Migration 088 is missing although later migrations are applied. Review its dependencies and the Supabase migration ledger before an explicitly targeted application. Do not run a blind `db push` against the unrelated CLI link.
3. The effective Vercel `NEXT_PUBLIC_SUPABASE_URL` value was masked in the UI and has not been verified as the Staging Supabase host. Required server-only Desktop lease signer variables were not present in the visible Vercel environment variable list.
4. The saved Vercel CLI token returned 403 `invalidToken` on a read-only request to the Staging project. This checkout has no verified deployment credential.
5. Local browser control now returns `Local browser use is disabled in Work settings`, preventing continuation of the Staging dashboard checks through the previously used UI. The user can re-enable that setting and reopen the Staging tabs; credentials should not be sent in chat.
6. The native Staging QA installer has not been built, signed, or connected to verified Staging endpoints. No hosted login, offline operation, sync, lost-acknowledgement, conflict, or regression proof has run.

## Required final report fields (1–45)

| # | Item | Result |
|---|---|---|
| 1 | Source branch/commit | Isolated detached integration worktree at `afdf85c`; Desktop source imported from `8ed184e`. Integration changes staged, not committed. |
| 2 | Staging web identity | Verified project, site, ready deployment above. |
| 3 | Staging Supabase identity | Verified project ref, API host, Auth Site URL above. |
| 4 | Production access | None during this work. |
| 5 | Backup/recovery | Unverified; blocker. |
| 6 | Staging migrations applied | Desktop 088 not applied. |
| 7 | Migration ledger | Head 092; 088 absent; out-of-order review needed. |
| 8 | Hosted sync service deployment | Not deployed. |
| 9 | Staging service health | Existing public `/api/health` returned 200 `{"status":"ok"}`; Desktop sync health untested. |
| 10 | Staging QA Desktop build/config | Source marker prepared; native QA build/config unverified. |
| 11 | Synthetic users/farms | Not created. Existing Staging farm count: 12. |
| 12 | Native hosted login | Not run. |
| 13 | Bootstrap/snapshot | Not run on hosted Staging. |
| 14 | Offline Production | Not run on hosted Staging. |
| 15 | Offline Mortality | Not run on hosted Staging. |
| 16 | Native offline restart | Not run on hosted Staging. |
| 17 | Hosted Sync Now | Not run. |
| 18 | Web authoritative verification | Not run. |
| 19 | Production authoritative counts | Not measured. |
| 20 | Mortality authoritative counts | Not measured. |
| 21 | Inventory | Not measured. |
| 22 | Population | Not measured. |
| 23 | Production percentage | Not measured. |
| 24 | Hosted Production lost acknowledgement | Not run. |
| 25 | Hosted Mortality lost acknowledgement | Not run. |
| 26 | Production conflict | Not run. |
| 27 | Population conflict | Not run. |
| 28 | Session expiry | Not run. |
| 29 | Membership revocation | Not run. |
| 30 | Role change | Not run. |
| 31 | Farm/subscription suspension | Not run. |
| 32 | Multi-user isolation | Not run. |
| 33 | Multi-farm routing | Not run. |
| 34 | Negative HTTP/security tests | Not run against hosted Staging. |
| 35 | Audit actor | Not verified on hosted Staging. |
| 36 | Several-hour outage | Not run. |
| 37 | Performance | No hosted observations. |
| 38 | Staging web regression | Not run. |
| 39 | Database tests | Existing local Staging logic tests 4/4; hosted SQL tests not run. |
| 40 | Files changed | Desktop app/proof, sync route/contract, migration 088/test, ESLint, this report. |
| 41 | Commit hash | No integration commit yet. |
| 42 | Staging deployment ID | Existing deployment `6FVwoBcHaqDTjvUprmAxAgxHj1Y4`; no new deployment. |
| 43 | Production deployment | Unchanged by this work. |
| 44 | Remaining blockers | Backup, migration ordering, effective Vercel config, deployment auth, browser control, hosted proof. |
| 45 | Recommendation | Restore Staging access, verify backup and config, apply only reviewed missing migration, deploy Staging, then run the full native hosted acceptance. Do not expand scope yet. |

**HABFARMS DESKTOP STAGING CORE OFFLINE ACCEPTANCE FAILED — BLOCKERS REMAIN**
