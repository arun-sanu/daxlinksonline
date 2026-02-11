export default {
  name: 'OrdersPage',
  template: `
    <main class="layout-container py-24">
      <div class="space-y-6">
        <div class="card-shell space-y-3">
          <p class="text-xs uppercase tracking-[0.32em] text-primary-200">Orders</p>
          <h1 class="text-3xl font-light text-main">MEXC spot order status</h1>
          <p class="text-sm text-gray-400">
            Use this module to understand whether a trade executed, if it is still open, current balances, and spot exposure.
          </p>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <article class="card-shell space-y-3">
            <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Did the trade happen?</p>
            <p class="text-sm text-gray-300">Check <code>GET /api/v3/order</code> and/or <code>GET /api/v3/myTrades</code>.</p>
            <p class="text-xs text-gray-500">If <code>executedQty &gt; 0</code> or there are fills in <code>myTrades</code>, it executed.</p>
          </article>
          <article class="card-shell space-y-3">
            <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Is it still open?</p>
            <p class="text-sm text-gray-300">Check <code>GET /api/v3/openOrders</code> for the symbol/order.</p>
            <p class="text-xs text-gray-500">If present in open orders, it is still open.</p>
          </article>
          <article class="card-shell space-y-3">
            <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Current balance</p>
            <p class="text-sm text-gray-300">Use <code>GET /api/v3/account</code> balances (free + locked).</p>
          </article>
          <article class="card-shell space-y-3">
            <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Open position (spot)</p>
            <p class="text-sm text-gray-300">
              Spot has no separate positions object. Infer exposure from balances + open orders.
            </p>
          </article>
        </div>
      </div>
    </main>
  `
};
