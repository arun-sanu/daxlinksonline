import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { Bot } from '../api/types';
import { getBot } from '../api/tradeBots';
import BotInstanceControlsPanel from '../components/BotInstanceControlsPanel';

type BotDetail = Bot & {
  counts?: {
    versions?: number;
    instances?: number;
    rentals?: number;
    orders?: number;
    runs?: number;
    guardrailEvents?: number;
  };
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function TradeBotDetail() {
  const { botId = '' } = useParams();
  const [bot, setBot] = useState<BotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);

  const metrics = useMemo(
    () => ({
      versions: Number(bot?.counts?.versions || 0),
      instances: Number(bot?.counts?.instances || 0),
      rentals: Number(bot?.counts?.rentals || 0)
    }),
    [bot]
  );

  const load = useCallback(async () => {
    if (!botId) {
      setError('Missing bot id.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getBot(botId);
      if (!result) {
        setBot(null);
        setError('Bot not found.');
      } else {
        setBot(result as BotDetail);
      }
    } catch (err: any) {
      setBot(null);
      setError(err?.message || 'Failed to load bot detail.');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Trade Bot Detail</h1>
        <p className="text-gray-500">Inspect bot metadata and control deployed instances from popup runtime controls.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link to="/trade-bots" className="rounded border border-white/15 px-3 py-2 text-sm text-gray-100">
          Back To Trade Bots
        </Link>
        <Link to={`/trade-bots/${botId}/instances`} className="rounded border border-white/15 px-3 py-2 text-sm text-gray-100">
          Open Instances Page
        </Link>
        <button type="button" className="rounded border border-white/15 px-3 py-2 text-sm text-gray-100" onClick={load}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="rounded border border-primary-300/35 bg-primary-500/10 px-3 py-2 text-sm text-primary-100"
          onClick={() => setShowControls(true)}
          disabled={!botId}
        >
          Open Runtime Popup
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading bot detail…</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}

      {bot && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-100">{bot.name}</h2>
              <p className="mt-1 text-sm text-gray-400">{bot.description || 'No description provided.'}</p>
              <p className="mt-2 text-xs text-gray-500">Bot ID: {bot.id}</p>
            </div>
            <div className="grid min-w-[18rem] gap-2 text-xs">
              <div className="rounded border border-white/10 bg-black/30 px-3 py-2">Kind: {bot.kind}</div>
              <div className="rounded border border-white/10 bg-black/30 px-3 py-2">Latest Version: {bot.latestVersionId || '—'}</div>
              <div className="rounded border border-white/10 bg-black/30 px-3 py-2">Updated: {formatDate(bot.updatedAt)}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm">
              <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400">Versions</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{metrics.versions}</div>
            </div>
            <div className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm">
              <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400">Instances</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{metrics.instances}</div>
            </div>
            <div className="rounded border border-white/10 bg-black/30 px-3 py-2 text-sm">
              <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400">Rentals</div>
              <div className="mt-1 text-lg font-semibold text-gray-100">{metrics.rentals}</div>
            </div>
          </div>
        </section>
      )}

      {showControls && botId && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowControls(false)}
        >
          <div
            className="mx-auto w-full max-w-5xl rounded-3xl border border-white/15 bg-black/90 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 px-6 py-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Runtime Controls</p>
                <h3 className="text-3xl font-semibold text-main">{bot?.name || botId}</h3>
                <p className="mt-1 text-sm text-gray-300">Start, pause, restart, and stop controls for all bot instances.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowControls(false)}>
                Close
              </button>
            </div>

            <div className="p-6">
              <BotInstanceControlsPanel botId={botId} showHeader />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
