# HabFarms v1.0 production go-live record

## Release decision

- Customer UAT: **WAIVED BY PRODUCT OWNER**
- Reason: The product owner accepted the verified staging state and approved a controlled production go-live.
- Risk treatment: The first customer will use monitored reconciliation and a 3–7 day parallel run.
- Production deployment owner: Product owner / repository owner
- Release commit: `5e428216bc9d4d0214ebbd7826afb7f8d166bed5`
- Release tag: `v1.0.1`
- Existing historical tag: `v1.0.0` remains immutable at `fc0a8400f17fecf5cc908af63ba9871eb42474c0`.
- Deployment date: 2026-08-28 UTC

## Environment isolation

- Production application: `https://habfarms.vercel.app`
- Production Supabase: `lzrtxrkpohnbviemssic`
- Staging application: `https://habfarms-staging.vercel.app`
- Staging Supabase: `faxvvvwkmdqwnlikczls`
- Production Auth Site URL: `https://habfarms.vercel.app`
- Approved production callbacks: `/auth/callback` and `/auth/callback?next=/reset-password` on the production origin only.
- The local Supabase CLI link was restored to staging after production work.

## Pre-release verification

- Repository clean at release commit: PASS
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `git diff --check`: PASS
- Clean 16-migration replay: previously verified PASS against the accepted release state
- Database lint after production migration: PASS, no schema errors
- Customer workflow smoke coverage: previously tested and accepted by the product owner; duplicate synthetic testing was stopped at the product owner's request.

## Backup state

- Supabase WAL backup capability: enabled
- Point-in-time recovery: unavailable (`pitr_enabled=false`)
- Scheduled backup snapshots reported before release: none
- Pre-release logical backup: schema, data, and roles
- Backup timestamp: 2026-08-28 00:53 UTC
- Backup location: ignored local operator directory `backups/production-20260828T003500Z/`
- Backup ownership: product/repository owner
- Restore procedure: follow `docs/recovery.md`; restore only into an isolated recovery project first and verify before any production decision.

## Database migration

- Initial production history: 001–008
- Dry run: PASS; exactly migrations 009–016 were proposed, with no reset or unexpected reapplication.
- Applied forward migrations:
  - `202608230009_credit_collections.sql`
  - `202608230010_egg_grades_pricing.sql`
  - `202608230011_fix_graded_sale_update.sql`
  - `202608230012_filter_cash_flow_summary.sql`
  - `202608240013_user_invitations.sql`
  - `202608240014_reliable_invitation_resend.sql`
  - `202608240015_invitation_auth_user_delete_behavior.sql`
  - `202608240016_distinguish_invitation_account_lifecycle.sql`
- Final production migration history: 001–016, local and remote matched
- Required credit, grading, pricing, invitation, and membership-lifecycle objects: present
- RLS: enabled on core farm, membership, profile, egg-grade, pricing, invitation, inventory, sales, feed, health, expense, and audit tables
- Anonymous protected-RPC checks: PASS for `create_farm_with_admin`, `post_egg_grading`, and `manage_farm_member` (HTTP 401 / permission denied)

## Application and Auth release

- Explicit Vercel production deployment: Ready
- Deployment URL: `https://habfarms-618bpy6nv-alpha-s-projects13.vercel.app`
- Production alias: `https://habfarms.vercel.app`
- Production health: HTTP 200, `{"status":"ok"}`; the endpoint calls the database `health_check` RPC.
- Production isolation proof: the controlled QA identity was created in production Supabase and was absent from staging.
- Custom Gmail SMTP: enabled; sender name `HabFarms`; temporary MVP limitation accepted.
- Hosted professional password-reset template: verified.
- Signup confirmation email: PASS
- Password-recovery email and recovery flow: PASS
- Login after recovery: PASS by product-owner confirmation; dashboard reached
- Profile trigger: PASS
- Farm onboarding: PASS
- Controlled farm: `Alpha Farms`, Admin active, timezone `Africa/Accra`, crate size 30
- User-management and operational workflows: accepted from previous verified testing by the product owner; no duplicate synthetic production ledger was created.

## First-customer readiness

- No real first-customer opening balances have been entered as part of this release task.
- Historical receivables: determine during first-customer onboarding. Do not create fake sales. If opening receivables exist and no supported opening mechanism is available, stop and record an onboarding gap.
- Historical payables: determine during first-customer onboarding. Do not manufacture feed purchases or expenses.
- Go-live cutover date: to be approved with the first farm owner; avoid a partial-day cutover.
- Parallel run: 3–7 days using the customer's existing notebook/Excel record.
- Daily reconciliation: birds, each egg grade, total eggs, feed kg, customer debt, and cash. Investigate unexplained variance before adjustment.

## Accepted risks and monitoring

- Free Supabase plan has no PITR and no scheduled snapshot listed at deployment time.
- Gmail SMTP is temporary and requires delivery/rate-limit monitoring.
- Monitor `/api/health`, Vercel runtime errors, Supabase/Auth logs, email failures, database errors, and unexpected 5xx responses during the first week.
- No P0 or unresolved P1 was identified during deployment.
- Application rollback may use the last compatible Vercel deployment. Never use `db reset` as rollback; migrated databases require deliberate forward-compatible analysis.

## Status

**HABFARMS v1.0 LIVE — FIRST CUSTOMER ONBOARDING READY**
