# Platform operations runbook

This runbook covers the HabFarms control plane only: customer accounts, subscriptions, lifecycle communication, Platform notes, audit, and safe exports. It never authorizes access to a farm's operational or financial records.

## Platform settings

Platform Admins manage company identity, support contacts, commercial defaults, reminder timing, and the display timezone at `/platform/settings`.

Defaults apply to future account setup and future communication decisions only. They do not rewrite an existing customer's subscription, trial, grace period, billing period, plan snapshot, or historical audit record.

## Lifecycle reconciliation and message delivery

`POST /api/platform/reconcile` is protected by `Authorization: Bearer <PLATFORM_RECONCILE_SECRET>`. It reconciles subscription lifecycle state, queues deduplicated lifecycle messages, records a lifecycle job run, and then attempts a message-delivery run.

Configure the following server-only values before expecting lifecycle email to leave HabFarms:

- `PLATFORM_RECONCILE_SECRET`
- `RESEND_API_KEY`
- `PLATFORM_EMAIL_FROM` — a verified sender, for example `HabFarms <billing@your-domain>`
- `PLATFORM_ALERT_EMAIL` — the operations contact that receives a generic alert when the lifecycle job or message-delivery job fails

Without the Resend values, messages remain **pending**. This is intentional: the UI must not claim an email was sent when no provider is configured. A message becomes **sent** only after Resend accepts it; inbox delivery, bounce, and complaint outcomes remain provider-side signals.

Use `/platform/operations` to inspect recent runs, pending/failed communications, and retry pending messages after the provider is configured. The retry control is Platform Admin-only and only processes Platform communication metadata.

The approved Production schedule is daily at 00:00 UTC. Operational owner: HabFarms Platform Operations; operational contact: `info@habfarm.com`. The repository cron definition invokes this route with `GET` and authenticates with the Production-only `CRON_SECRET`; controlled manual runs continue to use `POST` and `PLATFORM_RECONCILE_SECRET`. Vercel Cron runs in the Production environment of each project where the cron definition is deployed; enable it only for the intended project/environment. Do not run an ad-hoc reconciliation against live Production data for setup verification because it may change customer lifecycle status. Review the Platform Operations job history and secure host logs after scheduled runs. If configured, generic failure alerts are sent to `PLATFORM_ALERT_EMAIL` for a failed lifecycle or delivery job; the alert intentionally omits customer data and provider response details. A successful provider acceptance is not proof of inbox delivery. `PLATFORM_EMAIL_TEST_ENABLED=true` exposes a Platform-Admin-only action that sends exactly one test message to the fixed `PLATFORM_ALERT_EMAIL`; keep it disabled in Production and do not use it to process the customer queue.

## Incident response

1. If a lifecycle or delivery job fails, inspect the secure host logs and the latest Platform Operations entry; check the generic alert at `PLATFORM_ALERT_EMAIL` and do not expose provider responses to customers.
2. If messages fail, confirm the sender verification and provider credentials, then retry from `/platform/operations`.
3. If a customer reports an incorrect account state, use the Platform audit timeline and subscription detail first. Do not alter tenant ledgers to resolve a billing issue.
4. If a database recovery is needed, follow [recovery.md](recovery.md). Preserve audit evidence and do recovery in an isolated environment.

## Platform-only data controls

- Internal account notes are append-only and visible only to Platform Admins.
- CSV exports cover portfolio, Platform collections, and Platform payments only.
- Exports exclude egg sales, feed, health, customer debt, farm profitability, and other tenant operational records.
- Support impersonation is not implemented. Diagnose with account metadata and audit data; obtain customer-approved support evidence outside the product where needed.
