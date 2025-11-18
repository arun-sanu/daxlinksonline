/**
 * Policy engine for notification topics and channel choice.
 */

/**
 * Whether a topic is allowed by user preferences.
 * @param {string} topic
 * @param {any} prefs
 */
export function topicAllowed(topic, prefs) {
  if (!prefs) return true;
  return (
    (topic === "signal.tradingview.received" && prefs.tvSignals) ||
    (topic === "bot.trade.executed" && prefs.botTrades) ||
    (topic === "exchange.order.executed" && prefs.exchangeFills) ||
    (topic === "system.error" && prefs.errors) ||
    (topic === "subscription.updated" && prefs.subscriptions) ||
    (topic === "promotion.broadcast" && prefs.promotions)
  );
}

/**
 * Choose delivery channel based on availability and preferred channel.
 * @param {{ hasAndroid: boolean, hasTelegram: boolean, preferred?: string|null }} p
 */
export function chooseChannel({ hasAndroid, hasTelegram, preferred }) {
  const order = preferred ? [preferred, "ANDROID", "TELEGRAM"] : ["ANDROID", "TELEGRAM"];
  const ok = (ch) => (ch === "ANDROID" ? hasAndroid : ch === "TELEGRAM" ? hasTelegram : false);
  return order.find(ok) || null;
}

