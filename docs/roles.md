# Role matrix

| Capability | Admin | Manager | Worker |
|---|---:|---:|---:|
| Farm settings and users | Manage | No | No |
| Audit history | Read | No | No |
| Flocks and bird movements | Manage | Create/update | Operational access |
| Daily production | Create/update/delete | Create/update | Create current-day; own zero-cost edits |
| Egg inventory quantities | Read | Read | Read |
| Customers, sales, customer payments | Manage | Create/update/pay | No |
| Feed types, suppliers, purchases/payments | Manage | Create/update/pay | Quantity-only operational views where exposed |
| Opening feed, adjustments, wastage | Manage | Limited by RPC | No financial mutation |
| Health records | Manage | Create/update | Create zero-cost operational records |
| Expenses and payments | Manage | Create/update/pay | No |
| Cash adjustments | Create/void | Read cash flow | No |
| Financial reports and CSV | Read/export | Read/export | No |
| Operational production/health reports | Read/export | Read/export | Read/export without financial fields |

Database policies and RPC checks are authoritative if UI presentation ever differs.
