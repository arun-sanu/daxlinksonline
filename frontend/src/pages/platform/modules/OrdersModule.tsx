export default function OrdersModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Orders</p>
        <h2 className="text-3xl font-semibold text-main">Spot order intelligence</h2>
        <p className="text-sm muted-text">
          Track spot balances, open orders, and recent fills from connected exchanges. MEXC spot data wiring is next.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Balances</p>
          <p className="text-sm text-gray-300">Free vs locked balances across connected spot accounts.</p>
          <p className="text-xs text-gray-500">Pending integration with live MEXC account snapshot.</p>
        </article>
        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Open orders</p>
          <p className="text-sm text-gray-300">Active spot orders with status and remaining quantity.</p>
          <p className="text-xs text-gray-500">Order status API coming next.</p>
        </article>
      </div>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Recent fills</p>
        <p className="text-sm text-gray-300">Latest executions with price, size, and fees.</p>
        <p className="text-xs text-gray-500">Will populate from exchange trade history.</p>
      </article>
    </div>
  );
}
