import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type Prefs = {
  tvSignals: boolean;
  botTrades: boolean;
  exchangeFills: boolean;
  errors: boolean;
  subscriptions: boolean;
  promotions: boolean;
};

const defaultPrefs: Prefs = {
  tvSignals: false,
  botTrades: false,
  exchangeFills: false,
  errors: true,
  subscriptions: true,
  promotions: false
};

const topics = [
  { key: 'tvSignals', label: 'TradingView Signals', icon: '📈' },
  { key: 'botTrades', label: 'Bot Trades', icon: '🤖' },
  { key: 'exchangeFills', label: 'Exchange Fills', icon: '💱' },
  { key: 'errors', label: 'Errors & Crashes', icon: '⚠️' },
  { key: 'subscriptions', label: 'Subscriptions', icon: '💳' },
  { key: 'promotions', label: 'Promotions', icon: '📣' }
];

export default function AlertsModule() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState('');
  const [tab, setTab] = useState<'topics' | 'channels'>('topics');

  const isTopics = useMemo(() => tab === 'topics', [tab]);
  const isChannels = useMemo(() => tab === 'channels', [tab]);

  useEffect(() => {
    const loadPrefs = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/v1/notify/preferences', { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json?.pref) {
            setPrefs((prev) => ({ ...prev, ...json.pref }));
          }
        } else {
          setError('Unable to load preferences');
        }
      } catch {
        setError('Unable to load preferences');
      } finally {
        setLoading(false);
      }
    };
    loadPrefs();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await fetch('/api/v1/notify/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(prefs)
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTestStatus('sending…');
    try {
      const res = await fetch('/api/debug/telegram-test', { credentials: 'include' });
      setTestStatus(res.ok ? 'Sent! Check Telegram' : 'Failed');
    } catch {
      setTestStatus('Network error');
    } finally {
      setTimeout(() => setTestStatus(''), 4000);
    }
  }

  function toggle(key: keyof Prefs) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-label">Alert rail</p>
          <h2 className="text-3xl font-semibold text-main">Alerts & Channels</h2>
          <p className="text-sm muted-text max-w-2xl">
            Configure which events hit the rail and where they fan out—Telegram, push, or web inbox. Mirrors the legacy console
            experience.
          </p>
        </div>
        <Link to="/platform" className="text-xs uppercase tracking-[0.28em] text-primary-200">← Back to modules</Link>
      </header>

      <div className="card-shell space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            className={`rounded-full border px-3 py-2 uppercase tracking-[0.2em] ${isTopics ? 'border-primary-300 text-primary-200' : 'border-white/10 text-gray-300'}`}
            onClick={() => setTab('topics')}
            type="button"
          >
            Topics
          </button>
          <button
            className={`rounded-full border px-3 py-2 uppercase tracking-[0.2em] ${isChannels ? 'border-primary-300 text-primary-200' : 'border-white/10 text-gray-300'}`}
            onClick={() => setTab('channels')}
            type="button"
          >
            Channels
          </button>
          {loading && <span className="text-xs text-gray-500">Loading…</span>}
          {saved && <span className="text-xs text-emerald-300">Saved ✓</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>

        {isTopics && (
          <div className="grid gap-3 sm:grid-cols-2">
            {topics.map((topic) => (
              <div key={topic.key} className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl" aria-hidden="true">{topic.icon}</span>
                  <span className="text-sm text-main">{topic.label}</span>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/30 bg-transparent"
                    checked={!!prefs[topic.key as keyof Prefs]}
                    onChange={() => toggle(topic.key as keyof Prefs)}
                  />
                  <span>Enable</span>
                </label>
              </div>
            ))}
          </div>
        )}

        {isChannels && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-main">Telegram Bot</p>
                <p className="text-xs text-gray-400">Set bot token + chat ID in settings; supports alert rail fanout.</p>
              </div>
              <button className="btn btn-secondary btn-small" type="button" onClick={sendTest}>
                {testStatus || 'Send test'}
              </button>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-main">Android Push</p>
                <p className="text-xs text-gray-400">In private beta · Q1 2026</p>
              </div>
              <span className="text-xs text-gray-500">Coming soon</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn btn-secondary btn-small px-5"
            type="button"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : 'Save configuration'}
          </button>
          <span className="text-xs text-gray-500">Changes sync to the floating alert rail.</span>
        </div>
      </div>
    </div>
  );
}
