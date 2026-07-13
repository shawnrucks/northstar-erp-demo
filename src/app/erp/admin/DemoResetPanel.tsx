"use client";

import { useEffect, useState } from "react";

type ResetStatus = {
  available: boolean;
  provider: "postgres" | "sqlite";
  seedVersion: number;
  anchorDate: string | null;
  canonicalRecordCount: number;
  liveRecordCount: number;
  generation: number;
  resetInProgress: boolean;
  lastResetAt: string | null;
  lastResetBy: string | null;
  cooldownRemainingSeconds: number;
};

export default function DemoResetPanel() {
  const [status, setStatus] = useState<ResetStatus | null>(null);
  const [message, setMessage] = useState("Loading reset status…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      fetch("/api/northstar/admin/reset", { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Reset status is unavailable.");
          if (!active) return;
          setStatus(result);
          setMessage(result.available ? "Ready" : "Canonical reset data is unavailable.");
        })
        .catch((error) => {
          if (active) setMessage(error instanceof Error ? error.message : "Reset status is unavailable.");
        });
    };
    refresh();
    const refreshTimer = window.setInterval(refresh, 10_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStatus((current) => {
        if (!current || current.cooldownRemainingSeconds <= 0) return current;
        return {
          ...current,
          cooldownRemainingSeconds: current.cooldownRemainingSeconds - 1,
        };
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function resetDemo() {
    if (!status?.available) return;
    setBusy(true);
    setMessage("Restoring canonical records, queues, and workflow data…");
    try {
      const response = await fetch("/api/northstar/admin/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The demo could not be reset.");
      setMessage(`Reset complete: ${Number(result.recordCount).toLocaleString()} records restored. Signing out…`);
      window.setTimeout(() => window.location.assign("/login?reset=complete"), 900);
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "The demo could not be reset.");
    }
  }

  const disabled =
    busy ||
    !status?.available ||
    Boolean(status?.resetInProgress) ||
    (status?.cooldownRemainingSeconds || 0) > 0;

  return (
    <section className="ns-panel ns-demo-reset" aria-labelledby="demo-reset-title">
      <div className="ns-panel-head">
        <h2 id="demo-reset-title">Reset demo data</h2>
        <span className={status?.available ? "ns-reset-ready" : "ns-reset-unavailable"}>
          {status?.available ? "READY" : status ? "UNAVAILABLE" : "CHECKING"}
        </span>
      </div>
      <div className="ns-demo-reset-body">
        <p>
          Restore the canonical Northstar scenario, including all 2,090 records,
          queues, reports, tasks, notes, and communications. Existing sessions are
          revoked. The append-only audit history and reset evidence are retained.
          This administrator-only action runs immediately and signs everyone out.
        </p>
        {status && (
          <dl className="ns-reset-status">
            <div><dt>Database</dt><dd>{status.provider === "postgres" ? "PostgreSQL" : "SQLite"}</dd></div>
            <div><dt>Live records</dt><dd>{status.liveRecordCount.toLocaleString()}</dd></div>
            <div><dt>Seed generation</dt><dd>{status.generation}</dd></div>
            <div><dt>Last reset</dt><dd>{status.lastResetAt ? new Date(status.lastResetAt).toLocaleString() : "Not yet reset"}</dd></div>
          </dl>
        )}
        {status && status.cooldownRemainingSeconds > 0 && (
          <p className="ns-reset-cooldown">
            Reset cooldown active for approximately {Math.ceil(status.cooldownRemainingSeconds / 60)} minute(s).
          </p>
        )}
        <div className="ns-form-actions">
          <button
            aria-busy={busy}
            className="ns-button danger"
            data-testid="northstar-demo-reset-button"
            disabled={disabled}
            onClick={resetDemo}
            type="button"
          >
            {busy ? "Resetting demo…" : "Reset Demo Data"}
          </button>
          <span className="ns-reset-message" role="status">{message}</span>
        </div>
      </div>
    </section>
  );
}
