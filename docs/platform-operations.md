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

Without the Resend values, messages remain **pending**. This is intentional: the UI must not claim an email was sent when no provider is configured. A message becomes **sent** only after Resend accepts it; inbox delivery, bounce, and complaint outcomes remain provider-side signals.

Use `/platform/operations` to inspect recent runs, pending/failed communications, and retry pending messages after the provider is configured. The retry control is Platform Admin-only and only processes Platform communication metadata.

Schedule this endpoint only after production launch approval. Vercel Cron runs in Production, not preview/staging deployments; staging can call the protected endpoint manually with a controlled secret for UAT. Do not add a production cron until its owner, cadence, and alert recipient are recorded.

## Incident response

1. If a lifecycle job fails, inspect the secure host logs and the latest Platform Operations entry; do not expose provider responses to customers.
2. If messages fail, confirm the sender verification and provider credentials, then retry from `/platform/operations`.
3. If a customer reports an incorrect account state, use the Platform audit timeline and subscription detail first. Do not alter tenant ledgers to resolve a billing issue.
4. If a database recovery is needed, follow [recovery.md](recovery.md). Preserve audit evidence and do recovery in an isolated environment.

## Platform-only data controls

- Internal account notes are append-only and visible only to Platform Admins.
- CSV exports cover portfolio, Platform collections, and Platform payments only.
- Exports exclude egg sales, feed, health, customer debt, farm profitability, and other tenant operational records.
- Support impersonation is not implemented. Diagnose with account metadata and audit data; obtain customer-approved support evidence outside the product where needed.
