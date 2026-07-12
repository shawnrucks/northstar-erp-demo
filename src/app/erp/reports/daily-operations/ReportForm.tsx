"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Northstar";

type Issue = { number: string; type: string; title: string; party: string; status: string; priority: string; due_date: string; preselected?: boolean };
type Report = { id: number; number: string; report_date: string; prepared_by: string; status: string };

export default function ReportForm({ metrics, reports, issues }: { metrics: Record<string, number>; reports: Report[]; issues: Issue[] }) {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [summary, setSummary] = useState("");
  const [decisions, setDecisions] = useState("");
  const [status, setStatus] = useState("NEW REPORT");
  const [busy, setBusy] = useState(false);
  const [included, setIncluded] = useState(() => issues.filter((issue) => issue.preselected).map((issue) => issue.number));
  const [narratives, setNarratives] = useState({ production: "", supplyChain: "", customerCommitments: "", inventory: "", quality: "", finance: "" });

  async function save(finalize = false) {
    if (!summary.trim()) {
      setStatus("Executive summary is required.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/northstar/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ number, executiveSummary: summary, managementDecisions: decisions, narratives, includedRecords: included, finalize }),
    });
    const result = await response.json();
    setBusy(false);
    if (response.ok) {
      setNumber(result.number);
      setStatus(result.status);
      router.refresh();
    } else setStatus(result.error || "The report could not be saved.");
  }

  const metricGroups = [
    ["Production", [["Work orders at risk", metrics.atRiskWOs], ["Material shortages", metrics.shortages]]],
    ["Supply chain", [["Past due POs", metrics.pastDuePOs], ["Missing confirmations", metrics.confirmations]]],
    ["Customer commitments", [["Orders on hold", metrics.holds], ["Shipments due today", metrics.shipments]]],
    ["Quality & finance", [["Quality holds", metrics.quality], ["Invoice exceptions", metrics.invoices]]],
  ] as const;

  return (
    <>
      <div className="ns-report-grid">
        <section className="ns-panel">
          <div className="ns-panel-head"><h2>Live metrics snapshot</h2><span>Prefilled for review</span></div>
          {metricGroups.map(([group, values]) => <div className="ns-report-group" key={group}><h3>{group}</h3>{values.map(([label, value]) => <p key={label}><span>{label}</span><b>{value}</b></p>)}</div>)}
        </section>
        <section className="ns-panel ns-report-form">
          <div className="ns-panel-head"><h2>{number || "Create Daily Operations Report"}</h2><span role="status">{status}</span></div>
          <label>Executive summary<textarea data-testid="operations-report-summary" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Summarize the operating picture, key risks, and changes since yesterday…" /></label>
          <div className="ns-narrative-grid">
            {Object.entries({ production: "Production summary", supplyChain: "Supply-chain summary", customerCommitments: "Customer commitment summary", inventory: "Inventory summary", quality: "Quality summary", finance: "Finance summary" }).map(([key, label]) => (
              <label key={key}>{label}<textarea value={narratives[key as keyof typeof narratives]} onChange={(event) => setNarratives({ ...narratives, [key]: event.target.value })} /></label>
            ))}
          </div>
          <label>Required management decisions<textarea value={decisions} onChange={(event) => setDecisions(event.target.value)} placeholder="List decisions, owners, and required timing…" /></label>
          <p className="ns-note">Metrics are prefilled from live records. No report is created or finalized until you explicitly choose an action.</p>
          <div className="ns-form-actions"><button disabled={busy} data-testid="operations-report-save-button" className="ns-button secondary" onClick={() => save(false)}>Save Draft</button><button disabled={busy} className="ns-button primary" onClick={() => save(true)}>Mark Final</button>{number && <a className="ns-button secondary" href={`/api/northstar/reports/${number}/pdf`}>Export PDF</a>}</div>
        </section>
      </div>
      <section className="ns-panel">
        <div className="ns-panel-head"><h2>Operational records for review</h2><span>{included.length} selected for report</span></div>
        <table><thead><tr><th>Include</th><th>Record</th><th>Type</th><th>Issue</th><th>Customer / Supplier</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>{issues.map((issue) => <tr key={issue.number}><td><input aria-label={`Include ${issue.number}`} type="checkbox" checked={included.includes(issue.number)} onChange={(event) => setIncluded(event.target.checked ? [...included, issue.number] : included.filter((value) => value !== issue.number))} /></td><td><b>{issue.number}</b></td><td>{issue.type.replaceAll("_", " ")}</td><td>{issue.title}</td><td>{issue.party}</td><td>{issue.due_date}</td><td><Badge>{issue.priority}</Badge></td><td><Badge>{issue.status}</Badge></td></tr>)}</tbody></table>
      </section>
      <section className="ns-panel ns-saved"><div className="ns-panel-head"><h2>Saved reports</h2></div>{reports.length ? reports.map((report) => <div key={report.id}><b>{report.number}</b><span>{report.report_date} · {report.prepared_by}</span><strong>{report.status}</strong><a href={`/api/northstar/reports/${report.number}/pdf`}>Export PDF</a></div>) : <p className="ns-empty">No reports created. Use the form above to create one manually.</p>}</section>
    </>
  );
}
