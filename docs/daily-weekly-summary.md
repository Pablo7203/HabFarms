# Daily and weekly farm summaries

Daily Summary answers what happened on one farm day. It reports flock-aware eligible birds, deaths, culls, closing birds, eggs collected, cracked eggs, saleable eggs produced, Hen-Day percentage, production allocation, end-of-day grade inventory, and feed consumption. Admins and managers additionally see revenue, cash collected, incurred expenses, operating production cost, and operating profit or loss.

Weekly Summary follows `farm_settings.reporting_week_start` and the farm timezone. Future dates do not contribute to expected days or hen-days. The completeness indicator compares distinct production-record dates with elapsed dates in the selected week, so a missing production day is visible rather than silently treated as zero production.

The weekly unit-economics section uses saleable eggs produced, not eggs sold. It separates feed purchase value from feed consumption cost and separates sales revenue from cash collected. Current grade price and margin are effective-dated values from the existing grade-price ledger.

Workers can view operational production and inventory information only. Commercial values, prices, costs, receivables, and operating results are omitted at the database summary layer.
