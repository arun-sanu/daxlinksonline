import { Link } from 'react-router-dom';
import { useState } from 'react';

const webhookConfig = {
  subdomain: 'ops-9ad734',
  baseDomain: 'daxlinksonline.link',
  secret: 'c8f14d88b0f9d7aa16f90b8f23bd2a54'
};

const tradingViewPayload = `{
  "symbol": "NSE:INFY",
  "side": "buy",
  "amount": 25,
  "price": 1563.50,
  "secret": "${webhookConfig.secret}"
}`;

const mockLogs = [
  { level: 'info', message: 'Forward job queued for NSE:INFY', ts: '08:41:12' },
  { level: 'warning', message: 'Guardrail delayed webhook due to rate limit hit (retry scheduled)', ts: '08:39:04' },
  { level: 'error', message: 'TradingView secret mismatch rejected alert', ts: '08:20:31' }
];

const channels = [
  { label: 'Default TradingView', slug: 'webhook', status: 'Active', description: 'Primary NSE/BSE alerts' },
  { label: 'Options Desk', slug: 'options', status: 'Paused', description: 'Custom BankNifty Pine strategy' }
];

export default function WebhooksModule() {
  const [activeTab, setActiveTab] = useState<'setup' | 'logs'>('setup');
  const webhookUrl = `https://${webhookConfig.subdomain}.${webhookConfig.baseDomain}/webhook`;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Webhooks</p>
        <h2 className="text-3xl font-semibold text-main">TradingView → Pendax bridge</h2>
        <p className="text-sm muted-text">
          Point TradingView (or any alert emitter) to your DaxLinks subdomain. The backend validates secrets, enforces IP allowlists,
          drops the alert onto BullMQ, then forwards it through the Pendax forwarder job.
        </p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Bridge animation</p>
        <div className="iso-bridge">
          <div className="iso-node iso-node--tv">
            <span>TradingView</span>
          </div>
          <div className="iso-link" aria-hidden="true"></div>
          <div className="iso-node iso-node--dax">
            <span>Pendax</span>
          </div>
          <div className="iso-packets" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        <p className="text-xs text-gray-400">Alerts stream from TradingView into DaxLinks, traverse BullMQ, then fan out to exchanges.</p>
      </article>

      <article className="card-shell space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Connection details</p>
            <p className="text-sm text-gray-400">Configure TradingView to hit the DaxLinks ingress endpoint.</p>
          </div>
          <div className="flex gap-2 text-xs uppercase tracking-[0.3em]">
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${activeTab === 'setup' ? 'border-primary-400/60 text-primary-100' : 'border-white/10 text-gray-400'}`}
              onClick={() => setActiveTab('setup')}
            >
              Setup
            </button>
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${activeTab === 'logs' ? 'border-primary-400/60 text-primary-100' : 'border-white/10 text-gray-400'}`}
              onClick={() => setActiveTab('logs')}
            >
              Logs
            </button>
          </div>
        </div>

        {activeTab === 'setup' ? (
          <div className="grid gap-4 md:grid-cols-2 text-sm text-gray-300">
            <div>
              <p className="text-gray-400">Webhook URL</p>
              <p className="font-semibold text-main break-all">{webhookUrl}</p>
            </div>
            <div>
              <p className="text-gray-400">Shared secret</p>
              <p className="font-semibold text-main">{webhookConfig.secret}</p>
            </div>
            <div>
              <p className="text-gray-400">Rate limit</p>
              <p className="font-semibold text-main">20 alerts / sec per subdomain</p>
              <p className="text-xs text-gray-500">Handled by ingress middleware in backend/src/routes/v1/ingress.js</p>
            </div>
            <div>
              <p className="text-gray-400">Whitelisting</p>
              <p className="font-semibold text-main">TradingView IPs + optional secret</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-3 text-xs">
            {mockLogs.map((log, idx) => (
              <div key={idx} className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                <div>
                  <p className={`font-semibold ${log.level === 'error' ? 'text-red-300' : log.level === 'warning' ? 'text-amber-300' : 'text-primary-200'}`}>
                    [{log.level.toUpperCase()}]
                  </p>
                  <p className="text-gray-300">{log.message}</p>
                </div>
                <span className="text-gray-500">{log.ts}</span>
              </div>
            ))}
            <p className="text-[10px] text-gray-500">Latest events reflect backend/public/logs/webhook feed.</p>
          </div>
        )}
      </article>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">TradingView message template</p>
        <p className="text-sm text-gray-400">
          Paste the JSON below into your TradingView alert body. Guardrails inside backend/src/routes/v1/ingress.js verify the secret
          before enqueuing forward jobs.
        </p>
        <pre className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-primary-100 overflow-auto">
{tradingViewPayload}
        </pre>
      </article>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">What happens next?</p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>• ingress router logs <code>/webhook</code> receipts and sanitizes payloads.</li>
          <li>• <code>tradingviewService.forward</code> pushes the alert to BullMQ, then Pendax forwarder fans it to active exchanges.</li>
          <li>• Audit logs capture every inbound alert along with sanitized payloads.</li>
        </ul>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link
            to="/docs/webhooks"
            className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-gray-300 hover:border-primary-400/40 hover:text-primary-100"
          >
            Docs
          </Link>
          <a
            href="https://api.daxlinks.online/api/v1/ingress/webhook/test"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-gray-300 hover:border-primary-400/40 hover:text-primary-100"
          >
            Test endpoint
          </a>
        </div>
      </article>

      <article className="card-shell space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Webhook channels</p>
            <p className="text-sm text-gray-400">Stage different subpaths for desks or sandboxes.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-small">New channel</button>
        </div>
        <div className="space-y-3 text-sm text-gray-300">
          {channels.map((channel) => (
            <div key={channel.slug} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-main">{channel.label}</p>
                  <p className="text-xs text-gray-500">/{channel.slug}</p>
                </div>
                <span className={channel.status === 'Active' ? 'text-emerald-300 text-xs uppercase tracking-[0.3em]' : 'text-amber-300 text-xs uppercase tracking-[0.3em]'}>
                  {channel.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-400">{channel.description}</p>
              <p className="text-[11px] text-gray-500 break-all">https://{webhookConfig.subdomain}.{webhookConfig.baseDomain}/{channel.slug}</p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
