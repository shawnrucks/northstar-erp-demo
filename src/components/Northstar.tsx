"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Role =
  | "ADMIN"
  | "SALES_COORDINATOR"
  | "BUYER"
  | "PRODUCTION_PLANNER"
  | "OPERATIONS_ANALYST"
  | "ACCOUNTS_PAYABLE"
  | "QUALITY_SPECIALIST";

type NavItem = {
  label: string;
  href: string;
  roles: Role[];
};

const allRoles: Role[] = [
  "ADMIN",
  "SALES_COORDINATOR",
  "BUYER",
  "PRODUCTION_PLANNER",
  "OPERATIONS_ANALYST",
  "ACCOUNTS_PAYABLE",
  "QUALITY_SPECIALIST",
];

const nav: NavItem[] = [
  { label: "Dashboard", href: "/erp/dashboard", roles: allRoles },
  { label: "Customers", href: "/erp/customers", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "RFQs & Quotes", href: "/erp/rfqs", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "Sales Orders", href: "/erp/sales-orders", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "Production Planning", href: "/erp/production-planning", roles: ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"] },
  { label: "Work Orders", href: "/erp/work-orders", roles: ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "QUALITY_SPECIALIST"] },
  { label: "Purchasing", href: "/erp/purchase-orders", roles: ["ADMIN", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE"] },
  { label: "Suppliers", href: "/erp/suppliers", roles: ["ADMIN", "BUYER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE", "QUALITY_SPECIALIST"] },
  { label: "Inventory", href: "/erp/inventory", roles: ["ADMIN", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST", "QUALITY_SPECIALIST"] },
  { label: "Quality", href: "/erp/quality/holds", roles: ["ADMIN", "QUALITY_SPECIALIST", "OPERATIONS_ANALYST"] },
  { label: "Shipping", href: "/erp/shipping", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "Invoices", href: "/erp/invoices", roles: ["ADMIN", "ACCOUNTS_PAYABLE", "BUYER", "OPERATIONS_ANALYST"] },
  { label: "Work Queues", href: "/erp/queues", roles: allRoles },
  { label: "Reports", href: "/erp/reports/daily-operations", roles: allRoles },
  { label: "Audit Log", href: "/erp/audit-log", roles: allRoles },
  { label: "Administration", href: "/erp/admin", roles: ["ADMIN"] },
];

export function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const value = String(children);
  const resolvedTone = tone ||
    (/HOLD|PAST|EXCEPTION|URGENT|ESCALATED|REJECTED/.test(value)
      ? "red"
      : /APPROVED|ACTIVE|FINAL|CONFIRMED|COMPLETE/.test(value)
        ? "green"
        : /AWAITING|MISSING|PENDING|HIGH|REVIEW/.test(value)
          ? "amber"
          : "blue");
  return <span className={`ns-badge ${resolvedTone}`}>{value.replaceAll("_", " ")}</span>;
}

export function NorthstarShell({ user, children }: { user: { name: string; email: string; role: Role }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = nav.filter((item) => item.roles.includes(user.role));

  async function logout() {
    await fetch("/api/northstar/login", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={`ns-shell ${mobileOpen ? "mobile-open" : ""}`}>
      <aside aria-label="ERP navigation">
        <Link href="/erp/dashboard" className="ns-logo" onClick={() => setMobileOpen(false)}>
          <span aria-hidden="true">N</span>
          <b>Northstar<small>INDUSTRIAL COMPONENTS</small></b>
        </Link>
        <nav>
          {visibleNav.map((item) => (
            <Link
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              className={pathname.startsWith(item.href) ? "active" : ""}
              href={item.href}
              key={item.label}
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ns-user">
          <span aria-hidden="true">{user.name.split(" ").map((part) => part[0]).join("")}</span>
          <div><b>{user.name}</b><small>{user.role.replaceAll("_", " ")}</small></div>
          <button onClick={logout}>Log out</button>
        </div>
      </aside>
      <main>
        <header>
          <button className="ns-menu-button" aria-label="Toggle navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>☰</button>
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim()) router.push(`/erp/search?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <span aria-hidden="true">⌕</span>
            <label className="sr-only" htmlFor="global-search">Global record search</label>
            <input
              id="global-search"
              data-testid="global-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search RFQ, PO, work order, invoice, customer, supplier or SKU…"
            />
          </form>
          <div className="ns-header-user">
            <b>{user.name}</b>
            <small>{user.role.replaceAll("_", " ")} · Denver Manufacturing</small>
          </div>
          <button aria-label="Notifications">●</button>
        </header>
        {children}
      </main>
      {mobileOpen && <button className="ns-nav-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    </div>
  );
}

type ActionField = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
};

export function Action({ number, action, label, fields = [], tone = "primary" }: {
  number: string;
  action: string;
  label: string;
  fields?: ActionField[];
  tone?: "primary" | "secondary" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);

  async function send(values: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/northstar/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ number, action, ...values }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || "The action could not be completed.");
      return;
    }
    setMessage("Saved successfully");
    window.setTimeout(() => window.location.reload(), 450);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send(Object.fromEntries(new FormData(event.currentTarget)));
  }

  const testId = `${number.toLowerCase()}-${action}-button`;
  return (
    <>
      <button className={`ns-button ${tone}`} data-testid={testId} onClick={() => fields.length ? setOpen(true) : send()}>
        {label}
      </button>
      {message && !open && <span role="status" className={message.includes("success") ? "ns-inline-success" : "ns-inline-error"}>{message}</span>}
      {open && (
        <div className="ns-modal-bg" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
          <form className="ns-modal" role="dialog" aria-modal="true" aria-labelledby={`${action}-dialog-title`} onSubmit={submit}>
            <div>
              <h2 id={`${action}-dialog-title`}>{label}</h2>
              <button ref={closeButton} type="button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button>
            </div>
            {fields.map((field) => (
              <label key={field.name}>
                {field.label}
                {field.type === "textarea"
                  ? <textarea name={field.name} defaultValue={field.value} required={field.required} />
                  : <input type={field.type || "text"} name={field.name} defaultValue={field.value} required={field.required} />}
              </label>
            ))}
            {message && <p role="alert" className={message.includes("success") ? "ns-success" : "ns-error"}>{message}</p>}
            <footer>
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button className={`ns-button ${tone}`} disabled={busy}>{busy ? "Saving…" : label}</button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}

type TableRecord = {
  number: string;
  title: string;
  party?: string;
  due_date?: string | null;
  owner?: string;
  priority: string;
  status: string;
};

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function RecordTable({ rows, base }: { rows: TableRecord[]; base: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState<keyof TableRecord>("due_date");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const statuses = useMemo(() => Array.from(new Set(rows.map((row) => row.status))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((row) => status === "ALL" || row.status === status)
      .filter((row) => !needle || [row.number, row.title, row.party, row.owner, row.status].some((value) => String(value || "").toLowerCase().includes(needle)))
      .sort((left, right) => {
        const a = String(left[sort] || "");
        const b = String(right[sort] || "");
        return a.localeCompare(b) * (direction === "asc" ? 1 : -1);
      });
  }, [rows, search, status, sort, direction]);

  useEffect(() => setPage(1), [search, status, pageSize]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function changeSort(field: keyof TableRecord) {
    if (sort === field) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setDirection("asc");
    }
  }

  function exportCsv() {
    const header = ["Record", "Description", "Customer or Supplier", "Due Date", "Owner", "Priority", "Status"];
    const lines = [header, ...filtered.map((row) => [row.number, row.title, row.party, row.due_date, row.owner, row.priority, row.status])];
    const blob = new Blob([lines.map((line) => line.map(escapeCsv).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "northstar-records.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const sortButton = (field: keyof TableRecord, label: string) => (
    <button className="ns-sort" onClick={() => changeSort(field)} aria-label={`Sort by ${label}`}>
      {label}{sort === field ? (direction === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="ns-table-card">
      <div className="ns-table-tools">
        <label>
          <span className="sr-only">Search this table</span>
          <input data-testid="table-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records…" />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">All statuses</option>
            {statuses.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="ns-page-size">Rows
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {[10, 25, 50, 100].map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
        <button onClick={exportCsv}>Export CSV</button>
        <span>{filtered.length} records</span>
      </div>
      <table>
        <thead><tr>
          <th>{sortButton("number", "Record")}</th>
          <th>{sortButton("title", "Description")}</th>
          <th>{sortButton("party", "Customer / Supplier")}</th>
          <th>{sortButton("due_date", "Due date")}</th>
          <th>{sortButton("owner", "Owner")}</th>
          <th>{sortButton("priority", "Priority")}</th>
          <th>{sortButton("status", "Status")}</th>
          <th><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {visible.length ? visible.map((row) => (
            <tr key={row.number}>
              <td><b>{row.number}</b></td>
              <td>{row.title}</td>
              <td>{row.party || "—"}</td>
              <td>{row.due_date || "—"}</td>
              <td>{row.owner || "Unassigned"}</td>
              <td><Badge>{row.priority}</Badge></td>
              <td><Badge>{row.status}</Badge></td>
              <td><Link href={`${base}/${encodeURIComponent(row.number)}`}>Open →</Link></td>
            </tr>
          )) : <tr><td colSpan={8} className="ns-empty">No records match the current search and filters.</td></tr>}
        </tbody>
      </table>
      <div className="ns-pagination" aria-label="Table pagination">
        <span>Page {currentPage} of {pages}</span>
        <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>
    </div>
  );
}

export function PageTitle({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="ns-page-title">
      <div>{eyebrow && <small>{eyebrow}</small>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <div>{actions}</div>
    </div>
  );
}
