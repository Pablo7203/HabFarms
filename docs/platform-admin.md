# Platform Admin Phase 1

## Purpose and boundary

Platform Admin is HabFarms' control plane. It manages customer-farm tenancy, primary-owner invitations, onboarding progress, subscription-plan foundations, and tenant-management audit events. It does not grant platform staff access to operational farm data such as production, sales, expenses, inventory, customer balances, or profitability.

Platform administrator is a separate role from farm administrator. Adding a user to `platform_admins` never creates a `farm_members` row.

## Initial bootstrap

There is intentionally no public self-service platform-admin signup. Before using `/platform`, an authorised operator must create an Auth user and add that user's Auth UUID to `public.platform_admins` through the protected Supabase administration workflow. Record that action through the platform change-control process. Do not expose a service-role key in the application to perform this bootstrap.

## Tenant lifecycle

1. A platform administrator creates a farm account at `/platform/farms/new`, choosing an existing plan foundation and owner contact.
2. `platform_create_farm` atomically creates the farm, its settings, account, onboarding row, current subscription row, and a seven-day owner invitation. Email delivery happens after the transaction commits.
3. The owner accepts the invitation. This creates exactly one active farm-admin membership, assigns the primary owner, and moves the account to `onboarding`.
4. The owner must save farm settings. A first flock and opening stock are optional; skipped steps are recorded as skipped, never fabricated as operating records.
5. Completing onboarding changes the account to `active`. Normal farm access is blocked for the primary owner while the account remains in onboarding.

Expired or revoked owner invitations cannot be accepted. Platform administrators can resend or revoke pending owner invitations. Existing-account invitation delivery uses a sign-in link rather than creating a second Auth account.

## Data and security

- `platform_admins`: separate platform identity.
- `subscription_plans` and `farm_subscriptions`: plan/subscription foundation only; no billing, payment gateway, MRR, or entitlement enforcement is included in Phase 1.
- `farm_accounts` and `farm_onboarding`: lifecycle metadata.
- `platform_audit_logs`: tenant-management events only; constraints reject passwords, tokens, and other credentials.
- `platform_get_farm_summaries` and `platform_get_farm_detail`: narrow SECURITY DEFINER functions that return account/onboarding metadata and user counts, not farm operations.

All write RPCs verify `is_platform_admin()` or the accepted primary owner before writing. RLS remains enabled on every new table.

## Staging release sequence

1. Confirm the linked Supabase project is the staging project `faxvvvwkmdqwnlikczls`.
2. Run `pnpm supabase db push --dry-run` and confirm only migrations 032–035 are pending.
3. Apply the migrations to staging, deploy the application to staging, and test with isolated platform admin and owner accounts.
4. Verify create, resend, revoke, existing-owner handling, acceptance, settings gate, onboarding completion, non-platform denial, and no access to farm operational records.

No production deployment is part of this phase. Rollback is forward-only: preserve tenant records, disable the affected route or account access if needed, and ship a corrective migration; do not delete customer farms or rewrite audit history.

# Platform Admin Phase 2 — commercial accounts

## Commercial boundary

Phase 2 adds HabFarms platform subscriptions. These are **not** farm cash, supplier payments, expenses, sales, profit, or farm financial records. A platform payment is only evidence that a customer paid HabFarms for access to the product; it never posts to a customer's farm ledger.

## Plans, subscriptions, and billing periods

- Platform Administrators manage plans at `/platform/plans`. Plan codes are immutable; a plan may be deactivated, but history remains available.
- A subscription records the selected plan, currency, cycle, and its current lifecycle status. Changing a plan's current price never changes an existing billing-period obligation.
- Each payable period snapshots the plan name, cycle, currency, and price. Period start is inclusive and period end is exclusive. The database prevents overlapping periods for the same subscription.
- Trials are configuration only until a Platform Administrator prepares a billing period or the lifecycle reconciler reaches the due date. This keeps a configured plan price explicit and prevents the application from inventing commercial prices.

## Manual payments

At `/platform/subscriptions/[id]`, Platform Administrators may prepare an obligation and record a manual payment. Supported methods are MoMo, bank transfer, cash, Paystack reference, and other. Payments may be partial or full; the database rejects zero, negative, duplicate-reference, and overpayment records. Every request has an idempotency key.

A posted payment has one allocation to one billing period. Void a mistaken payment from the same subscription screen with a recorded reason. The payment remains in history as `voided`, its allocation stops counting, and the period balance is recalculated. Payment record/void actions are audited.

## Lifecycle and access

Subscription status is one of `trialing`, `active`, `past_due`, `grace_period`, `suspended`, or `cancelled`. Farm account status remains separate (`invited`, `onboarding`, `active`, `suspended`, `closed`).

- A valid paid period activates a subscription and reactivates a farm only when the prior suspension source was billing.
- A manual account suspension never becomes active simply because a payment is recorded.
- At grace expiry, the reconciler marks the subscription suspended and blocks operating-data access through both server layout checks and the existing operational RLS helpers.
- Suspended users can still authenticate and visit `/account-status`; farm administrators see safe account/subscription information while Workers see a generic access message without billing figures.
- Farm administrators can read their own subscription at `/settings/subscription`. Workers have no platform-billing view.

## Reconciliation job

`POST /api/platform/reconcile` is a protected, cron-ready endpoint. It does nothing unless `PLATFORM_RECONCILE_SECRET` is configured and supplied as `Authorization: Bearer <secret>`. It invokes the idempotent `platform_reconcile_subscription_lifecycle(as_of)` database function. Configure the secret and scheduler only in the staging environment first; never place it in client code or a public environment variable.

## Required staging UAT

Before approving a Phase 2 release, test: plan creation/deactivation; trial conversion; monthly/annual period dates (including end-of-month); partial/full/duplicate/overpayment/void payment paths; grace and suspension/re-activation; safe account-status behaviour; Worker financial privacy; direct URL/RLS denial; a manual reconcile call with staging-only credentials; and responsive views for platform billing and customer subscription screens. No production deployment is part of this work.
