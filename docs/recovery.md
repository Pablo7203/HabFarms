# Recovery runbook

An incident includes suspected corruption, cross-farm exposure, destructive operator error, failed migration, prolonged dependency outage, or unexplained financial/inventory divergence.

1. Stop or restrict writes at the deployment/platform level; preserve logs and do not run ad-hoc repair SQL.
2. Record the incident time, affected farms/domains, deployment, migration version, and last known-good transaction/audit event.
3. Confirm the latest managed backup and independent logical export. Never overwrite the only production copy.
4. Create an isolated recovery project. Apply repository migrations matching the backup point, then restore supported public data. Coordinate Auth-schema restoration separately with Supabase.
5. Record known sample and financial-value checkpoints before backup, then compare table counts, movement balances, receivables, payables, cash closing balance, and profitability samples after restore.
6. Test login/onboarding behavior, active memberships, RLS coverage, cross-farm denial, worker financial privacy, audit immutability, `/api/health`, and all Sprint runtime suites.
7. Promote only after review. Reconfigure allowed Auth URLs and secrets, deploy the matching application version, smoke test, then reopen writes.

For a failed migration, keep traffic on the last compatible application, inspect migration logs, restore into a new environment if rollback would be destructive, correct through a new forward migration, and rerun clean resets. For suspected corruption or access issues, preserve evidence and audit events before any correction.
