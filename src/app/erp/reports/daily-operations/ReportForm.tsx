"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/Northstar";
import { formatNorthstarDate } from "@/lib/northstar-format";

type Issue = { number: string; type: string; title: string; party: string; status: string; priority: string; due_date: string | null; preselected?: boolean };
type Narratives = { production: string; supplyChain: string; customerCommitments: string; inventory: string; quality: string; finance: string };
type Report = { id: number; number: string; report_date: string | null; prepared_by: string; status: string; executive_summary: string; management_decisions: string; narratives: Narratives; included_records: string[] };
type ReportPermissions = { saveDraft: boolean; finalize: boolean; export: boolean };
type EditorMode = "new" | "draft" | "final";

const emptyNarratives = (): Narratives => ({ production: "", supplyChain: "", customerCommitments: "", inventory: "", quality: "", finance: "" });

export default function ReportForm({ metrics, reports, issues, permissions }: { metrics: Record<string, number>; reports: Report[]; issues: Issue[]; permissions: ReportPermissions }) {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [summary, setSummary] = useState("");
  const [decisions, setDecisions] = useState("");
  const [status, setStatus] = useState("NEW REPORT");
  const [busy, setBusy] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("new");
  const [included, setIncluded] = useState(() => issues.filter((issue) => issue.preselected).map((issue) => issue.number));
  const [narratives, setNarratives] = useState<Narratives>(emptyNarratives);
  const editor = useRef<HTMLElement>(null);
  const summaryField = useRef<HTMLTextAreaElement>(null);
  const editorReadOnly = !permissions.saveDraft || editorMode === "final";

  function focusEditor() {
    window.requestAnimationFrame(() => {
      editor.current?.scrollIntoView({ block: "start" });
      summaryField.current?.focus({ preventScroll: true });
    });
  }

  function loadReport(report: Report, mode: "draft" | "final") {
    if (mode === "draft" && (!permissions.saveDraft || report.status !== "DRAFT")) return;
    setNumber(report.number);
    setSummary(report.executive_summary);
    setDecisions(report.management_decisions);
    setNarratives({ ...report.narratives });
    setIncluded([...report.included_records]);
    setEditorMode(mode);
    setStatus(mode === "draft" ? `EDITING ${report.number}` : `${report.number} · FINAL · READ ONLY`);
    focusEditor();
  }

  function startNewReport() {
    setNumber("");
    setSummary("");
    setDecisions("");
    setNarratives(emptyNarratives());
    setIncluded(issues.filter((issue) => issue.preselected).map((issue) => issue.number));
    setEditorMode("new");
    setStatus("NEW REPORT");
    focusEditor();
  }

  async function save(finalize = false) {
    if (editorMode === "final") {
      setStatus(`${number} · FINAL · READ ONLY`);
      return;
    }
    if (finalize ? !permissions.finalize : !permissions.saveDraft) {
      setStatus("Your role does not have permission to save this report.");
      return;
    }
    if (!summary.trim()) {
      setStatus("Executive summary is required.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/northstar/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ number, executiveSummary: summary, managementDecisions: decisions, narratives, includedRecords: included, finalize }),
    });
    const result = await response.json();
    setBusy(false);
    if (response.ok) {
      setNumber(result.number);
      setStatus(result.status);
      setEditorMode(result.status === "FINAL" ? "final" : "draft");
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
        <section ref={editor} className="ns-panel ns-report-form" data-testid="operations-report-editor" aria-labelledby="operations-report-editor-title" tabIndex={-1}>
          <div className="ns-panel-head"><h2 id="operations-report-editor-title" data-testid="operations-report-number">{number || "Create Daily Operations Report"}</h2><span data-testid="operations-report-status" role="status" aria-live="polite">{status}</span></div>
          {permissions.saveDraft || editorMode === "final" ? <>
            <label>Executive summary<textarea ref={summaryField} data-testid="operations-report-summary" value={summary} readOnly={editorReadOnly} onChange={(event) => setSummary(event.target.value)} placeholder="Summarize the operating picture, key risks, and changes since yesterday…" /></label>
            <div className="ns-narrative-grid">
              {Object.entries({ production: "Production summary", supplyChain: "Supply-chain summary", customerCommitments: "Customer commitment summary", inventory: "Inventory summary", quality: "Quality summary", finance: "Finance summary" }).map(([key, label]) => (
                <label key={key}>{label}<textarea data-testid={`operations-report-narrative-${key}`} value={narratives[key as keyof Narratives]} readOnly={editorReadOnly} onChange={(event) => setNarratives({ ...narratives, [key]: event.target.value })} /></label>
              ))}
            </div>
            <label>Required management decisions<textarea data-testid="operations-report-decisions" value={decisions} readOnly={editorReadOnly} onChange={(event) => setDecisions(event.target.value)} placeholder="List decisions, owners, and required timing…" /></label>
            <p className="ns-note">{editorMode === "final" ? "This finalized report is read-only. Its saved content and record selection cannot be changed." : "Metrics are prefilled from live records. No report is created or finalized until you explicitly choose an action."}</p>
            <div className="ns-form-actions">
              {!editorReadOnly && <button type="button" disabled={busy} aria-busy={busy} data-testid="operations-report-save-button" className="ns-button secondary" onClick={() => save(false)}>Save Draft</button>}
              {!editorReadOnly && permissions.finalize && <button type="button" disabled={busy} aria-busy={busy} data-testid="operations-report-finalize-button" className="ns-button primary" onClick={() => save(true)}>Mark Final</button>}
              {number && permissions.export && <a className="ns-button secondary" data-testid="operations-report-export-link" href={`/api/northstar/reports/${number}/pdf`}>Export PDF</a>}
              {permissions.saveDraft && number && <button type="button" data-testid="operations-report-new-button" className="ns-button secondary" onClick={startNewReport}>Start New Report</button>}
            </div>
          </> : <p className="ns-report-readonly">This role has read-only report access. An Operations Analyst or Administrator can create and finalize the daily operations report.</p>}
        </section>
      </div>
      <section className="ns-panel">
        <div className="ns-panel-head"><h2>Operational records for review</h2><span>{included.length} selected for report</span></div>
        <p className="ns-table-hint">Swipe horizontally to review all record details.</p>
        <div className="ns-table-scroll" role="region" aria-label="Operational records for report" tabIndex={0}>
          <table><thead><tr><th>Include</th><th>Record</th><th>Type</th><th>Issue</th><th>Customer / Supplier</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>{issues.map((issue) => <tr key={issue.number}><td><input aria-label={`Include ${issue.number}`} data-testid={`operations-report-include-${issue.number.toLowerCase()}`} type="checkbox" checked={included.includes(issue.number)} disabled={editorReadOnly} onChange={(event) => setIncluded(event.target.checked ? [...included, issue.number] : included.filter((value) => value !== issue.number))} /></td><td><b>{issue.number}</b></td><td>{issue.type.replaceAll("_", " ")}</td><td>{issue.title}</td><td>{issue.party || "—"}</td><td>{formatNorthstarDate(issue.due_date)}</td><td><Badge>{issue.priority}</Badge></td><td><Badge>{issue.status}</Badge></td></tr>)}</tbody></table>
        </div>
      </section>
      <section className="ns-panel ns-saved" aria-labelledby="saved-reports-title"><div className="ns-panel-head"><h2 id="saved-reports-title">Saved reports</h2></div>{reports.length ? reports.map((report) => <div key={report.id}><b>{report.number}</b><span>{formatNorthstarDate(report.report_date)} · {report.prepared_by}</span><strong>{report.status}</strong>{report.status === "DRAFT" && permissions.saveDraft && <button type="button" className="ns-button secondary" data-testid={`operations-report-open-${report.number.toLowerCase()}`} aria-label={`Open draft ${report.number} for editing`} aria-pressed={number === report.number && editorMode === "draft"} onClick={() => loadReport(report, "draft")}>Open draft</button>}{report.status === "FINAL" && <button type="button" className="ns-button secondary" data-testid={`operations-report-view-${report.number.toLowerCase()}`} aria-label={`View final report ${report.number}`} aria-pressed={number === report.number && editorMode === "final"} onClick={() => loadReport(report, "final")}>View final</button>}{permissions.export && <a href={`/api/northstar/reports/${report.number}/pdf`}>Export PDF</a>}</div>) : <p className="ns-empty">No reports created. Use the form above to create one manually.</p>}</section>
    </>
  );
}
