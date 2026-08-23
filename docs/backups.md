# Backup strategy

Supabase managed backup availability and retention depend on the selected project plan; confirm the current plan before production and do not assume point-in-time recovery. The migration repository is required for schema reconstruction but is not a data backup.

Before production migrations and on an operational schedule, create an encrypted logical export in protected storage. With the installed CLI, a local drill uses:

```bash
pnpm supabase db dump --local --data-only --use-copy -f backup.sql
```

For a linked project, follow the current Supabase CLI documentation and project policy; never commit dumps because they contain farm and personal data. Restore into a new/staging database first, apply the matching migration version, import public data with supported PostgreSQL tooling, then run count, financial-value, RLS, authentication, and application smoke checks.

Auth identities live in the Supabase `auth` schema and require platform-supported backup/restore handling. A public-schema-only logical dump does not recreate login credentials. Test restores regularly and record the date, operator, source backup, target environment, checks, and outcome.

## Production v1.0.0 baseline

The production project is on the Supabase Free plan. Managed point-in-time recovery is not available as part of this release's confirmed recovery path. On 2026-08-23, immediately before go-live approval, linked logical exports were created at `backups/2026-08-23-prelaunch/schema.sql` and `backups/2026-08-23-prelaunch/data.sql`. Both files were verified non-empty; the directory is ignored by Git because the data export contains personal and farm data.

To recover, create an isolated Supabase project, apply the eight repository migrations through `202608230008`, import the matching public data export with supported PostgreSQL tooling, and then run the full security/runtime and application smoke suites before changing production traffic. Supabase Auth users and credentials are outside this public-schema dump and must be recovered through Supabase-supported Auth recovery or re-created through verified email. Never test a restore over the live production project or treat an untested logical export as point-in-time recovery.
