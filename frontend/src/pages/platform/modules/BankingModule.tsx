export default function BankingModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Banking</p>
        <h2 className="text-3xl font-semibold text-main">Treasury + settlement</h2>
        <p className="text-sm muted-text">
          Treasury tooling is rolling out soon so payout windows, settlements, and static instructions live beside bots.
        </p>
      </header>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-primary-200">Coming soon</p>
        <p className="text-sm text-gray-300">Preview payouts, map beneficiary accounts, and stage reconciliation reports.</p>
        <ul className="space-y-2 text-sm text-gray-400">
          <li>• Real-time ledger of fills and funding.</li>
          <li>• Banking API integrations for ACH/SWIFT.</li>
          <li>• Multi-desk approval flow for disbursements.</li>
        </ul>
      </article>

      <article className="card-shell space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Pilot cohort</p>
        <p className="text-sm text-gray-300">Ops teams can request access to wire sandbox credentials.</p>
        <button type="button" className="btn btn-secondary btn-small">Request invite</button>
      </article>
    </div>
  );
}
