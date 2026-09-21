# Operations

## Platform management dashboard

Platform staff use `/platform` to follow customer-account, subscription, and HabFarms subscription-payment health. The dashboard and its trial, renewal, collection, and portfolio drill-downs are control-plane only. Amounts are grouped by their recorded currency; operators must not combine currencies manually in the product.

Use the existing subscription detail workflow to prepare a billing period, record a verified manual payment, void an incorrect payment, extend a trial/grace period, or apply a manual suspension/reactivation. The dashboard is not a payment gateway and does not initiate customer charges. If an item needs farm-operational investigation, contact the customer through approved support channels rather than attempting to access tenant records through Platform Admin.

## Local work

```bash
pnpm install
pnpm supabase start
pnpm supabase db reset
pnpm dev
```

Stop with `pnpm supabase stop`. Verify with the Sprint 1–7 scripts, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
Final migration verification performs two clean resets so deterministic replay is proven twice.

## Production migration and deployment

Back up first. Review every migration and target project, then use the installed CLI workflow: `pnpm supabase link --project-ref <ref>`, `pnpm supabase db push --dry-run`, review, and `pnpm supabase db push` in a controlled window. Never migrate automatically during app startup. Configure Vercel environment variables, Supabase Site URL and exact callback/reset URLs, deploy, verify `/api/health`, login, dashboard, and non-destructive domain smoke tests.

Use a staging Supabase project and Vercel deployment before production. HTTPS is provided by the platforms. Keep production and staging credentials separate.

Automatic Vercel builds are allowlisted to the `habfarms-staging` project by `scripts/vercel-ignore-build.mjs`. Other connected Vercel projects cancel Git-triggered builds. An approved production release must use Vercel's explicit manual deployment/redeploy flow and deliberately disable the project's Ignore Build Step for that release after the database migration plan, backup, and release revision are approved.

## Farm user lifecycle

See `user-management.md` for Admin invitation, acceptance, resend, revoke, role, access, and last-Admin operating procedures. The Supabase service-role credential is server-only and used only for administrative Auth invitation delivery and disposable unaccepted-identity rotation during resend. Farm data, membership acceptance, and role/access mutations continue through the authenticated user context and RLS-controlled RPCs.

## Diagnosis

Use the user-visible reference ID and structured server log entry to correlate unexpected failures. Check Vercel function logs, Supabase database/Auth logs, audit history, health status, and the last deployment/migration. Logs must use IDs rather than credentials, contact details, notes, or payment references.

For migration failure, data corruption, restore, and access incidents follow `recovery.md`. Do not directly edit derived balances; correct source transactions through supported void/reversal workflows.

## Platform subscription reconciliation

Platform subscription lifecycle reconciliation is triggered through `POST /api/platform/reconcile`, guarded by the server-only `PLATFORM_RECONCILE_SECRET`. A scheduler must send `Authorization: Bearer <secret>` and may provide an ISO `asOf` date only for controlled recovery testing. Run it daily in staging before enabling it in any production release. It is idempotent: it creates the required billing period at a transition boundary, moves expired trials/coverage to past due, and suspends billing accounts only after the configured grace date. Review platform audit entries after each controlled run.
## Direct flock bird sales

Use **Sales → Bird sale** for a live bird, spent layer, or cull bird sold directly from an active flock. Enter the customer, flock, date, category, quantity, and price per bird. The system posts exactly one population-out movement, a sale, and any immediate customer payment atomically. Do not first record a separate cull or death for the same sold birds.
