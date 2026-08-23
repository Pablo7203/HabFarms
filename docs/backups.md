# Backup strategy

Supabase managed backup availability and retention depend on the selected project plan; confirm the current plan before production and do not assume point-in-time recovery. The migration repository is required for schema reconstruction but is not a data backup.

Before production migrations and on an operational schedule, create an encrypted logical export in protected storage. With the installed CLI, a local drill uses:

```bash
pnpm supabase db dump --local --data-only --use-copy -f backup.sql
```

For a linked project, follow the current Supabase CLI documentation and project policy; never commit dumps because they contain farm and personal data. Restore into a new/staging database first, apply the matching migration version, import public data with supported PostgreSQL tooling, then run count, financial-value, RLS, authentication, and application smoke checks.

Auth identities live in the Supabase `auth` schema and require platform-supported backup/restore handling. A public-schema-only logical dump does not recreate login credentials. Test restores regularly and record the date, operator, source backup, target environment, checks, and outcome.
