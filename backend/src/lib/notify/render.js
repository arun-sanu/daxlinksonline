/**
 * Render helpers for channel-specific payloads.
 */

/**
 * Convert a logical topic + payload to Android FCM data map strings.
 * @param {string} topic
 * @param {Record<string,any>} p
 */
export function toAndroidData(topic, p = {}) {
  const get = (k, d = "") => p[k] == null ? d : String(p[k]);
  return {
    type: topic,
    workspace: get("workspace"),
    pair: get("pair"),
    botName: get("botName"),
    botId: get("botId"),
    side: get("side"),
    qty: get("qty"),
    price: get("price"),
    fillPct: get("fillPct"),
    fees: get("fees"),
    pnlPct: get("pnlPct"),
    pnlQuote: get("pnlQuote"),
    wallet: get("walletBalance"),
    ts: get("ts", new Date().toISOString()),
    deepLink: get("deepLink")
  };
}

/**
 * Format a Telegram plaintext message with minimal emphasis.
 * @param {string} topic
 * @param {Record<string,any>} p
 */
export function toTelegramText(topic, p = {}) {
  const fmt = (k, v) => v == null || v === "" ? null : `*${k}:* ${v}`;
  const lines = [
    `*${(topic || "ALERT").toUpperCase().replace(/[^\w]/g, " ")}*`,
    fmt("Workspace", p.workspace),
    fmt("Pair", p.pair),
    fmt("Bot", `${p.botName || ""}${p.botId ? ` (ID: ${p.botId})` : ""}`.trim()),
    fmt("Side", p.side),
    fmt("Qty", p.qty),
    fmt("Price", p.price),
    fmt("Filled", p.fillPct != null ? `${p.fillPct}%` : null),
    fmt("Fees", p.fees),
    fmt("PnL", p.pnlPct != null ? `${p.pnlPct}% (${p.pnlQuote || ""})` : null),
    fmt("Wallet", p.walletBalance),
    fmt("Time", p.ts)
  ].filter(Boolean);
  return lines.join("\n");
}

