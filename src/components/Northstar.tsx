"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatNorthstarDate } from "@/lib/northstar-format";

const drawerMediaQuery = "(max-width: 1024px)";

function subscribeToDrawerViewport(onChange: () => void) {
  const media = window.matchMedia(drawerMediaQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getDrawerViewport() {
  return window.matchMedia(drawerMediaQuery).matches;
}

function getServerDrawerViewport() {
  return false;
}

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
  group: "Overview" | "Sales" | "Operations" | "Procurement" | "Finance" | "Management" | "System";
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
  { label: "Dashboard", href: "/erp/dashboard", group: "Overview", roles: allRoles },
  { label: "Work Queues", href: "/erp/queues", group: "Overview", roles: allRoles },
  { label: "Customers", href: "/erp/customers", group: "Sales", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "RFQs & Quotes", href: "/erp/rfqs", group: "Sales", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "Sales Orders", href: "/erp/sales-orders", group: "Sales", roles: ["ADMIN", "SALES_COORDINATOR", "OPERATIONS_ANALYST"] },
  { label: "Production Planning", href: "/erp/production-planning", group: "Operations", roles: ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"] },
  { label: "Quote Approvals", href: "/erp/quote-approvals", group: "Operations", roles: ["PRODUCTION_PLANNER"] },
  { label: "Work Orders", href: "/erp/work-orders", group: "Operations", roles: ["ADMIN", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"] },
  { label: "Inventory", href: "/erp/inventory", group: "Operations", roles: ["ADMIN", "BUYER", "PRODUCTION_PLANNER", "OPERATIONS_ANALYST"] },
  { label: "Quality", href: "/erp/quality/holds", group: "Operations", roles: ["ADMIN", "QUALITY_SPECIALIST", "OPERATIONS_ANALYST"] },
  { label: "Shipping", href: "/erp/shipping", group: "Operations", roles: ["ADMIN", "OPERATIONS_ANALYST"] },
  { label: "Purchasing", href: "/erp/purchase-orders", group: "Procurement", roles: ["ADMIN", "BUYER", "OPERATIONS_ANALYST", "ACCOUNTS_PAYABLE"] },
  { label: "Suppliers", href: "/erp/suppliers", group: "Procurement", roles: ["ADMIN", "BUYER", "OPERATIONS_ANALYST"] },
  { label: "Invoices", href: "/erp/invoices", group: "Finance", roles: ["ADMIN", "ACCOUNTS_PAYABLE", "OPERATIONS_ANALYST"] },
  { label: "Reports", href: "/erp/reports/daily-operations", group: "Management", roles: allRoles },
  { label: "Audit Log", href: "/erp/audit-log", group: "Management", roles: allRoles },
  { label: "Administration", href: "/erp/admin", group: "System", roles: ["ADMIN"] },
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
  const drawerViewport = useSyncExternalStore(subscribeToDrawerViewport, getDrawerViewport, getServerDrawerViewport);
  const menuButton = useRef<HTMLButtonElement>(null);
  const visibleNav = nav.filter((item) => item.roles.includes(user.role));
  const navigationGroups = Array.from(new Set(visibleNav.map((item) => item.group)));

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  async function logout() {
    await fetch("/api/northstar/login", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={`ns-shell ${mobileOpen ? "mobile-open" : ""}`}>
      <aside
        id="northstar-navigation"
        aria-hidden={drawerViewport && !mobileOpen}
        aria-label="ERP navigation"
        inert={drawerViewport && !mobileOpen ? true : undefined}
      >
        <Link href="/erp/dashboard" className="ns-logo" onClick={() => setMobileOpen(false)}>
          <span aria-hidden="true">N</span>
          <b>Northstar<small>INDUSTRIAL COMPONENTS</small></b>
        </Link>
        <nav>
          {navigationGroups.map((group) => (
            <div className="ns-nav-group" key={group}>
              <small>{group}</small>
              {visibleNav.filter((item) => item.group === group).map((item) => (
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
            </div>
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
          <button
            ref={menuButton}
            className="ns-menu-button"
            aria-controls="northstar-navigation"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          >☰</button>
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
          <Link className="ns-queue-shortcut" href="/erp/queues" aria-label="Open work queues"><span aria-hidden="true">●</span></Link>
        </header>
        {children}
      </main>
      {mobileOpen && (
        <button
          className="ns-nav-scrim"
          aria-label="Close navigation"
          onClick={() => {
            setMobileOpen(false);
            menuButton.current?.focus();
          }}
        />
      )}
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const triggerButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLFormElement>(null);
  const wasOpen = useRef(false);
  const feedbackTimer = useRef<number | null>(null);
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const preferred = dialog.current?.querySelector<HTMLElement>("input, textarea, select, button[type='submit']");
      preferred?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      triggerButton.current?.focus();
    }
  }, [open]);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]",
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
  }, []);

  async function send(values: Record<string, unknown> = {}) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/northstar/action", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ number, action, ...values }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(result.error || "The action could not be completed.");
        return;
      }
      setMessage("Saved successfully");
      setOpen(false);
      router.refresh();
      feedbackTimer.current = window.setTimeout(() => setMessage(""), 2_200);
    } catch {
      setMessage("The action could not be completed. Check your connection and try again.");
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send(Object.fromEntries(new FormData(event.currentTarget)));
  }

  const testId = `${number.toLowerCase()}-${action}-button`;
  return (
    <>
      <button
        ref={triggerButton}
        className={`ns-button ${tone}`}
        data-testid={testId}
        disabled={busy}
        aria-busy={busy}
        onClick={() => fields.length ? setOpen(true) : send()}
      >
        {busy ? `${label}…` : label}
      </button>
      {message && !open && <span role="status" className={message.includes("success") ? "ns-inline-success" : "ns-inline-error"}>{message}</span>}
      {open && (
        <div className="ns-modal-bg" onKeyDown={handleDialogKeyDown}>
          <form ref={dialog} className="ns-modal" role="dialog" aria-modal="true" aria-labelledby={`${action}-dialog-title`} onSubmit={submit}>
            <div>
              <h2 id={`${action}-dialog-title`}>{label}</h2>
              <button type="button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button>
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
              <button className={`ns-button ${tone}`} disabled={busy} aria-busy={busy}>{busy ? "Saving…" : label}</button>
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
  data?: Record<string, unknown>;
};

export type RecordTableVariant =
  | "customers"
  | "suppliers"
  | "inventory"
  | "purchase-orders"
  | "invoices"
  | "invoice-exceptions"
  | "work-orders"
  | "production-planning"
  | "material-shortages"
  | "production-exceptions";

type TableValue = string | number | boolean | null | undefined;

type TableColumn = {
  key: string;
  label: string;
  value: (row: TableRecord) => TableValue;
  format?: (value: TableValue, row: TableRecord) => React.ReactNode;
};

const topLevelColumn = (key: keyof TableRecord, label: string, format?: TableColumn["format"]): TableColumn => ({
  key: String(key),
  label,
  value: (row) => {
    const value = row[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null
      ? value
      : undefined;
  },
  format,
});

const dataColumn = (key: string, label: string, format?: TableColumn["format"]): TableColumn => ({
  key,
  label,
  value: (row) => {
    const value = row.data?.[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null
      ? value
      : undefined;
  },
  format,
});

const displayText = (value: TableValue) => value === null || value === undefined || value === "" ? "—" : String(value);
const displayDate = (value: TableValue) => formatNorthstarDate(typeof value === "boolean" ? undefined : value);
const displayCurrency = (value: TableValue) => {
  const amount = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(amount)
    ? "—"
    : amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
};
const displayQuantity = (value: TableValue) => {
  const quantity = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(quantity)
    ? "—"
    : quantity.toLocaleString("en-US");
};
const displayPercent = (value: TableValue) => {
  const percentage = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(percentage)
    ? "—"
    : `${percentage.toFixed(1)}%`;
};
const displayRating = (value: TableValue) => {
  const rating = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(rating)
    ? "—"
    : `${rating.toFixed(0)}%`;
};
const displayBadge = (value: TableValue) => value === null || value === undefined || value === ""
  ? "—"
  : <Badge>{String(value)}</Badge>;

const recordColumn = (label = "Record") => topLevelColumn("number", label);
const titleColumn = (label = "Description") => topLevelColumn("title", label);
const partyColumn = (label = "Customer / Supplier") => topLevelColumn("party", label);
const ownerColumn = (label = "Owner") => topLevelColumn("owner", label);
const dueDateColumn = (label = "Due date") => topLevelColumn("due_date", label, displayDate);
const priorityColumn = topLevelColumn("priority", "Priority", displayBadge);
const statusColumn = topLevelColumn("status", "Status", displayBadge);

function invoiceVariance(row: TableRecord) {
  const purchaseOrderPrice = Number(row.data?.poUnitPrice);
  const invoicePrice = Number(row.data?.invoiceUnitPrice);
  if (!Number.isFinite(purchaseOrderPrice) || purchaseOrderPrice === 0 || !Number.isFinite(invoicePrice)) return undefined;
  return ((invoicePrice - purchaseOrderPrice) / purchaseOrderPrice) * 100;
}

function columnsForVariant(variant?: RecordTableVariant): TableColumn[] {
  switch (variant) {
    case "customers":
      return [
        recordColumn("Account"),
        titleColumn("Customer"),
        dataColumn("industry", "Industry"),
        dataColumn("contact", "Primary contact"),
        dataColumn("terms", "Payment terms"),
        ownerColumn("Account owner"),
        statusColumn,
      ];
    case "suppliers":
      return [
        recordColumn("Supplier ID"),
        titleColumn("Supplier"),
        dataColumn("qualityRating", "Quality rating", displayRating),
        dataColumn("onTimeRating", "On-time delivery", displayRating),
        ownerColumn("Buyer"),
        statusColumn,
      ];
    case "inventory":
      return [
        recordColumn("Item"),
        titleColumn(),
        dataColumn("standardCost", "Standard cost", displayCurrency),
        dataColumn("onHand", "On hand", displayQuantity),
        ownerColumn("Planner"),
        statusColumn,
      ];
    case "purchase-orders":
      return [
        recordColumn("Purchase order"),
        partyColumn("Supplier"),
        {
          key: "item",
          label: "Item / order",
          value: (row) => {
            const item = row.data?.item;
            return typeof item === "string" && item ? item : row.title;
          },
        },
        dataColumn("confirmation", "Confirmation", displayBadge),
        dataColumn("unitCost", "Unit cost", displayCurrency),
        dueDateColumn("Need-by date"),
        ownerColumn("Buyer"),
        priorityColumn,
        statusColumn,
      ];
    case "invoices":
    case "invoice-exceptions":
      return [
        recordColumn("Invoice"),
        partyColumn("Supplier"),
        dataColumn("po", "Purchase order"),
        dataColumn("total", "Invoice total", displayCurrency),
        { key: "variance", label: "Price variance", value: invoiceVariance, format: displayPercent },
        dueDateColumn("Due date"),
        ownerColumn(),
        statusColumn,
      ];
    case "work-orders":
    case "production-planning":
      return [
        recordColumn("Work order"),
        titleColumn("Job"),
        partyColumn("Customer"),
        dataColumn("location", "Location"),
        dataColumn("workCenter", "Work center"),
        dataColumn("materialStatus", "Material status", displayBadge),
        dueDateColumn("Due date"),
        ownerColumn("Planner"),
        statusColumn,
      ];
    case "material-shortages":
      return [
        recordColumn("Shortage"),
        {
          key: "item",
          label: "Material",
          value: (row) => {
            const item = row.data?.item;
            return typeof item === "string" && item ? item : row.title;
          },
        },
        dataColumn("workOrder", "Work order"),
        dataColumn("required", "Required", displayQuantity),
        dataColumn("available", "Available", displayQuantity),
        dataColumn("shortage", "Short", displayQuantity),
        dueDateColumn("Need-by date"),
        ownerColumn("Planner"),
        statusColumn,
      ];
    case "production-exceptions":
      return [
        recordColumn("Exception"),
        titleColumn("Issue"),
        dataColumn("type", "Exception type", (value) => displayText(value).replaceAll("_", " ")),
        dataColumn("workOrder", "Work order"),
        {
          key: "impact",
          label: "Impact",
          value: (row) => {
            const productionImpact = row.data?.productionImpact;
            if (typeof productionImpact === "string" && productionImpact) return productionImpact;
            const customerImpact = row.data?.customerImpact;
            return typeof customerImpact === "string" ? customerImpact : undefined;
          },
        },
        dueDateColumn("Target date"),
        ownerColumn(),
        priorityColumn,
        statusColumn,
      ];
    default:
      return [
        recordColumn(),
        titleColumn(),
        partyColumn(),
        dueDateColumn(),
        ownerColumn(),
        priorityColumn,
        statusColumn,
      ];
  }
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function RecordTable({ rows, base, variant }: { rows: TableRecord[]; base: string; variant?: RecordTableVariant }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const columns = useMemo(() => columnsForVariant(variant), [variant]);
  const defaultSort = columns.some((column) => column.key === "due_date") ? "due_date" : "number";
  const [sort, setSort] = useState(defaultSort);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const statuses = useMemo(() => Array.from(new Set(rows.map((row) => row.status))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const selectedColumn = columns.find((column) => column.key === sort) || columns[0];
    return rows
      .filter((row) => status === "ALL" || row.status === status)
      .filter((row) => !needle || [
        row.number,
        row.title,
        row.party,
        row.owner,
        row.status,
        ...columns.map((column) => column.value(row)),
      ].some((value) => String(value ?? "").toLowerCase().includes(needle)))
      .sort((left, right) => {
        const leftValue = selectedColumn.value(left);
        const rightValue = selectedColumn.value(right);
        const comparison = typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true });
        return comparison * (direction === "asc" ? 1 : -1);
      });
  }, [rows, search, status, sort, direction, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function changeSort(field: string) {
    if (sort === field) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setDirection("asc");
    }
  }

  function exportCsv() {
    const header = columns.map((column) => column.label);
    const lines = [header, ...filtered.map((row) => columns.map((column) => column.value(row)))];
    const blob = new Blob([lines.map((line) => line.map(escapeCsv).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `northstar-${variant || "records"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const sortButton = (field: string, label: string) => (
    <button className="ns-sort" onClick={() => changeSort(field)} aria-label={`Sort by ${label}`}>
      {label}{sort === field ? (direction === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="ns-table-card">
      <div className="ns-table-tools">
        <label>
          <span className="sr-only">Search this table</span>
          <input data-testid="table-search-input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search records…" />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="ALL">All statuses</option>
            {statuses.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="ns-page-size">Rows
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {[10, 25, 50, 100].map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
        <button onClick={exportCsv}>Export CSV</button>
        <span>{filtered.length} records</span>
      </div>
      <p className="ns-table-hint">Swipe horizontally to view all columns.</p>
      <div className="ns-table-scroll" role="region" aria-label="Records table" tabIndex={0}>
        <table>
          <caption className="sr-only">{variant ? `${variant.replaceAll("-", " ")} records` : "Northstar records"}</caption>
          <thead><tr>
            {columns.map((column) => (
              <th
                aria-sort={sort === column.key ? (direction === "asc" ? "ascending" : "descending") : "none"}
                scope="col"
                key={column.key}
              >
                {sortButton(column.key, column.label)}
              </th>
            ))}
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {visible.length ? visible.map((row) => (
              <tr key={row.number}>
                {columns.map((column, index) => {
                  const value = column.value(row);
                  return <td key={column.key}>{index === 0 ? <b>{displayText(value)}</b> : column.format ? column.format(value, row) : displayText(value)}</td>;
                })}
                <td><Link href={`${base}/${encodeURIComponent(row.number)}`}>Open →</Link></td>
              </tr>
            )) : <tr><td colSpan={columns.length + 1} className="ns-empty">No records match the current search and filters.</td></tr>}
          </tbody>
        </table>
      </div>
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
