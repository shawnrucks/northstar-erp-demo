"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ns-page">
      <section className="ns-panel ns-state-panel" role="alert">
        <p className="ns-eyebrow">NORTHSTAR ERP</p>
        <h1>This page couldn’t load</h1>
        <p>The requested operational data could not be retrieved. No changes were made.</p>
        <div className="ns-form-actions">
          <button className="ns-button primary" onClick={reset}>Try again</button>
          <Link className="ns-button secondary" href="/erp/dashboard">Return to dashboard</Link>
        </div>
      </section>
    </div>
  );
}
