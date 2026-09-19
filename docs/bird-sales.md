# Bird Sales

Bird Sales record birds sold directly from an active flock. They are not egg inventory transactions and do not represent processed-bird sales.

## Flow

Bird Sale → one `bird_sale` OUT movement → shared sales revenue → immediate cash payment or customer receivable → Collections/Cash Flow.

The commercial header is `sales`, with `sale_type = bird`. The bird-specific information is stored in `bird_sale_details` and links to its one authoritative bird movement.

## Categories

- Live Bird
- Spent Layer
- Cull Bird

Each category is commercial classification only. It never creates an extra cull or death movement.

## Population rule

The posting RPC locks the farm transaction, validates the flock's sale-date population from the movement ledger, creates exactly one `bird_sale` OUT movement, then validates the complete historical population timeline. A sale that would make any historical balance negative rolls back completely.

## Financial rule

`total = quantity × price_per_bird` using database numeric arithmetic. A full payment creates cash through the existing customer-payment model. An unpaid or partial amount requires sale-level credit terms and appears in Collections. Later payment increases cash without recording new revenue.

HabFarms does not yet model a bird cost basis, biological asset value, or bird-sale gross margin. Bird Sale revenue is reported without inventing cost of birds sold.

## Reporting and access

Bird Sales appear in the Sales list, customer collections, cash flow, and the dedicated Bird Sales report. The report can be filtered by date, flock, category, customer, and payment status. Admins and managers can record and review Bird Sales; workers cannot access commercial screens or invoke the posting RPC.

## Isolation

Bird Sales never create egg inventory movements, feed inventory movements, raw material movements, or processed-bird inventory. Lower future flock population naturally affects feed targets through the existing population ledger.

## Void

Only an admin can void a completed Bird Sale. Existing customer payments must be voided through the established payment workflow first. A Bird Sale void marks the sale voided and creates one linked IN reversal movement that restores population.
