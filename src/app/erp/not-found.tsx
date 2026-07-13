import Link from "next/link";

export default function NotFound() {
  return (
    <div className="ns-page">
      <section className="ns-panel ns-state-panel">
        <p className="ns-eyebrow">NORTHSTAR ERP</p>
        <h1>Operational page not found</h1>
        <p>This route is not available in the current Northstar demo.</p>
        <Link className="ns-button primary" href="/erp/dashboard">Return to dashboard</Link>
      </section>
    </div>
  );
}
