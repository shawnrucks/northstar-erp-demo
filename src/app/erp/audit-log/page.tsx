import Link from "next/link";
import { PageTitle } from "@/components/Northstar";
import { northstarRepository } from "@/lib/northstar";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; date?: string }>;
}) {
  const { q = "", date = "" } = await searchParams;
  const rows = await northstarRepository.listAuditEvents({
    search: q,
    date,
    limit: 300,
  });

  return (
    <div className="ns-page">
      <PageTitle
        eyebrow="SYSTEM OF RECORD"
        title="Audit Log"
        subtitle="Immutable history of meaningful user actions"
      />
      <div className="ns-table-card">
        <form className="ns-table-tools" method="get">
          <input
            aria-label="Filter audit events"
            defaultValue={q}
            name="q"
            placeholder="Filter by record, user, or action…"
          />
          <input
            aria-label="Filter audit events by date"
            defaultValue={date}
            name="date"
            type="date"
          />
          <button type="submit">Filter</button>
          {(q || date) && <Link href="/erp/audit-log">Clear</Link>}
          <span>{rows.length} recent events</span>
        </form>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Module</th>
              <th>Record</th>
              <th>Action</th>
              <th>Field</th>
              <th>Previous</th>
              <th>New value</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.timestamp || "")}</td>
                <td>
                  {String(row.user || "")}
                  <small>{String(row.user_role || "")}</small>
                </td>
                <td>{String(row.module || "")}</td>
                <td><b>{String(row.record_number || "")}</b></td>
                <td>{String(row.action || "")}</td>
                <td>{String(row.field_changed || "—")}</td>
                <td>{String(row.previous_value || "—")}</td>
                <td>{String(row.new_value || "—")}</td>
                <td>{String(row.note || "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
