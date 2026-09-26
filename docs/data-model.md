# Data model

- **Farm/Auth:** Supabase Auth users synchronize to `profiles`; `farm_members` assigns one farm role. `farms` and `farm_settings` hold configuration.
- **Flocks:** `flocks` plus dated `bird_movements` derive live-bird history. Movement writes lock the flock and a deferred database constraint validates the full chronological balance, including direct database writes; a decrease cannot take the flock below zero. Opening-population corrections remain admin-only and revalidate that history.
- **Production:** one daily record per flock/date creates egg, feed, death, and cull movements atomically.
- **Egg inventory:** immutable-style movements are the source of truth; current stock is derived.
- **Egg grades:** each farm has one canonical `egg_grades` lookup. `Unsorted` means produced but not yet graded; sellable sizes are Smaller, Small, Medium, Large, and Bigger. Grade movements and sales never borrow stock from another grade.
- **Production integrity:** production records use the flock's eligible pre-loss population on the record date. Collected eggs cannot exceed that population, so a normal daily Hen-Day result cannot exceed 100%.
- **Sales:** `sales` is the commercial header for both egg and bird sales. Egg item snapshots recognize egg revenue; a Bird Sale has `sale_type = bird` and exactly one `bird_sale_details` row linked to one authoritative `bird_movements` OUT movement. Customer payments independently settle receivables for either sale type.
- **Feed:** types, suppliers, purchases, payments, movements, and balances preserve physical quantity and weighted-average historical cost.
- **Health/Expenses:** health activity can generate a linked expense. Expenses and their payments remain separate.
- **Cash:** the ledger unifies active customer, feed, expense payments, and explicit cash adjustments with configured opening cash.
- **Reporting:** secure RPCs derive operational, profitability, and cash summaries from transaction sources.
- **Farm performance summaries:** `get_daily_farm_summary` and `get_weekly_farm_summary` are derived, role-aware summary layers. They do not store editable KPI snapshots.
- **Audit:** append-only `audit_logs` capture important mutations atomically without replacing source ledgers.
- **Platform analytics:** Platform-only RPCs derive SaaS portfolio, dashboard, trial, renewal, and subscription-collections views from tenant-account, subscription, billing-period, Platform-payment, invitation, onboarding, membership, and Platform-audit records. They never query farm operational or farm-financial ledgers and preserve each currency separately.
