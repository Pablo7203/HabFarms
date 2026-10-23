# HabFarms logic and security review — 23 October 2026

This is a source-level review, not a certification of the production database or a complete end-to-end test. The checkout has 114 exported server actions, 95 migration files, no automated test files under `src`, and substantial pre-existing uncommitted changes. Do not deploy this checkout as an audit result without isolating and testing the intended changes.

## Verified architecture

- Production creation and updates, grading, egg sales, bird sales, payments, feed movements, and most expense operations call PostgreSQL procedures. These are better transaction boundaries than multi-step browser mutations.
- The egg-sale posting procedure locks per farm, checks customer and grade ownership, writes the sale and inventory movements together, and checks nonnegative dated grade balances. The admin correction procedure restores and rebuilds those movements in one transaction, then audits the correction.
- Server actions re-check authenticated roles; SQL procedures generally perform their own farm/role checks. This is necessary because server actions can be invoked directly, independently of UI controls.
- CSV cell escaping includes spreadsheet-formula neutralization. The app has security headers and a restrictive frame policy.

## Findings and follow-up

1. **High — daily and weekly summary procedures did not honor the selected farm.** `get_daily_farm_summary` and `get_weekly_farm_summary` in migration `202609120017_farm_performance_summaries.sql` select the caller's first active `farm_members` row. Their pages get the selected farm from the application context and combine that with these RPC results. Migration `202610230092_selected_farm_summaries.sql` now replaces that lookup with the selected-farm authorization helper. Both the old-to-new upgrade and already-repaired path passed in rollback-only transactions on local Supabase. It has not been applied to a remote database; two-farm/contrasting-role integration coverage remains required.
2. **High — receipt upload trusted broad `image/*` MIME and TypeScript-only source type.** `uploadPurchaseReceiptAction` now accepts only JPEG, PNG, GIF, and WebP with matching extension and file signature, validates `sourceType`/UUID at runtime, and checks the record's farm. Storage download behavior still needs an integration test before making receipts externally shareable.
3. **Medium — blank numeric input was silently converted to zero.** `z.coerce.number()` in production and sales validation accepted `""` and `null` as 0. A shared required-number validator now rejects blank inputs for core production quantities/costs, egg/bird sale lines/payments, feed and material purchase costs/payments, DOC daily deaths, and broiler dispatch amounts. The remaining schemas still need a field-by-field review: some zero defaults are intentional, but required fields must not coerce blank to zero.
4. **Medium — no database-backed business-invariant suite.** Initial automated tests now cover numeric validation, receipt validation and export pagination. Add database-backed tests for dated egg stock (including backdated edits), production-to-stock reconciliation, payment totals/due dates, feed cost replay, transfer reversal, farm isolation, and worker/admin role boundaries. Prioritize fixtures with two farms and a date between earlier production and later sales.
5. **Medium — platform portfolio/collections exports were limited to 100 rows.** Both exports now page through the RPC's 100-row cap using the same reusable pagination helper as payments. A 250-row pagination test passes.
6. **Low/operational — project-wide typecheck included archived copies.** Root `tsconfig` now includes the active app and Next config without the two nested copies. `tsc --noEmit` passes.

## Recommended sequence

Apply the selected-farm migration to a disposable database and verify users with two farms and contrasting roles. Next build integration tests for stock, sales, payments and transfers. Then consolidate repeated form-number and dated-ledger validation into shared modules; avoid replacing intentional empty/zero semantics blindly. Finally make a clean build and staging QA mandatory before any production promotion.
