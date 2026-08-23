# Operations

## Local work

```bash
pnpm install
pnpm supabase start
pnpm supabase db reset
pnpm dev
```

Stop with `pnpm supabase stop`. Verify with the Sprint 1–7 scripts, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
Final migration verification performs two clean resets so deterministic replay is proven twice.

## Production migration and deployment

Back up first. Review every migration and target project, then use the installed CLI workflow: `pnpm supabase link --project-ref <ref>`, `pnpm supabase db push --dry-run`, review, and `pnpm supabase db push` in a controlled window. Never migrate automatically during app startup. Configure Vercel environment variables, Supabase Site URL and exact callback/reset URLs, deploy, verify `/api/health`, login, dashboard, and non-destructive domain smoke tests.

Use a staging Supabase project and Vercel deployment before production. HTTPS is provided by the platforms. Keep production and staging credentials separate.

## Diagnosis

Use the user-visible reference ID and structured server log entry to correlate unexpected failures. Check Vercel function logs, Supabase database/Auth logs, audit history, health status, and the last deployment/migration. Logs must use IDs rather than credentials, contact details, notes, or payment references.

For migration failure, data corruption, restore, and access incidents follow `recovery.md`. Do not directly edit derived balances; correct source transactions through supported void/reversal workflows.
