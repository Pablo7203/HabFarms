# HabFarms MVP staging UAT report

## Release candidate

- Environment: staging
- Application: https://habfarms-staging.vercel.app
- Supabase project: `habfarms-staging` (`faxvvvwkmdqwnlikczls`, `eu-west-1`)
- Initial candidate: `3db97ee4e30dfa011292fae10ebd876cf55675cd`
- Authentication fix candidate: `2047c3e5a8076af356672315ed38aaef45a8b7f3`
- Test date: 2026-08-23
- Tester: Codex with user-assisted email confirmation and recovery-link checks
- Recommendation: **NO-GO** until UAT-001 is resolved and retested

## Deployment and database verification

| Test | Result | Evidence |
| --- | --- | --- |
| Clean local database reset | PASS | Eight migrations applied in order. |
| Full local runtime regression | PASS | 613/613 checks passed across seven Sprint verification suites before staging deployment. |
| Staging migration dry run | PASS | Exactly eight expected migrations. |
| Staging migration apply | PASS | Local and remote migration histories match. |
| Required database objects | PASS | 24/24 required objects, 64 public functions, 12 public views, 7 reporting RPCs, and 18 audit triggers found. |
| Core RLS enabled | PASS | `profiles`, `farms`, `farm_settings`, and `farm_members` all have RLS enabled. |
| Staging application deployment | PASS | Vercel deployed commit `2047c3e`; deployment status Ready. |
| Health endpoint | PASS | HTTPS 200 with `application/json` and `{ "status": "ok" }`. |
| Public/protected route smoke test | PASS | Login, signup, and forgot-password returned 200; unauthenticated dashboard redirected to login; static asset returned 200. |
| Secrets boundary | PASS | Vercel contains only the public Supabase URL and publishable key; no service-role key is configured. |

`supabase db lint --linked` could not run because the generated database password was not retained. Read-only authenticated catalog checks were used instead; this is an environment limitation, not a detected schema failure.

## Functional UAT

| Scenario | Result | Evidence |
| --- | --- | --- |
| Signup, email confirmation, login | PASS | UAT admin created and confirmed; login succeeded. |
| No-farm onboarding | PASS | User was directed to onboarding and created `UAT Farm` through the application. |
| Farm settings | PASS | GHS, Africa/Accra, crate/bag defaults, opening cash, prices, and thresholds saved. Invalid configuration rejection is covered by the passing runtime regression. |
| Default expense categories | PASS | Ten expected categories were available on the expense form. |
| Flock lifecycle | PASS | 480-bird flock created; death reduced live birds; compensating addition restored the expected count before production. |
| Feed setup/opening stock | PASS | Feed type, supplier, and 1,000 kg opening stock created through the application. |
| Daily production | PASS | 410 collected, 402 good, 8 cracked, 48 kg feed, and one death posted; bird, egg, and feed ledgers updated. |
| Egg inventory | PASS | Sale of 300 eggs left 102 eggs in derived stock. |
| Customer and sale | PASS | GHS 1,200 sale created with GHS 600 initial receipt and GHS 600 outstanding. |
| Customer payment | PASS | Second GHS 600 receipt changed the sale to Paid and receivables to zero. |
| Feed purchase and WAC | PASS | 500 kg purchase at GHS 2,200 with GHS 1,100 paid; stock became 1,452 kg at GHS 4.1333/kg and GHS 6,001.60 value. |
| Historical feed costing | PASS | 48 kg consumption cost recomputed to GHS 198.40 using weighted average cost. |
| Health and generated expense | PASS | GHS 300 health record generated a partial expense with GHS 150 paid and GHS 150 due. |
| Manual expense | PASS | GHS 500 expense with GHS 200 payment retained a GHS 300 payable. |
| Cash flow | PASS | Customer receipts appear as inflows; feed and expense payments appear as outflows. Closing tracked cash was GHS 9,750 before capital. |
| Owner capital separation | PASS | GHS 1,000 capital increased tracked cash to GHS 10,750 without increasing operating profit. |
| Profitability | PASS | Revenue GHS 1,200 less feed GHS 198.40 and other expenses GHS 800 produced GHS 201.60 management operating profit. |
| Reports, current month | PASS | Production, sales, expenses, feed, health, cash flow, and profitability reports loaded and matched entered transactions. |
| Reports, custom range | PASS | 2026-08-23 production filter returned 410 collected, 402 good, 8 cracked, 48 kg feed, and one death. |
| CSV endpoints | PASS | Production, sales, expenses, and cash-flow export links were exercised with date filters. Download/filtering, tenant isolation, readability, and formula-sanitization behavior are also covered by the passing Sprint runtime suites. |
| Audit trail | PASS | Recent mutations show actor, action, entity, UTC timestamp, and safe summary without notes or secrets. |
| Mobile layout | PASS | At 375×812, login, dashboard, production, sales, feed purchase, health, expense, cash flow, and reports had a main view and no blocking application error. |

## Role UAT

Synthetic staging identities were created for an admin, manager, and worker.

| Role | Result | Evidence |
| --- | --- | --- |
| Admin | PASS | Full operational, financial, settings, user, and audit access. |
| Manager | PASS | Operational and permitted financial pages available; settings and farm-user routes redirect to dashboard. |
| Worker | PASS | Production and health workflows available; health cost field absent; sales, expenses, cash flow, profitability, settings, and users redirect to dashboard. |
| Membership escalation/isolation | PASS | Passing runtime regression verifies self-promotion, modification of other members, unauthenticated protected RPC access, and cross-farm RLS denial. |

## Authentication defect

### UAT-001 — Cross-device password recovery fails

- Severity: release blocker
- Status: open; application guard deployed, infrastructure configuration pending
- Reproduction:
  1. Request a reset link on one device/browser.
  2. Open the email link on another device/browser.
  3. Enter a valid new password.
  4. Password update fails; the prior password remains valid.
- Root cause: the default recovery email uses a PKCE authorization code. Its verifier cookie remains in the browser that requested the email, so the callback cannot establish a recovery session on another device.
- Application correction deployed in `2047c3e`: the callback supports Supabase token-hash OTP verification, checks callback errors, and the reset page refuses to render without a verified user session.
- Remaining configuration: configure custom SMTP in Supabase, then change the Reset password template link to:

  `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

- Retest required: request a fresh email, open it on a different device, update the password, verify the old password is rejected, and verify the new password signs in.

Supabase’s staging dashboard currently disables template editing until custom SMTP is configured. No SMTP credentials/provider were supplied, so this cannot be completed safely in the present deployment pass.

## Release gates after authentication correction

| Gate | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| Vercel build/deploy of `2047c3e` | PASS |

## Production readiness

Production deployment was not started. In addition to UAT-001, the following production prerequisites remain unapproved or unavailable:

- production Supabase project and credentials;
- backup/PITR or an approved backup-and-restore plan;
- production domain and DNS ownership;
- real production admin identity and initial farm/opening-balance decisions;
- go-live window, monitoring owner, and rollback approval.

## Final UAT status

**DEPLOYMENT BLOCKED — ISSUES REMAIN**
