# Poultry Farm Management System — MVP v1.0 release checklist

## Before deployment

- [ ] Backup current production database and confirm recoverability/retention
- [ ] Review migration diff and target Supabase project
- [ ] Run Sprint 1–7 verification, lint, typecheck, build, dependency audit, and diff check
- [ ] Review Vercel environment variables; confirm no service-role key is needed
- [ ] Confirm Supabase Site URL, callback, confirmation, and password-reset URLs
- [ ] Complete staging deployment and approval

## Deploy

- [ ] Apply reviewed database migration in a controlled window
- [ ] Deploy the matching application revision
- [ ] Verify `/api/health`, login, onboarding protection, and dashboard

## Smoke test

- [ ] Authentication and farm isolation
- [ ] Production, sales/payment, feed, health, and expense controlled transactions
- [ ] Reports, CSV, cash flow, profitability, and audit event
- [ ] Worker financial privacy and admin settings

## After deployment

- [ ] Check application/Auth/database logs and error rate
- [ ] Confirm audit events and no cross-farm leakage
- [ ] Confirm managed backup status and next logical export/restore-test date
- [ ] Record release owner, time, migration version, smoke-test evidence, and rollback decision
