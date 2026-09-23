# HabFarms Market Readiness Audit

**Audit date:** 2026-09-23
**Environment tested:** authenticated HabFarms Staging (`https://habfarms-staging.vercel.app`)
**Audit mode:** read-only; no application, database, or deployment changes made
**Verdict:** **NOT READY FOR MARKET**

## Executive summary

HabFarms presents a coherent, well-styled farm-management product across the main operational areas, and the Staging DOC reporting data inspected reconciled for the selected synthetic UAT batch. Several ordinary routes loaded successfully and farm-operation screens generally fit narrow viewports in the browser checks.

This audit cannot clear the product for paid-customer onboarding. The deployed Staging version still has two reproducible rearing-report defects: an absent feed plan is represented as a zero plan with a positive variance, and an as-of date before a batch's arrival produces a generic failure instead of a not-yet-arrived result. The local working tree contains fixes in migrations 056/058 and the report UI, but the deployed Staging behavior shows those fixes are not present there. The Platform control-plane page also overflows horizontally at mobile widths. More importantly, required direct role/RLS, cross-farm, concurrency, complete layer workflow, recovery, and performance verification could not be performed with the single available account and lack of a verified Staging database test interface.

These are **confirmed defects** (the two report behaviors and mobile control-plane overflow) plus **verification gaps**, not evidence that a cross-tenant exploit or population corruption was found. The database-backed DOC report for one synthetic batch showed reconciled population/feed/cost/transfer totals; that limited observation does not substitute for the prescribed regression/security suite.

No Production environment was accessed. No form was submitted and no data was changed during this audit. The user had previously reported that the CSV download “looks great”; that is recorded as owner feedback, not an independently verified end-to-end export result.

## Follow-up fixes completed locally (2026-09-23)

The four findings below have been addressed in the local working tree:

- **F-01:** the existing forward migration returns `NULL` planned quantity/variance for feed with no effective target, while keeping actual consumption visible; the batch UI labels plan and variance as unavailable rather than zero.
- **F-02:** the lifecycle page detects a cutoff before batch arrival and skips the lifecycle RPC, showing a clear “Batch not yet arrived” state. The related migration keeps the authoritative as-of calculation date-valid for actual lifecycle dates.
- **F-03:** the Platform shell now uses a constrained single-column mobile grid and bounded horizontal navigation to stop the nav's intrinsic width expanding the document.
- **F-04:** transferred/closed or empty batches retain history but no longer present daily/feed/health/cost entry forms. The daily and edit routes also render read-only states on direct navigation. Existing database guards remain intact.

  A forward-only migration, `202609230059_rearing_closed_batch_auxiliary_guard.sql`, also extends the database guard to feed-plan and health-reminder writes and locks the batch row to serialize these writes with transfer status changes. The pgTAP contract now checks for those two triggers and the lock.

Local verification after these changes: `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass; `git diff --check` passes (Git emitted working-copy line-ending warnings). The first sandboxed build attempt hit `spawn EPERM`; the same build passed when rerun with the required process permission. There is no configured general application test script; Supabase CLI status was blocked because the CLI could not write its telemetry file outside the workspace, so the updated pgTAP test and migration replay were not run. These fixes are **not deployed to Staging** and have not been checked in the browser there. They do not close the separate role/RLS, tenant-isolation, workflow, export-content, concurrency, accessibility, performance, or operational verification gaps listed below.

## Installed skills and tools

| Discovered skill/tool | Intended purpose | Used? | Evidence / limitation |
| --- | --- | --- | --- |
| `browser:control-in-app-browser` | Inspect and interact with authenticated Staging | Yes | Read the skill and used the current signed-in session; route and viewport evidence is in `evidence/`. |
| `design-taste-frontend` | Visual design audit | Inspected; not applied | Its stated scope excludes dashboards/data tables; visual review used the live browser instead. |
| `playwright` | Terminal-driven end-to-end browser automation | Inspected; not used | In-app browser provided the authorized live session; no independent Playwright suite was configured in `package.json`. |
| `computer-use` | Windows application interaction | Not used | Redundant for this web audit; in-app browser was available. |
| Accessibility audit tool (axe/Lighthouse) | Automated WCAG and performance testing | Unavailable | No such installed skill/tool or project dependency was found. Accessibility review is heuristic, not WCAG certification. |
| Supabase/PostgreSQL security test tool | Direct RLS, role, concurrency and database testing | Unavailable in this session | No dedicated Supabase connector was exposed; local `.env.local` points to `127.0.0.1`, not the reported hosted project. No direct hosted DB tests were attempted. |
| Repository CLI/static inspection | Inspect routes, source, migrations, tests and configuration | Yes | Read-only `git`, `rg`, PowerShell and source review. |

The repo has `lint`, `typecheck`, `build`, `dev`, and `start` scripts but no general test script. The only discovered SQL test file is `supabase/tests/rearing_phase4_contract.test.sql`; its assertions do not constitute the full product, authorization, concurrency, or end-to-end regression matrix requested by the owner.

## Audit scope and environment

- Repository: `poultry-farm-app`, branch `main`, current `HEAD` `2e76a93262464881bb3b75cea359e0a3a58f372e`.
- The working tree is dirty with substantial pre-existing DOC, feed, health, reporting, migration, test, and other changes. These were preserved. This audit did not commit or alter application source.
- The source tree includes migrations through `202609230058_rearing_feed_variance_null_plan.sql`. This is source state, not proof that Staging has applied that migration.
- `.vercel/project.json` identifies the linked Vercel project as `habfarms-staging`. The only inspected Supabase URL in `.env.local` resolves to localhost (`127.0.0.1`); the hosted Supabase project identity and live migration history were therefore **not independently verified**. No secret values were printed.
- One authenticated Staging identity was available. The UI showed farm-admin context and also permitted opening `/platform`, so this session is not a clean Farm-Admin-only or Platform-Admin-without-farm-membership test identity.
- A synthetic batch marked `UAT ONLY` was inspected without mutation. Its observed state: 12 initial birds, 1 recorded death, 11 transferred in two partial transfers, 0 remaining; the two transfers summed to GHS 155. The batch had 1.000 kg of feed with GHS 5.00 consumption cost. The batch report/reconciliation showed population, feed quantity/cost, historical cost, transferred cost, remaining cost and movement totals reconciled for this record. This is one Staging fixture only, not a full lifecycle acceptance suite.
- Thirty-one farm/workspace/control-plane route-and-viewport entries were checked (including seven responsive widths); pages loaded without a persistent route error. This verifies reachability/rendering only, not each workflow's submission semantics.
- No Production URL, credentials, project, or data were accessed.

## UI/UX, responsive design and accessibility

The established sage/white visual system is reasonably consistent across the pages inspected. The navigation separates production, flock, feed, health, finance and rearing operations in a way that is understandable after entry. The active page title and main actions were generally discoverable. No form submissions, onboarding journey, or new-user registration were attempted because the only available identity was an existing signed-in account and creating test data was outside the read-only audit.

Viewport DOM checks covered 360×800, 375×812, 390×844, 768×1024, 1024×768, 1440×900 and 1920×1080 for the inspected routes. Farm-operational pages had no document-level horizontal overflow in those checks. The `/platform` route did: at a 375 CSS-pixel viewport, `document.documentElement.scrollWidth` measured 1354 px. The control-plane navigation flex row expands its parent/grid and pushes the main content beyond the screen; horizontal scrolling the nav itself does not constrain the overall layout. This is a confirmed responsive defect (P2). Evidence: `evidence/responsive-all-routes.json` and `evidence/responsive-heuristics.json`.

Basic DOM heuristics found visible labels for interactive controls and no unnamed visible buttons on the principal farm screens tested after excluding hidden form-action inputs. The report-data route sometimes rendered a loading state during the short capture interval; it settled on retry. Some touch targets were measured below the 44 px WCAG target heuristic on dashboard, flock, rearing, feed, and related screens. No axe run, keyboard-only flow, focus-trap test, screen-reader test, or contrast audit was available; WCAG 2.2 AA is **not verified**.

Screenshots include dashboard, production, flocks, rearing, feed, health, reports, expenses, collections, settings and other major destinations in `evidence/`. Browser screenshot dimensions reflect the viewport/capture implementation and scrollbar; filenames are descriptive, not claims of pixel-exact device emulation. The report-error screenshot is `evidence/staging-asof-prearrival-2026-09-22-1440x900.jpg`.

## Confirmed findings

### F-01 — No-plan feed variance is incorrectly shown as a positive variance

- **Affected area:** rearing batch detail, planned-versus-actual feed panel.
- **Severity:** P2 — Medium.
- **Steps:** Open the inspected `UAT ONLY` rearing batch with no configured feed target and a recorded 1.000 kg feed movement.
- **Expected:** Actual remains visible; planned quantity and variance are “not configured”/unavailable, not zero and not a computed variance.
- **Actual:** Staging displayed “No feed target configured” while the row showed “Planned 0.000 kg · Actual 1.000 kg” and `Variance +1.000 kg`.
- **Evidence:** Current rendered batch captured in `evidence/staging-rearing-batch-full-1440.jpg`; corresponding local unshipped fix is migration `202609230058_rearing_feed_variance_null_plan.sql` and null-aware UI in `src/app/(app)/rearing/[batchId]/page.tsx`.
- **Impact:** Misleads owners into thinking a plan exists and consumption exceeded it; weakens trust in feed planning/reporting.
- **Recommended fix:** Apply the reviewed forward migration and deploy the matching app build to Staging; verify configured and unconfigured target cases at the UI and CSV/report layers. The code fix is present locally but was not deployed or re-tested on Staging during this audit.

### F-02 — Pre-arrival lifecycle as-of report is treated as a ledger failure

- **Affected area:** `/rearing/reports`, selected-batch lifecycle cutoff.
- **Severity:** P2 — Medium.
- **Steps:** Select the UAT batch arriving 2026-09-23 and request lifecycle `asOf=2026-09-22`.
- **Expected:** Explain that the batch had not yet arrived; show lifecycle metrics as not applicable without inferring zero balances. Period activity may be evaluated separately.
- **Actual:** The lifecycle panel showed a generic “could not load all ledger data” failure and warned against treating totals as reconciled.
- **Evidence:** `evidence/staging-asof-prearrival-2026-09-22-1440x900.jpg`. Local source contains the intended boundary handling in migration `202609230056_rearing_phase4_as_of_summary.sql` and `src/app/(app)/rearing/reports/page.tsx`; it is not reflected in current Staging behavior.
- **Impact:** A valid historical cutoff appears to be a system/reporting error and leaves historical review ambiguous.
- **Recommended fix:** Deploy the aligned migration and application code; verify dates before arrival, on arrival, between events, and after transfers, including export values.

### F-03 — Platform management layout overflows on phone/tablet widths

- **Affected area:** `/platform` control-plane dashboard and navigation.
- **Severity:** P2 — Medium; applies to Platform Admins rather than routine farm workers.
- **Steps:** Open `/platform` and set viewport to 375×812.
- **Expected:** Page content remains within viewport; any horizontal navigation scroll stays contained to its nav region.
- **Actual:** Root document scroll width was 1354 px at 360 px content width. The platform nav flex row has a 1329 px layout width and expands the layout grid, leaving page content pushed far offscreen.
- **Evidence:** Exact live DOM measurements are in `evidence/responsive-all-routes.json` (route `/platform`, narrow widths).
- **Impact:** Control-plane tasks are effectively unusable on mobile and can make operators overlook content.
- **Fix status:** Implemented locally by constraining the single-column grid/sidebar/nav track (`min-width: 0` and bounded nav overflow). Still requires deployment and retest at 360, 375, 390 and 768 px.

### F-04 — Closed/transferred batch detail still presents operational entry controls

- **Affected area:** rearing batch detail after full transfer.
- **Severity:** P3 — Low, since backend guards reject the core record writes.
- **Steps:** Open a transferred batch with zero birds.
- **Expected:** Historical records remain readable; new mortality/feed/health/expense controls should be absent or clearly disabled with an explanation.
- **Actual:** The page still renders operational forms/actions. Migration `202609230046_rearing_phase3_transfers.sql` defines `guard_closed_rearing_batch_operations()` triggers on feed-consumption, health and expense inserts which reject rows for `transferred`/`closed` batches; therefore the visible controls are dead ends rather than a demonstrated ledger bypass. The batch page also renders feed-plan and reminder controls; these do not post feed/cost/population ledgers but could create confusing future configuration.
- **Evidence:** `evidence/staging-rearing-batch-full-1440.jpg`; guard implementation in `supabase/migrations/202609230046_rearing_phase3_transfers.sql`.
- **Impact:** Users can waste effort entering records that fail at save and may not understand why.
- **Fix status:** Implemented locally: operational forms are hidden when the batch has no live birds or is closed/transferred; daily/edit direct routes provide a read-only state. Historical links and backend guards remain. Direct RPC denial still needs integration-test evidence.

## Security and tenant isolation

**No confirmed cross-tenant data exposure was observed. Security clearance is incomplete.** The one available account could open the Platform control-plane route and a farm workspace, so it cannot prove the Platform Admin/customer boundary or a farm-admin-only permission contract. No Farm A/Farm B pair, Worker, Manager, anonymous, unrelated user, or suspended-farm identity was available. Direct Supabase queries/RPCs, server-action financial response shaping, storage access, and exports under restricted identities were not exercised.

Static review found privileged Supabase access sourced from server-side configuration and role checks/RLS-oriented functions in the migrations; this is not equivalent to verifying hosted RLS policies, grants, or identity behavior. The project has a CSP configured in `next.config.ts` but it includes `unsafe-inline` for scripts/styles; live response headers, cookie attributes, cache behavior and CORS were not verified. No automated dependency audit or penetration scan was run. No secrets were included in this report or artifacts.

Required next tests: dedicated Admin/Manager/Worker accounts in at least two isolated Staging test farms; attempt reads and writes via UI and direct authenticated RPC/API routes; inspect financial payloads; test Platform Admin without farm membership; verify suspended-farm mutations fail; exercise storage and filtered exports. These are **unverified**, not passes and not confirmed vulnerabilities.

## Workflow and data-integrity results

| Area | Result | What the evidence does and does not establish |
| --- | --- | --- |
| Route reachability | Partial pass | Primary destinations opened; no persistent route failure. Does not prove forms or business effects. |
| DOC population, transfers, cost | Partial pass | One synthetic Staging batch's displayed report/reconciliation sums agreed (12 initial, 1 death, 11 transferred, zero remaining; GHS 155 total transferred/historical cost). Not a full controlled lifecycle replay. |
| Feed plan variance | Fail | F-01 confirmed on deployed Staging. |
| Historical as-of before arrival | Fail | F-02 confirmed on deployed Staging. |
| CSV download | Owner-reported good; independently unverified | No fresh download was initiated/parsed and compared to source totals in this audit. |
| Layer workflow (flock → production → inventory → sale → payment → balance) | Not tested | No mutation performed; no dedicated fixture/test identities. |
| Feed WAC / Make Feed / shared inventory regression | Not tested end-to-end | Pages inspected; no transactions submitted. |
| Role/RLS / tenant isolation | Not tested | No dedicated identities or verified remote DB test path. |
| Concurrency / duplicate submission | Not tested | No concurrent independent database sessions. |
| Recovery/restore/observability | Not tested | No safe disposable restore environment or operational access evidence. |

## Test and quality-gate inventory

- Existing automated scripts: `pnpm lint`, `pnpm typecheck`, `pnpm build`; no `pnpm test` script.
- Existing test file: one DOC Phase 4 SQL contract test, reported as 13 planned assertions in the prior implementation handoff. This audit did not rerun pgTAP or a clean migration replay because the local configured Supabase URL points to `127.0.0.1` and no isolated test database was started. The original local QA database was left untouched.
- Previous-turn quality gates (typecheck/lint/build/diff-check) were reported passing, but were not independently rerun for this audit. They do not establish market readiness.
- No full product/regression test count can truthfully be reported. Security, cross-tenant, concurrency, CSV parsing/total comparison, complete DOC end-to-end and core layer transaction tests remain unverified.
- No Staging migrations or app deployment were made. The `.vercel` link confirms the Staging Vercel project, but the linked Supabase project and currently applied remote migration number were not verified from a safe authenticated database source.

## Product quality scorecard

Scores are evidence-weighted audit confidence/quality ratings, not a substitute for release gates.

| Category | Score | Status | Evidence |
| --- | ---: | --- | --- |
| Visual design and consistency | 7/10 | Partially verified | Major operational pages look coherent; only browser-visible routes sampled. |
| Navigation and information architecture | 7/10 | Partially verified | Main destinations loaded and grouped sensibly; restricted-role nav not tested. |
| Mobile usability | 6/10 | Partially verified | Farm pages had no root overflow in DOM checks; Platform page has confirmed severe horizontal overflow and some small targets. |
| Accessibility | 5/10 | Not fully tested | Basic labels/buttons heuristic only; no WCAG scanner, keyboard, screen-reader or contrast audit. |
| Onboarding and ease of use | 4/10 | Not tested | Existing signed-in session only; registration/new-farm setup not walked. |
| Functional completeness | 6/10 | Partially verified | Many routes render; several report defects confirmed, workflows not submitted. |
| Data integrity | 6/10 | Partially verified | One DOC dataset reconciled; major layer/feed/cash/concurrency flows not exercised. |
| Application security | 4/10 | Not tested | Static review only; no direct identity/API tests. |
| Multi-tenant isolation | 3/10 | Not tested | No two-farm identity pair or authenticated database testing. |
| Performance | 3/10 | Not tested | No Lighthouse/Web Vitals, load profile, or query performance run. |
| Reporting and exports | 6/10 | Partially verified | DOC reconciliation page rendered; two report defects confirmed; user says CSV looks good but export contents were not parsed. |
| Operational readiness | 4/10 | Not tested | Deployment/rollback, backup restoration, alerts, support and incident processes not verified. |

## Prioritized remediation and acceptance plan

1. **Close F-01/F-02 in Staging** by deploying only the reviewed matching application/migration state, then rerun feed plan/no-plan and pre-arrival/as-of scenarios including CSV parity.
2. **Fix F-03** and repeat the seven prescribed viewport checks for Platform, as well as farm views.
3. **Use dedicated Staging test identities and a disposable test farm** to execute direct Admin/Manager/Worker/anonymous/cross-farm/Platform Admin/suspended-account checks before commercial release.
4. **Run the real transaction suite** for layer flock, production, egg inventory/sale/payment, shared feed/WAC/Make Feed, DOC full lifecycle, safe/unsafe transfer reversal, and independent concurrent stock/population operations. Compare ledger source totals, reports and CSVs.
5. **Run independent accessibility and performance checks** and test login/onboarding in a clean identity. Keep manual Product Owner acceptance for business language and usability.
6. **Verify operational controls** (backup/restore procedure, monitoring/alerts, support and rollback) using non-production disposable resources.

## Product Owner acceptance checklist

- [ ] Re-test no-plan feed display after the fix reaches Staging: actual quantity visible, planned/variance explicitly unavailable.
- [ ] Re-test lifecycle cutoffs before arrival, on arrival, and after later movement; ensure the old transfer snapshot is unchanged by later costs.
- [ ] Review Platform on phone after responsive fix.
- [ ] Download and inspect populated CSVs and reconcile totals to on-screen values.
- [ ] Have authorized test identities cover Worker privacy, Manager permissions, cross-farm denial, Platform Admin boundary and suspended-account denial.
- [ ] Complete the end-to-end layer and DOC business workflows in a dedicated Staging test farm.

## Market-readiness verdict

**NOT READY FOR MARKET**

The reason is not a claim that HabFarms has a proven tenant breach or that its DOC ledger is corrupt. Rather, two reporting defects are reproduced in the deployed Staging experience, the Platform Admin mobile screen has a reproducible layout failure, and mandatory tenant-security, financial-privacy, regression, core layer workflow, concurrency, export-content, performance and operational-recovery checks are not established by the available evidence. Under the requested decision rules, missing mandatory security/workflow verification cannot be treated as a pass. No Production changes were made.
