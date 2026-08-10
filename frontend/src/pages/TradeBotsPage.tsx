import BotsList from './trade-bots/BotsList';

export default function TradeBotsPage() {
  return (
    <div className="space-y-6">
      <section className="layout-container section-pad space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="section-label">Execution layer</p>
            <h1 className="headline text-3xl">Trade Bots</h1>
            <p className="mt-2 text-sm muted-text max-w-2xl">
              Mirror the legacy Trade Bots table with real-time guardrail alerts, credential overlays, and deployment modals. All
              functionality from the classic UI is still available—just nested inside the new React shell.
            </p>
          </div>
          <div className="card-shell text-xs max-w-xs">
            <p className="text-main font-semibold">Status</p>
            <p className="mt-1 text-green-300 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse"></span>
              Guardrails active
            </p>
            <p className="mt-2 text-[11px] text-gray-400">Auto retries + webhook relays mirror the Vue console defaults.</p>
          </div>
        </header>
        <div className="card-shell overflow-hidden">
          <BotsList />
        </div>
      </section>
    </div>
  );
}
