# Data model

- **Farm/Auth:** Supabase Auth users synchronize to `profiles`; `farm_members` assigns one farm role. `farms` and `farm_settings` hold configuration.
- **Flocks:** `flocks` plus dated `bird_movements` derive live-bird history.
- **Production:** one daily record per flock/date creates egg, feed, death, and cull movements atomically.
- **Egg inventory:** immutable-style movements are the source of truth; current stock is derived.
- **Egg grades:** each farm has one canonical `egg_grades` lookup. `Unsorted` means produced but not yet graded; sellable sizes are Smaller, Small, Medium, Large, and Bigger. Grade movements and sales never borrow stock from another grade.
- **Production integrity:** production records use the flock's eligible pre-loss population on the record date. Collected eggs cannot exceed that population, so a normal daily Hen-Day result cannot exceed 100%.
- **Sales:** sales and item snapshots recognize revenue; customer payments independently settle receivables.
- **Feed:** types, suppliers, purchases, payments, movements, and balances preserve physical quantity and weighted-average historical cost.
- **Health/Expenses:** health activity can generate a linked expense. Expenses and their payments remain separate.
- **Cash:** the ledger unifies active customer, feed, expense payments, and explicit cash adjustments with configured opening cash.
- **Reporting:** secure RPCs derive operational, profitability, and cash summaries from transaction sources.
- **Farm performance summaries:** `get_daily_farm_summary` and `get_weekly_farm_summary` are derived, role-aware summary layers. They do not store editable KPI snapshots.
- **Audit:** append-only `audit_logs` capture important mutations atomically without replacing source ledgers.
