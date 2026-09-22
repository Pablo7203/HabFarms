# Customer onboarding and early-life runbook

## Preflight

Before creating a farm, confirm the customer contact email, business/farm name, selected plan, billing cycle, trial terms, and who will act as Farm Admin. Use an isolated email address for staging UAT.

## Create and invite

1. A Platform Admin creates the customer farm at `/platform/farms/new`.
2. Confirm the invitation's delivery state and expiry on the customer detail page.
3. The owner accepts the Supabase invitation and becomes a Farm Admin for that farm. Existing users retain their existing Auth identity and memberships.
4. The owner completes required farm settings. First flock and opening stock remain optional and should never be fabricated.
5. Confirm the owner reaches the normal farm dashboard and can invite staff under existing farm role rules.

## Opening data and cutover

Use [first-customer-opening-data.md](first-customer-opening-data.md) for the controlled opening-data procedure. Record a cutover date and source documents. Never backdate or invent ledgers simply to make a dashboard look populated.

## Reconciliation checkpoints

Compare the agreed physical/source values with HabFarms on day 1, day 3, and day 7:

- live birds and recent bird movements;
- egg stock by grade;
- feed and raw-material stock;
- supplier/customer balances and cash;
- subscription/account status at the Platform level.

Escalate discrepancies with the source record, date, affected farm, and expected versus actual value. Preserve the audit trail; correct through the appropriate operational workflow rather than direct database edits.

## Customer communication cadence

Send a welcome/onboarding contact at cutover, then check in after day 1, day 3, and day 7. Record support context as a Platform internal note without copying sensitive farm-operational details into the Platform layer.
