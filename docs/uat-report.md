# HabFarms v1.0 staging UAT report

Tested 2026-08-23 through 2026-08-24. Production was not deployed or modified.

## 1. Release Candidate

- Commit: `204498c` (`fix: filter cash flow summary totals`)
- Branch: `main`
- Tag: `v1.0.0-rc9`
- Repository: `Pablo7203/HabFarms`; branch and tag pushed successfully

## 2. Staging Infrastructure

- Vercel: `https://habfarms-staging.vercel.app`, RC9 Ready
- Supabase: `habfarms-staging`, project `faxvvvwkmdqwnlikczls`, `eu-west-1`, healthy
- Separation: staging Vercel uses only staging Supabase public values. Production remains separate and untouched.

## 3. Database Deployment

- Initial ten-migration dry run and deployment: PASS
- Forward-only UAT corrections: migrations 011 and 012 reviewed and applied
- Final state: all 12 repository migrations match hosted staging; clean 12-migration local replay PASS; database lint PASS
- No hosted reset and no manual SQL repair were used

## 4. Staging Auth

- Site URL and allowed callbacks use only `https://habfarms-staging.vercel.app`
- Signup confirmation: PASS
- Cross-device password recovery and subsequent login: PASS
- Session restoration, logout, and protected logged-out routes: PASS
- Invitation: NOT APPLICABLE; the existing product has no invitation workflow
- Email-change synchronization: PASS in the security runtime suite

## 5. Gmail SMTP

- Configured: yes, temporary MVP infrastructure
- Sender name: HabFarms
- Sender address: dedicated operator-configured Gmail address (not repeated in release evidence)
- Confirmation delivery: PASS
- Password-reset delivery: PASS; opened and completed on a phone
- Invitation delivery: NOT APPLICABLE
- Delivery observation: received successfully; Gmail SMTP is not treated as a permanent deliverability solution

## 6. Internal UAT

| Module | Result | Evidence |
| --- | --- | --- |
| Account, onboarding, farm persistence, settings | PASS | Signup, confirmation, onboarding, logout/login, valid settings and invalid-setting rejection |
| Flocks and population | PASS | 500-bird Layers A flock and population-ledger coverage |
| Opening feed and eggs | PASS | 1,000 kg feed; 660 eggs allocated across Unsorted/Small/Medium/Large without fake production |
| Grade pricing/history | PASS | Small 40, Medium 45 then 48 by effective date, Large 55; history visible |
| Production and grading | PASS | 410 Unsorted; 400 allocated 80/210/110; separate 300 allocated 50/180/70 |
| Grade inventory and mixed sales | PASS | Independent grade reductions and historical price snapshots |
| Credit and collections | PASS | 7-day terms, partial/full payments, 14-day extension with audit; paid sale removed from active collections. Due Today/Overdue deterministic runtime coverage PASS |
| Feed purchasing, payment, WAC, consumption | PASS | 500 kg purchase, payments, WAC 4.1333/kg, 50 kg consumption |
| Health, expenses, and payments | PASS | Vaccination-generated expense plus manual transport expense and settlement |
| Cash adjustments | PASS | Capital and withdrawal change cash without changing profit |
| Reports | PASS | Production, sales, feed, health, expenses, cash flow, and profitability reconciled |
| CSV exports | PASS | Production, sales, expenses, feed, health, cash flow, and egg inventory routes plus date/tenant/formula-safety runtime coverage |
| Audit trail | PASS | Live actor/time/action/entity/safe-summary inspection, filters and bounded pagination |
| Automated regression | PASS | Nine suites, 841/841 checks |
| Lint / typecheck / production build | PASS | `pnpm lint`, `pnpm typecheck`, and `pnpm build` |

## 7. Financial Reconciliation

For 2026-08-01 through 2026-08-23:

- Receivables: GHS 0; GHS 349 sales and GHS 349 active receipts
- Payables: GHS 200 health expense; feed payable GHS 0 and manual transport payable GHS 0
- Cash: opening GHS 10,000 + inflows GHS 849 - outflows GHS 2,550 = closing GHS 8,299
- Profit: revenue GHS 349 - other operating expenses GHS 450 = GHS -101. The GHS 500 owner capital affects cash, not profit.
- Bank-transfer filter: opening GHS 10,000 + GHS 550 - GHS 1,100 = GHS 9,450; live RC9 retest PASS

## 8. Inventory Reconciliation

- Birds: opening 500; movement controls and nonnegative population verified
- Eggs before the 2026-08-24 production entry: 1,260 = Unsorted 170 + Small 250 + Medium 600 + Large 240
- Current eggs after the additional 100 Unsorted production entry: 1,360 = Unsorted 270 + Small 250 + Medium 600 + Large 240
- Feed: 1,000 kg opening + 500 kg purchase - 50 kg consumption = 1,450 kg; WAC GHS 4.1333/kg; value GHS 5,993.34

## 9. Security UAT

- Admin: PASS for permitted own-farm administration
- Manager: PASS for supervisory/business access; admin-only actions denied
- Worker: PASS for operational access and financial/privacy restrictions
- Cross-farm reads, writes, memberships, RPCs, and reports: denied in runtime tests
- Direct restricted URLs and server role guards: PASS
- Anonymous protected RPCs: denied
- Core and business-table RLS: PASS

## 10. Mobile UAT

- Actual phone: password-reset CTA, password update, and login PASS
- 375x812 QA: login, dashboard, production, grading, inventory, sales, credit/collections, feed, health, expenses, and reports PASS for readability, touch targets, primary actions, and routine overflow
- Desktop/tablet-width tables and reports: PASS
- Full customer-owned physical-device workflow remains part of customer UAT

## User-management P1 reopening

Customer UAT remains paused until migration 13 and the application invitation flow are deployed and verified in staging. Local verification currently includes a clean 13-migration replay, database lint, the unchanged 841/841 regression baseline, and the dedicated 33/33 user-management runtime suite.

## 11. Customer UAT

- Status: NOT YET COMPLETED
- The controlled internal UAT farm is ready for the intended customer. Customer terminology, natural workflow, and training feedback have not yet been captured.

## 12. Defects

- P0 open: none
- P1 open: none
- P2 open: none recorded from internal UAT
- Customer findings: pending customer UAT

## 13. Fixes

- RC2: corrected ambiguous graded-sale update SQL
- RC3/RC4: corrected price-history error handling and embedded grade rendering
- RC5: corrected hidden zero-grade production validation
- RC6: corrected grading-history display
- RC7: exposed supplier-payment workflow and refresh
- RC8: corrected nullable expense-payment notes handling
- RC9: made cash-flow KPI totals honor payment-method filtering; live affected test PASS

## 14. Backup/Recovery Review

- Staging/free plan: documented logical dump, isolated restore, row-count/financial/RLS/application verification; no PITR assumption
- Production: select the Supabase plan, retention, PITR decision, backup owner, logical-export schedule, and restore-test date before go-live

## 15. Production Readiness Gaps

- Real customer UAT and terminology/training feedback
- Production Supabase/Vercel values and Auth URLs
- Production backup/PITR decision and accountable operator
- Go-live date and 3-7 day parallel-run plan
- Approved handling of any historical receivables/payables

## 16. Production Checklist

1. Complete and sign off customer UAT; resolve any P0/P1 in staging.
2. Approve the first-customer opening-data worksheet, historical balance strategy, and go-live date.
3. Create/confirm separate production Supabase and Vercel projects.
4. Approve backup retention/PITR, take the pre-deploy backup, and record rollback owners.
5. Configure production public environment values, Auth URLs, SMTP, and hosted templates.
6. Dry-run all 12 migrations against production; review the exact plan.
7. Apply migrations in the approved window and deploy the matching commit.
8. Verify health, auth, RLS, role privacy, onboarding, core workflows, reports, exports, and audit.
9. Enter only approved opening data; do not fabricate historical transactions.
10. Run 3-7 days in parallel and reconcile birds, eggs, feed, debt, cash, and profit daily.
11. Create the final `v1.0.0` tag only after go-live approval.

## 17. Final Status

**STAGING UAT REOPENED — USER MANAGEMENT P1 BLOCKER**
