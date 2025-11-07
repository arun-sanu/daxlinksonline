export default {
  name: 'TradeBotsPage',
  template: `
    <main class="layout-container section-pad space-y-12">
      <section class="space-y-3">
        <span class="section-label">Automation</span>
        <h1 class="text-3xl font-semibold text-main sm:text-4xl">Trade Bots Control Center</h1>
        <p class="max-w-3xl text-sm muted-text">
          Deploy, monitor, and iterate on systematic trading strategies without leaving the console.
          Configure throttles, risk envelopes, and exchange mappings for each bot profile.
        </p>
      </section>
      <section class="grid gap-6 md:grid-cols-3">
        <article class="card-shell space-y-3">
          <h2 class="text-lg font-semibold text-main">Strategy Registry</h2>
          <p class="text-sm muted-text">
            Track which strategies are in rotation, their linked exchanges, and current capital allocation.
          </p>
          <ul class="space-y-2 text-xs muted-text">
            <li>• Versioned rollouts with staged approvals</li>
            <li>• Per-bot environment targets (paper/live)</li>
            <li>• Immutable audit history for parameter swaps</li>
          </ul>
        </article>
        <article class="card-shell space-y-3">
          <h2 class="text-lg font-semibold text-main">Execution Guardrails</h2>
          <p class="text-sm muted-text">
            Define global safeguards that every automation inherits before firing orders across venues.
          </p>
          <ul class="space-y-2 text-xs muted-text">
            <li>• Burst limits with circuit-breaker triggers</li>
            <li>• Hedging offsets and delta targets</li>
            <li>• Webhook fallbacks for manual intervention</li>
          </ul>
        </article>
        <article class="card-shell space-y-3">
          <h2 class="text-lg font-semibold text-main">Runtime Telemetry</h2>
          <p class="text-sm muted-text">
            Observe latency, fill ratios, and symbol coverage with live streaming updates from adapters.
          </p>
          <ul class="space-y-2 text-xs muted-text">
            <li>• Tick-to-trade latency snapshots</li>
            <li>• Per-symbol win rate and drawdown</li>
            <li>• Auto-alerts for deviation from baselines</li>
          </ul>
        </article>
      </section>
      <section class="card-shell space-y-4">
        <h2 class="text-lg font-semibold text-main">Launch A New Bot</h2>
        <p class="text-sm muted-text">
          Start with a blueprint and layer credentials, risk budgets, and notification targets before activating in live markets.
        </p>
        <div class="grid gap-4 md:grid-cols-2 text-sm muted-text">
          <div class="card-shell">
            <p class="section-label">Blueprint</p>
            <p class="mt-2 text-main">Select a base template</p>
            <p class="mt-1 text-xs muted-text">VWAP scalper · Momentum rider · Market-maker net</p>
          </div>
          <div class="card-shell">
            <p class="section-label">Credentials</p>
            <p class="mt-2 text-main">Bind exchange access</p>
            <p class="mt-1 text-xs muted-text">Use stored API profiles with per-route throttles.</p>
          </div>
        </div>
      </section>
    </main>
  `
};
