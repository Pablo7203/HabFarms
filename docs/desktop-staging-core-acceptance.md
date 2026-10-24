# HabFarms Desktop — hosted Staging core offline acceptance

**Current result (24 October 2026): BLOCKED — hosted acceptance is incomplete.** The user explicitly waived the Staging backup gate so work could proceed. That waiver is recorded here; it is not backup or restore evidence. Scope is Desktop daily egg production and mortality only. Production remains out of scope.

## Environment and database evidence

- Staging Vercel project: `habfarms-staging`, project ID `prj_kVFfydcwPQaoBamCSKtJy5Q0STXT`, site `https://habfarms-staging.vercel.app`. Before this work, the ready deployment was `6FVwoBcHaqDTjvUprmAxAgxHj1Y4` from `staging` commit `afdf85c95a4d74aa7c2390e84cf15e1af1c9a86f`. Commit `04f7daf90c0ded666603e0ceda842467a8240060` has a successful Vercel deployment record (`7291459419`) as a **Preview – habfarms-staging** deployment at `https://habfarms-staging-78k79jnrm-alpha-s-projects13.vercel.app`.
- Staging Supabase project: `faxvvvwkmdqwnlikczls`, API host `faxvvvwkmdqwnlikczls.supabase.co`; Auth Site URL points to the Staging Vercel site.
- Migration `202610210088_desktop_sync_core.sql` was explicitly reviewed with `supabase db push --project-ref faxvvvwkmdqwnlikczls --include-all --skip-vault --dry-run`; the dry run selected only 088. The same explicitly targeted command applied only 088 to Staging. SQL Editor then confirmed the 088 ledger row, receipt relation, sync RPC, RLS enabled, zero receipts, and unchanged farm count of 12. Grants checked: anon cannot execute the RPC or read receipts; authenticated can execute the RPC; service role can read receipts.
- The Staging Free Plan has no managed database backups. The user said to ignore the Staging backup and proceed. Independent backup and restore have not been proven; this remains a documented data recovery risk, accepted for continuing this Staging-only exercise.
- No Production database, dashboard, deployment, or project settings were changed. An earlier account-wide Supabase CLI project listing returned Production project metadata incidentally.

## Source and local build evidence

- Worktree: `C:\Users\Thoma\.codex\worktrees\desktop-staging-core\My work`; branch `codex/desktop-staging-core`; base commit `bca9719c2a828de047928afe8e0c593076464e43` on top of Staging deployment commit `afdf85c`.
- Changes include the isolated Desktop app/proof, authenticated farm/bootstrap endpoints, daily production/mortality sync endpoint and contract, migration 088 plus its SQL test, and focused lint configuration. Existing Staging migrations 089–092 remain intact.
- New `/api/desktop/farms` and `/api/desktop/bootstrap` routes provide authenticated farm access and a signed prepared snapshot. `GET` and `POST /api/desktop/sync` plus these routes fail closed unless `NEXT_PUBLIC_SUPABASE_URL` resolves to the exact Staging Supabase host.
- A new Staging Ed25519 keypair was generated. The private PEM is in the ignored local `apps/desktop/.local/staging-lease-private.pem`; only the public key is committed/pinned in the native app. Its SHA-256 fingerprint is `086bfec0007116fff31088cd9482cad71f11f9ff7db65f2cdda2828aad7e44a1`.
- The user approved the private key for the Staging Vercel project. Vercel confirmed `DESKTOP_LEASE_PRIVATE_KEY_B64` was saved as a Secret in that project's Production environment; `DESKTOP_LEASE_PUBLIC_KEY_B64` and `DESKTOP_LEASE_KEY_ID=staging-2026-10` were saved as Config values, also in Production. The branch deployment is Preview, so those Production-scoped values do not establish Preview runtime configuration. Runtime values have not been verified.
- Verification completed: offline `pnpm install`; 9/9 sync contract proofs; 9/9 Desktop projection proofs; 4/4 existing Staging logic-security tests; focused ESLint (zero errors, one existing React Hook warning); Next type generation and typecheck; local production Next build with placeholder public environment values; Windows Tauri release build completed at `apps/desktop/src-tauri/target/release/habfarms-desktop.exe`. The native build used the Staging Supabase URL, Staging publishable key, and Staging API URLs. These checks do not establish hosted behavior.

## Hosted acceptance blockers

1. **Backup/restore:** waived by the user for this exercise; no independent backup/restore proof. Treat Staging data recovery as an accepted residual risk, not a passed check.
2. **Deployment environment:** Vercel completed Preview deployment `7291459419` for commit `04f7daf`. It is protected by Vercel login. The stable `https://habfarms-staging.vercel.app/api/desktop/sync` returned the application 404 page, so the new route is not available on the stable Staging site.
3. **Runtime configuration:** lease values were saved only in the project Production environment; Preview does not have verified values. The masked `NEXT_PUBLIC_SUPABASE_URL` was not independently read. The new routes fail closed unless its runtime host exactly matches Staging Supabase.
4. **Hosted smoke:** the preview URL redirects to Vercel authentication, and the stable Staging URL still returns 404 for the Desktop sync route. The Desktop API health endpoint and signed farm bootstrap have not been verified.
5. **Native hosted use:** no Staging login, farm bootstrap, offline close/reopen, reconnect, or authoritative web verification has been run in the rebuilt installer.
6. **Business sync proof:** no hosted production or mortality operation has been submitted; no lost acknowledgement/retry proof, conflict handling proof, or authoritative exactly-once count comparison exists.
7. **Security/regression:** hosted negative HTTP/security checks, expired/revoked session, membership/role/suspension changes, multi-user/farm isolation, longer outage behavior, and Staging web regression remain unverified.
8. **Recovery:** no demonstrated recovery process for a customer's lost or damaged desktop workspace.

## Required acceptance fields (1–45)

| # | Field | Evidence / status |
|---|---|---|
| 1 | Source branch/commit | `codex/desktop-staging-core`; commit `04f7daf90c0ded666603e0ceda842467a8240060`; based on Staging `afdf85c`. |
| 2 | Staging web identity | Verified project, site, prior deployment listed above. |
| 3 | Staging Supabase identity | Verified project ref, API host, and Auth Site URL listed above. |
| 4 | Production access/change | No Production DB, dashboard, or deployment changed; CLI project list incidentally exposed project metadata. |
| 5 | Backup/recovery | Explicitly waived by user for this acceptance; no independent backup or restore proof. Residual risk. |
| 6 | Migration 088 | Applied to Staging only; post-apply SQL checks passed. |
| 7 | Migration ledger | 088 row verified after application; previously applied later versions 089–092 retained. |
| 8 | Hosted sync deployment | Successful Vercel Preview deployment `7291459419`; protected by login; stable Staging alias not updated. |
| 9 | Staging API health | Earlier public web health was 200. New Desktop sync route on stable alias returned 404; protected Preview route not yet verified. |
| 10 | Staging QA desktop build | Windows Tauri release executable built locally with Staging endpoints and `VITE_DESKTOP_ENV=staging`. |
| 11 | Synthetic user/farm | None created; existing Staging count remained 12 immediately after migration. |
| 12 | Native hosted login | Not run. |
| 13 | Hosted bootstrap/snapshot | Not run. |
| 14 | Offline production entry | Not run against hosted Staging. |
| 15 | Offline mortality entry | Not run against hosted Staging. |
| 16 | Offline restart | Native restart tested by user previously for local pending entries; hosted lease/offline workflow not yet accepted. |
| 17 | Hosted Sync Now | Not run. |
| 18 | Web authoritative verification | Not run. |
| 19 | Production authoritative counts | Not measured. |
| 20 | Mortality authoritative counts | Not measured. |
| 21 | Egg inventory impact | Not measured. |
| 22 | Flock population impact | Not measured. |
| 23 | Production percentage | Not measured. |
| 24 | Production lost acknowledgement | Not run. |
| 25 | Mortality lost acknowledgement | Not run. |
| 26 | Production conflict | Not run. |
| 27 | Population conflict | Not run. |
| 28 | Session expiry | Not run against hosted Desktop routes. |
| 29 | Membership revocation | Not run. |
| 30 | Role change | Not run. |
| 31 | Farm/subscription suspension | Not run. |
| 32 | Multi-user isolation | Not run. |
| 33 | Multi-farm routing | Not run. |
| 34 | Negative HTTP/security tests | Local checks only; hosted negative requests not run. |
| 35 | Audit actor | Not verified for hosted events. |
| 36 | Several-hour outage | Not run. |
| 37 | Performance | No hosted measurements. |
| 38 | Staging web regression | Not run after Desktop routes are deployed. |
| 39 | Database tests | Local Staging logic tests 4/4; migration 088 applied; no hosted business operation tests. |
| 40 | Files changed | Desktop app/proof, Desktop API routes/helpers, pinned public key, migration 088/test, focused lint config, acceptance report. Private key remains ignored locally. |
| 41 | Commit hash | `04f7daf90c0ded666603e0ceda842467a8240060`. |
| 42 | Staging deployment ID | Prior stable ID `6FVwoBcHaqDTjvUprmAxAgxHj1Y4`; Preview deployment `7291459419` at the URL above. |
| 43 | Production deployment | Unchanged. |
| 44 | Remaining blockers | Stable Staging deployment access, Preview runtime config, runtime health/bootstrap, native hosted login/bootstrap/offline/reconnect, operation sync, lost-ack exactly-once for both operation types, conflicts/security/regression proof. Backup was waived and remains a residual risk. |
| 45 | Recommendation | Make the deployed Staging Preview reachable through the authorized Staging environment and verify runtime config, then execute hosted native login/bootstrap/offline restart and exactly-once sync acceptance for mortality and production. Stop before Phase 4 scope. |

**HABFARMS DESKTOP STAGING CORE OFFLINE ACCEPTANCE FAILED — BLOCKERS REMAIN**
