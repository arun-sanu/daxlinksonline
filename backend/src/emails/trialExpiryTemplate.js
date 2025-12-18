export function renderTrialExpiryWarning({ name, prefix, baseDomain = 'daxlinksonline.link', hoursLeft = 24 }) {
  const user = name || 'Trader';
  const host = prefix ? `${prefix}.${baseDomain}` : baseDomain;
  const url = `https://${host}/webhook/tradingview`;
  return `
  <div style="font-family:Inter,Arial,sans-serif;background:#0D0E13;color:#e6e6e6;padding:24px">
    <h2 style="color:#00D4AA;margin:0 0 12px">Your webhook will stop in ${hoursLeft}h</h2>
    <p style="margin:0 0 12px">Hi ${user}, your free TradingView webhook is about to expire.</p>
    <p style="margin:0 0 12px">URL: <code>${url}</code></p>
    <p style="margin:0 0 12px">Remember to keep the ?secret=YOUR_SECRET query param (and optional <code>\"hmac\"</code> field in your JSON message) configured in TradingView.</p>
    <p style="margin:0 0 20px">Keep it alive forever for $9/mo.</p>
    <a href="${process.env.APP_BASE_URL || 'https://app.daxlinks.online'}/upgrade" style="background:#00D4AA;color:#0D0E13;padding:10px 16px;border-radius:8px;text-decoration:none">Upgrade now</a>
  </div>`;
}
