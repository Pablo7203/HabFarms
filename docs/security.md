# Security architecture

The MVP uses Supabase Auth, server-verified sessions, PostgreSQL row-level security (RLS), and transaction RPCs. Every farm-owned business table is isolated by active membership. Admin, manager, and worker permissions are enforced in routes, server actions, RPCs, and RLS; the database is authoritative.

`SECURITY DEFINER` functions use `set search_path=''`, fully qualified objects, `auth.uid()` for caller identity, active farm membership checks, and explicit role checks. PUBLIC execution is revoked. Only user-facing functions are granted to `authenticated`; trigger and integrity helpers are not callable. The repeatable Sprint 7 verifier inventories every definer function and its grants.

Admins can read their farm's append-only audit history. Managers and workers cannot read it. No application role can insert, update, truncate, or delete audit rows. Audit triggers run in the same database transaction as mutations, so a rollback also rolls back its event. Metadata is deliberately limited to IDs, names, numbers, amounts, roles, and statuses; credentials, tokens, free-form notes, contact fields, and payment references are excluded.

Workers can access operational flock, production, inventory quantity, and non-financial health workflows. They cannot access sales values, receivables, purchase costs, WAC/inventory value, expenses, profitability, cash flow, or audit history. Void/reversal workflows preserve source transactions and remove their active financial or inventory effect without destructive history edits.

Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable/anon key are browser-visible. The application does not use a service-role key. Secrets belong in Vercel/Supabase environment configuration and must never be logged or committed. HTTPS is mandatory outside localhost. Platform rate protection is used for public authentication endpoints; authenticated forms disable repeat submission and database constraints/locking provide authoritative protection.

## Privileged-function inventory policy

| Function category | Purpose | Allowed role | Farm validation | Execute grant |
|---|---|---|---|---|
| Auth triggers | Profile lifecycle | Database trigger only | Auth row | None |
| Integrity helpers | Membership, balances, reconciliation | Called by trusted SQL/RPC | Explicit farm/record | None unless an RLS policy requires authenticated execution |
| Mutation RPCs | Atomic business transactions | Admin/manager/worker per domain | Active membership and affected-record farm | `authenticated` |
| Report RPCs | Farm-scoped derived summaries | Admin/manager; production allows worker | Active membership | `authenticated` |
| Audit trigger | Atomic append-only audit | Database trigger only | Derived from affected row | None |

The machine-readable authoritative inventory is produced from `pg_proc`, `pg_namespace`, and `information_schema.routine_privileges` by `scripts/verify-sprint7-runtime.mjs`.
