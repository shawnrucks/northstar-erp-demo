# Northstar Industrial Components ERP Demo

A functional, passive manufacturing ERP demonstration built for browser-driven administrative workflows. Northstar stores queues, records, approvals, exceptions, communications, tasks, reports, and immutable audit history; it contains no internal AI or business-process automation.

## Stack

- Next.js 16, React 19, TypeScript, and CSS
- SQLite via `better-sqlite3` (schema uses relational, migration-friendly records)
- Credentials login with scrypt password hashing and HTTP-only sessions
- Server-side role checks for primary mutations

## Start locally

```bash
npm install
cp .env.example .env.local
npm run db:setup
npm run dev
```

Open `http://localhost:3000`. Reset the deterministic demo at any time with `npm run db:reset`. Create a production bundle with `npm run build`, then run it with `npm start`.

## Demo accounts

All accounts use password `Demo123!`.

| Role | Email |
|---|---|
| Administrator | admin@northstar-demo.com |
| Sales Coordinator | sales@northstar-demo.com |
| Buyer | buyer@northstar-demo.com |
| Production Planner | planner@northstar-demo.com |
| Operations Analyst | operations@northstar-demo.com |
| Accounts Payable | ap@northstar-demo.com |
| Quality Specialist | quality@northstar-demo.com |

## Primary routes

- `/` — public Northstar website
- `/login` — employee credentials login
- `/erp/dashboard` — live operational dashboard
- `/erp/queues` — work queues
- `/erp/rfqs/RFQ-2026-1047` — missing-information workflow
- `/erp/quotes/QT-2026-1047` — margin approval and submission
- `/erp/purchase-orders/PO-10482` — supplier follow-up
- `/erp/material-shortages/MS-3021` — transfer and escalation
- `/erp/production-exceptions/PE-1187` — production exception
- `/erp/invoices/INV-SUM-8821` — three-way match exception
- `/erp/reports/daily-operations` — manual report creation and PDF export
- `/erp/audit-log` — immutable audit history

## Connected demo walkthrough

1. Sign in as Sales Coordinator, open `RFQ-2026-1047`, send the customer information request, and record revision C and packaging. Open `QT-2026-1047`; an Administrator can approve it, after which Sales can submit it.
2. Sign in as Buyer, open the PO Awaiting Confirmation queue, follow up on `PO-10482`, record a promised date, and create an expedite task.
3. Sign in as Production Planner, open `MS-3021`, create Fort Collins and Aurora transfer requests, create an expedite task, and escalate the remaining shortage. Update `PE-1187` with impact and estimated completion.
4. Sign in as Accounts Payable, open `INV-SUM-8821`, review the highlighted 7.63% unit-price variance, place it on hold, request buyer review, and request supplier credit.
5. Sign in as Operations Analyst, create a daily report, review its live metrics, enter narrative and decisions, finalize it, and export the PDF.
6. Review each record’s audit section or the global audit log for proof of work.

## Environment

`NORTHSTAR_DATABASE_PATH` selects the SQLite file. `SESSION_SECRET` is reserved for deployment session hardening. Never commit production secrets.

## Known limitations

This is a demonstration ERP, not an accounting, payroll, MRP, EDI, banking, machine-control, CAD, or finite-capacity scheduling system. Communications simulate sending and preserve the exact message; they do not deliver external email. The existing workspace also contains unrelated product demos, which are intentionally preserved.
