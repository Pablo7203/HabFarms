# Data model

- **Farm/Auth:** Supabase Auth users synchronize to `profiles`; `farm_members` assigns one farm role. `farms` and `farm_settings` hold configuration.
- **Flocks:** `flocks` plus dated `bird_movements` derive live-bird history.
- **Production:** one daily record per flock/date creates egg, feed, death, and cull movements atomically.
- **Egg inventory:** immutable-style movements are the source of truth; current stock is derived.
- **Sales:** sales and item snapshots recognize revenue; customer payments independently settle receivables.
- **Feed:** types, suppliers, purchases, payments, movements, and balances preserve physical quantity and weighted-average historical cost.
- **Health/Expenses:** health activity can generate a linked expense. Expenses and their payments remain separate.
- **Cash:** the ledger unifies active customer, feed, expense payments, and explicit cash adjustments with configured opening cash.
- **Reporting:** secure RPCs derive operational, profitability, and cash summaries from transaction sources.
- **Audit:** append-only `audit_logs` capture important mutations atomically without replacing source ledgers.
