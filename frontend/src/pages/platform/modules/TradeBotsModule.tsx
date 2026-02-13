import { Link } from 'react-router-dom';

export default function TradeBotsModule() {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
        <p className="section-label">Trade Bots</p>
        <h2 className="text-2xl font-semibold text-main">Moved under Integrations</h2>
        <p className="text-sm text-gray-300 max-w-3xl">
          Trade bot management is now attached to each exchange integration page. Open an exchange and use the
          <span className="text-primary-200"> Trade Bots </span>
          tab to manage workspace bots, marketplace visibility, and rentals.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link to="/platform/integrations" className="btn btn-white-animated btn-small">
            Open Integrations
          </Link>
          <Link to="/platform/integrations/mexc/bots" className="btn btn-secondary btn-small">
            Open MEXC Bots
          </Link>
        </div>
      </div>
    </section>
  );
}
