# DOC / Pullet Rearing — Phase 1

## Implementation boundaries

| Decision | Scope |
| --- | --- |
| Reuse | Existing farm membership/roles, suppliers, audit log, date/timezone conventions, UI shell and form patterns. |
| Extend | Main farm navigation with a Rearing section; audited actions and mobile-responsive operations screens. |
| New | Farm-scoped rearing batches, daily records, and a separate authoritative rearing-movement ledger with RLS and atomic RPCs. |
| Defer | Feed consumption/planning attribution, medication and vaccination linkage, rearing costs, point-of-lay transfer, commercial pullet sales, and transfer lineage. |

Layer population remains `flocks.initial_birds + bird_movements`; rearing uses its own ledger and does not enter layer-production denominators, egg stock, or layer-feed calculations. Creating a batch posts the initial quantity once as an arrival movement. The stored `initial_quantity` is a cohort reference, not an additional balance component.

## Age convention

Age is elapsed calendar days. When a hatch date is supplied, it is the age basis; otherwise the UI explicitly reports days since arrival. One week is seven elapsed days, displayed as whole weeks plus remaining days. Hatch date must not be later than arrival date. Arrival and daily-event dates use the farm timezone; a completed daily record cannot be future-dated.

## Population and correction rules

Movement order is event date, then arrival before non-arrival entries, then creation timestamp and ID. A batch row is locked while a daily record or correction is posted, preventing concurrent over-death entries. Every accepted history is checked for nonnegative running population. One daily record exists per batch and date; zero deaths is valid and creates no mortality movement. A changed mortality is corrected with an immutable linked reversal and, when needed, a replacement death movement. Editing observations without changing deaths does not create population movements.

Workers may create daily records for the farm's current date. Admins and managers may create historical records and correct existing records. Only admins and managers create batches, change batch details, or set lifecycle stage. Stage changes are explicit and audited; Ready for Transfer is an operational designation only and never transfers birds.

## Database migration

Apply `supabase/migrations/202609230039_rearing_phase1.sql` before deploying the UI. The migration is tenant-scoped, grants authenticated users read-only table access through RLS, and reserves writes for controlled security-definer RPCs. Cross-farm supplier and batch references are constrained in PostgreSQL. Platform administration remains separate from tenant operational data.

## Verification checklist

- Create 1,020 chicks: one batch, one +1,020 arrival movement, and no change to layer-flock population.
- Reject zero, negative, fractional quantities; duplicate code within a farm; hatch date after arrival; a supplier from another farm; and future arrival.
- Allow the same batch code in a different farm.
- Record 8 deaths, then 5: expect 1,007 birds and 13 net deaths from a 1,020 opening batch.
- Record zero deaths: the daily record is present and movement balance is unchanged.
- Reject negative/fractional deaths, deaths above date-specific availability, a date before arrival, a future date, duplicate batch/date, and a backdated event that makes a later population negative.
- Correct a 5-death record to 3: expect a linked +5 reversal and -3 replacement, net current population +2, plus both audit actions. Edit only the observations: no movement should be added.
- Submit overlapping mortality from two sessions against a small balance: the serialized result must never be negative and one unsafe request must fail.
- Verify workers can enter today's daily record but cannot create a batch, change stage, or correct a saved record; managers/admins can perform their allowed actions.
- Verify all four target viewports and confirm layer Dashboard, Hen-Day, eggs, and feed figures remain unchanged when rearing batches are created.

The checklist still requires execution against a migrated local or staging database and authenticated role accounts; static build checks alone do not count as staging UAT.
