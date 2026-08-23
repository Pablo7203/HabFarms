# Financial model

This is a management operating model, not statutory accounting.

- Revenue is recognized from completed sales. A customer payment is a cash receipt. A GHS 500 sale paid GHS 200 creates GHS 500 revenue, GHS 200 inflow, and GHS 300 receivable.
- An expense is incurred when recorded. An expense payment is cash outflow. A GHS 300 utility bill paid GHS 100 creates GHS 300 operating cost, GHS 100 outflow, and GHS 200 payable.
- A feed purchase increases inventory and supplier liability; it is not immediately feed cost. Buying GHS 1,000 of feed and consuming GHS 250 at weighted-average cost records GHS 250 operating feed cost while remaining feed stays inventory.
- Profit is revenue less feed consumption, feed wastage, and other incurred operating expenses. Cash flow is payments plus explicit cash adjustments. They intentionally differ.
- Owner capital is a cash inflow, not revenue. Owner withdrawal is a cash outflow, not an expense.
- Inventory is an asset-like management balance and becomes operating cost through consumption or wastage, not merely through payment.

PostgreSQL `numeric` values are authoritative. Money displays with two decimals; feed quantities and weighted-average cost retain their configured higher precision.
