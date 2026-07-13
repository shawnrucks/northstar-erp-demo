export default function Loading() {
  return (
    <div className="ns-page" aria-live="polite" aria-busy="true">
      <section className="ns-panel ns-state-panel">
        <p className="ns-eyebrow">NORTHSTAR ERP</p>
        <h1>Loading operational data…</h1>
        <p>Retrieving the latest records and queue status.</p>
      </section>
    </div>
  );
}
