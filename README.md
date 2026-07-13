# Northstar Industrial Components ERP Demo

Northstar is a functional manufacturing ERP demonstration for browser-driven administrative workflows. It stores queues, records, approvals, exceptions, communications, tasks, reports, and append-only audit evidence. It contains no internal AI or automatic business-process completion.

## Architecture

- Next.js 16, React 19, and TypeScript
- PostgreSQL in production; isolated SQLite fallback for local development and tests
- Opaque, hashed database sessions in HTTP-only cookies
- Server-enforced module, record, action, role, and state-transition authorization
- Transactional workflow mutations and audit events
- Server-generated daily-operations PDF reports
- Controlled, audited demo reseeding with canonical database templates
- Vitest integration tests and Playwright E2E tests for workflows A–F, role isolation, and reseeding

## Local development

```bash
npm install
cp .env.example .env.local
npm run db:setup
npm run dev
```

Open `http://localhost:3000`. Reset the deterministic SQLite demo with:

```bash
npm run db:reset
```

## PostgreSQL

Set `DATABASE_URL`, then run:

```bash
npm run db:migrate:postgres
npm run db:seed:postgres
```

The migration runner uses checksums, transactions, and an advisory lock. The seed is idempotent and refreshes canonical reset templates. A CLI PostgreSQL reset requires both the explicit reset command and `ALLOW_DEMO_RESET=1`. The Administration UI uses a separate operator token, typed confirmation, cooldown, idempotency, locking, session revocation, and durable audit evidence.

See [db/README.md](db/README.md) for migration and Render details.

## Verification

```bash
npm run test:unit
npm run test:e2e
npm run build
```

The browser suite exercises authentication, route protection, and all connected workflows:

1. RFQ intake, customer-information request, costing, quote creation, approval, and submission
2. Supplier PO follow-up, confirmation, expedite task, and note
3. Inventory transfer request, shortage update, expedite, and escalation
4. Production exception ownership, customer-service task, and report inclusion
5. Invoice variance review, hold, buyer review, supplier credit request, and note
6. Daily report review, issue selection, draft save, finalization, and PDF export

## Demo accounts

All seeded accounts use `Demo123!` locally. Set `NORTHSTAR_DEMO_PASSWORD` before production seeding to override it.

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
- `/login` — employee login
- `/erp/dashboard` — operational dashboard
- `/erp/queues` — role-aware work queues
- `/erp/rfqs/RFQ-2026-1047` — RFQ workflow
- `/erp/quotes/QT-2026-1047` — costing and approval
- `/erp/purchase-orders/PO-10482` — supplier follow-up
- `/erp/material-shortages/MS-3021` — transfer and escalation
- `/erp/production-exceptions/PE-1187` — production exception
- `/erp/invoices/INV-SUM-8821` — three-way match exception
- `/erp/reports/daily-operations` — report creation and PDF export
- `/erp/audit-log` — operational audit history
- `/erp/admin` — administration reference and controlled demo reset

## Production deployment

`render.yaml` defines a Render Blueprint with a Starter web service and managed PostgreSQL:

- pre-deploy migration and idempotent seed
- health check at `/api/health`
- one shared PostgreSQL system of record
- Node.js 22

Required production variables:

```text
DATABASE_URL=<Render PostgreSQL private connection string>
NORTHSTAR_DEMO_PASSWORD=<demo password>
NORTHSTAR_DEMO_DATE=<YYYY-MM-DD>
NORTHSTAR_OPERATOR_RESET_TOKEN=<owner-only random token, at least 24 characters>
NORTHSTAR_DEMO_RESET_COOLDOWN_SECONDS=300
NODE_ENV=production
HOSTNAME=0.0.0.0
```

## Scope and limitations

This is a demonstration ERP, not a general ledger, payroll system, advanced MRP system, EDI gateway, payment processor, machine-control system, or CAD application. The six connected showcase workflows are the deepest paths; planning, shipping, quality inspections/nonconformances, purchase requisitions, document management, task lifecycle, bulk queues, and editable administration remain intentionally limited. Communications simulate sending and preserve message history; they do not deliver external email. Operational actions require explicit user interaction and never resolve themselves automatically.
