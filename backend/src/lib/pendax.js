// Minimal sandbox stubbed Pendax client
export async function placeSandboxOrder({ venue, symbol, side, type, price, qty, idempotencyKey }) {
  // Simulate upstream latency
  await new Promise((r) => setTimeout(r, 50));
  return {
    id: `px_${Date.now()}`,
    venue,
    symbol,
    side,
    type,
    price,
    qty,
    idempotencyKey: idempotencyKey || null,
    status: 'NEW'
  };
}
