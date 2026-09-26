# Platform subscription invoices

Platform administrators can open **Platform → Subscriptions → customer subscription → Billing history → Invoice** for any recorded billing period. The invoice is rendered from the immutable billing-period price/plan/currency/date snapshots, the customer account contact, and posted payment allocations for that period. Voided periods remain labelled void; voided payments are excluded from the paid total.

Use **Download / print PDF** and choose **Save as PDF** in the browser print dialog. The invoice reference is derived from the billing-period UUID, so it is stable and can be traced back to its source record. No invoice or payment ledger row is created by viewing or printing it.

This first version generates a PDF-ready invoice for an administrator to send to the customer separately. It does not email invoices automatically, calculate or display tax/VAT, or include configured legal company address, tax registration, or bank/payment instructions because those fields are not currently part of Platform settings. Confirm those business details and any local invoicing requirements before treating the document as a formal tax invoice. The invoice route is protected by the Platform Admin boundary and reads Platform billing/customer metadata only; it does not access farm operational data.

## Manual one-off invoices

Open **Platform → Invoices → Create manual invoice**, choose a customer farm, enter the one-off description, amount/currency, invoice date, and due date, then issue it. The system assigns a sequential `HF-MI-YYYY-NNNNNN` reference and snapshots the current customer and issuer contact details. Issued invoices cannot be edited or deleted; if one was created in error, a Platform Admin must void it with a reason. The invoice and its audit events stay in the Platform control plane and do not create a subscription billing period, farm expense, payment, or cash entry. Manual invoice payment tracking and automatic email delivery are not included yet; this feature generates a PDF-ready file for separate sending.
