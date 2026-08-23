# Poultry Farm Management System — MVP v1.0

A secure, responsive management system for poultry layer farms. The MVP covers authentication and farm setup, roles and tenant isolation, flocks and bird movements, daily production, egg inventory, customers and sales, payments and receivables, feed inventory and weighted-average costing, health records, expenses and payables, cash flow, profitability, reports, CSV exports, and an append-only audit trail.

## Architecture

- Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS
- Supabase Auth, PostgreSQL, RLS, atomic `SECURITY DEFINER` transaction RPCs
- Transaction-derived inventory, receivable, payable, cash, and reporting views
- Vercel application deployment and Supabase managed database/Auth target

## Local setup

1. Install dependencies: `pnpm install`.
2. Copy `.env.example` to `.env.local` and add a local or staging Supabase URL and anon/publishable key.
3. Start Supabase: `pnpm supabase start`.
4. Rebuild deterministically: `pnpm supabase db reset`.
5. Run the application: `pnpm dev`.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

The application does not require a service-role key. Environment files are ignored except `.env.example`.

## Verification and build

Run `scripts/verify-sprint1-runtime.mjs` through `scripts/verify-sprint7-runtime.mjs`, followed by `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Runtime scripts are local-only: they create isolated QA users/farms and remove them afterward.

## Deployment

Use separate staging and production Supabase/Vercel projects. Configure exact Supabase Site URL, `/auth/callback`, confirmation, and password-reset redirects. Back up before migration, review `pnpm supabase db push --dry-run`, apply in a controlled window, deploy the matching application, verify `/api/health`, then complete the release checklist. HTTPS is mandatory and supplied by Vercel/Supabase.

## Documentation

- [Security](docs/security.md)
- [Roles](docs/roles.md)
- [Data model](docs/data-model.md)
- [Financial model](docs/financial-model.md)
- [Backups](docs/backups.md)
- [Recovery](docs/recovery.md)
- [Operations and deployment](docs/operations.md)
- [Production release checklist](docs/production-release-checklist.md)
