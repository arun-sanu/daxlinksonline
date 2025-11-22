import { FormEvent, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

type ExchangeConfig = {
  name: string;
  region: string;
  notes?: string;
  requiresPassphrase?: boolean;
  extraFieldLabel?: string;
  supportsSandbox?: boolean;
};

const EXCHANGES: Record<string, ExchangeConfig> = {
  binance: { name: 'Binance', region: 'Global', notes: 'IP allowlists and sub-accounts supported.', extraFieldLabel: 'Sub-account (optional)', supportsSandbox: true },
  mexc: { name: 'MEXC', region: 'Global', notes: 'Use API v3; enable spot/futures permissions.', supportsSandbox: true },
  okx: { name: 'OKX', region: 'Global', notes: 'Only unified account keys supported.', requiresPassphrase: true, supportsSandbox: true },
  bybit: { name: 'Bybit', region: 'Global', notes: 'Perps + inverse supported. Toggle spot in key permissions.', supportsSandbox: true },
  zerodha: { name: 'Zerodha', region: 'India', notes: 'Session tokens expire every few hours; use auto refresh.', extraFieldLabel: 'Client ID' },
  bitget: { name: 'Bitget', region: 'Global', requiresPassphrase: true, notes: 'Enable IP binding and order write scope.', supportsSandbox: true },
  kucoin: { name: 'KuCoin', region: 'Global', requiresPassphrase: true, notes: 'API v2 keys; passphrase required.', supportsSandbox: true },
  phemex: { name: 'Phemex', region: 'Global', notes: 'USDT perps + spot supported.' },
  coinbase: { name: 'Coinbase', region: 'US', notes: 'Advanced Trade APIs only; legacy keys unsupported.' },
  kraken: { name: 'Kraken', region: 'US/EU', notes: 'Trading + funding scopes required. WebSockets optional.' }
};

type Credential = {
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  extra?: string;
  sandbox?: boolean;
};

export default function ExchangeIntegrationPage() {
  const { exchangeId } = useParams<{ exchangeId: string }>();
  const config = exchangeId ? EXCHANGES[exchangeId] : null;

  const [creds, setCreds] = useState<Credential[]>([
    { label: 'Primary', apiKey: '', apiSecret: '', passphrase: '', extra: '', sandbox: false }
  ]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const title = useMemo(() => (config ? `${config.name} Integration` : 'Integration'), [config]);

  if (!config) {
    return (
      <div className="layout-container pt-16 pb-24 space-y-4">
        <p className="text-sm text-red-500">Exchange not found.</p>
        <Link to="/platform/integrations" className="text-sm text-primary-200">← Back to integrations</Link>
      </div>
    );
  }

  function updateField(idx: number, field: keyof Credential, value: string | boolean) {
    setCreds((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setCreds((prev) => [...prev, { label: `Key ${prev.length + 1}`, apiKey: '', apiSecret: '', passphrase: '', extra: '', sandbox: false }]);
  }

  function removeRow(idx: number) {
    setCreds((prev) => prev.filter((_, i) => i !== idx));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    // In a real build this would call a POST to /api/v1/platform/integrations/{exchangeId}/keys
    setTimeout(() => {
      setSaving(false);
      setMessage(`Saved ${creds.length} credential${creds.length > 1 ? 's' : ''} for ${config.name}. Guardrails refreshed.`);
    }, 500);
  }

  return (
    <div className="layout-container pt-16 pb-24 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-label">Integrations · {config.region}</p>
          <h1 className="headline text-3xl">{title}</h1>
          {config.notes && <p className="mt-2 text-sm muted-text max-w-3xl">{config.notes}</p>}
        </div>
        <Link to="/platform/integrations" className="text-xs uppercase tracking-[0.3em] text-primary-200">← Back</Link>
      </header>

      <section className="card-shell space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-label">API credentials</p>
            <p className="text-sm text-gray-300">Store one or more key pairs; all writes are encrypted with workspace KMS.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-small" onClick={addRow}>Add another key</button>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          {creds.map((row, idx) => (
            <div key={idx} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="text-xs uppercase tracking-[0.24em] text-gray-500">Label</label>
                  <input
                    value={row.label}
                    onChange={(e) => updateField(idx, 'label', e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                    placeholder="Desk A · Futures"
                  />
                </div>
                {creds.length > 1 && (
                  <button type="button" className="text-xs text-red-400" onClick={() => removeRow(idx)}>Remove</button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-gray-500">API Key</label>
                  <input
                    value={row.apiKey}
                    onChange={(e) => updateField(idx, 'apiKey', e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-gray-500">API Secret</label>
                  <input
                    value={row.apiSecret}
                    onChange={(e) => updateField(idx, 'apiSecret', e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                    type="password"
                    required
                  />
                </div>
                {config.requiresPassphrase && (
                  <div>
                    <label className="text-xs uppercase tracking-[0.24em] text-gray-500">Passphrase</label>
                    <input
                      value={row.passphrase || ''}
                      onChange={(e) => updateField(idx, 'passphrase', e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                      type="password"
                    />
                  </div>
                )}
                {config.extraFieldLabel && (
                  <div>
                    <label className="text-xs uppercase tracking-[0.24em] text-gray-500">{config.extraFieldLabel}</label>
                    <input
                      value={row.extra || ''}
                      onChange={(e) => updateField(idx, 'extra', e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                      placeholder="Optional"
                    />
                  </div>
                )}
              </div>

              {config.supportsSandbox && (
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={!!row.sandbox}
                    onChange={(e) => updateField(idx, 'sandbox', e.target.checked)}
                  />
                  Sandbox / testnet key
                </label>
              )}
            </div>
          ))}

          {message && <div className="text-sm text-emerald-300">{message}</div>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className={`btn btn-white-animated btn-small px-6 ${saving ? 'opacity-75' : ''}`}
            >
              {saving ? 'Saving…' : 'Save keys'}
            </button>
            <Link to="/platform/integrations" className="text-xs uppercase tracking-[0.24em] text-gray-400">Cancel</Link>
          </div>
        </form>
      </section>
    </div>
  );
}
