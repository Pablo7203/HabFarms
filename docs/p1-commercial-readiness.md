# P1 commercial readiness

## Hen-Day targets

Targets belong to a flock and are effective-dated. A target is valid only when greater than 0 and no more than 100. Saving a new target closes the previous open target period; historical records therefore retain the target that applied on their production date.

Actual Hen-Day is `eggs collected / eligible bird-days × 100`. Target reporting sums expected eggs (`eligible bird-days × effective target %`) day-by-day, then divides by target-covered bird-days. The result is a weighted target, never a simple average of flock percentages. Variance is expressed in percentage points. Untargeted bird-days are not silently assigned a target and target coverage is displayed.

## Raw-material accounting

Raw-material purchases increase inventory. They are not operating expenses. A purchase may be paid immediately, partially paid, or left on supplier credit. Cash moves only when a material-purchase payment is recorded; the payment appears in the shared Supplier Payables view and cash ledger. Changing materials into finished feed does not create a payable, cash movement, or duplicate expense. Feed cost is recognised through finished-feed consumption under the existing inventory costing model.

## Bird sales

A Bird Sale uses the existing sale, customer-payment, collections, cash-flow, and reporting architecture. It creates exactly one authoritative flock population reduction and does not touch egg or feed inventory. Cash sales create a customer payment immediately; credit and partial sales create the normal customer receivable. A void requires payments to be voided first, then restores population through an audited reversal movement.
