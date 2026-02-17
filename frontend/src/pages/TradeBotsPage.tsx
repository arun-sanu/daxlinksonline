import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { Bot } from '../api/types';
import { listBots } from '../api/tradeBots';
import BotInstanceControlsPanel from '../components/BotInstanceControlsPanel';

type BotRow = Bot & {
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

export default function TradeBotsPage() {
  const [items, setItems] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtimeBot, setRuntimeBot] = useState<BotRow | null>(null);

  const totalInstances = useMemo(
    () => items.reduce((sum, bot) => sum + Number(bot.counts?.instances || 0), 0),
    [items]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listBots();
      setItems((response.items || []) as BotRow[]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trade bots.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Trade Bots</h1>
        <p className="text-gray-500">Workspace bot catalog with lifecycle controls and runtime status.</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-400">
          Total bots: {items.length} · Total instances: {totalInstances}
        </p>
        <div className="flex items-center gap-2">
          <Link to="/market" className="rounded bg-blue-600 px-3 py-2 text-sm text-white">
            Open Marketplace
          </Link>
          <button
            type="button"
            className="rounded border border-white/10 px-3 py-2 text-sm text-gray-200"
            onClick={load}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading bots…</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-gray-500">No bots found in this workspace.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-[11px] uppercase tracking-[0.16em] text-gray-400">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Instances</th>
                <th className="px-3 py-2">Latest Version</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((bot) => (
                <tr key={bot.id} className="border-t border-white/10">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-gray-100">{bot.name}</p>
                    {bot.description && <p className="text-xs text-gray-400">{bot.description}</p>}
                  </td>
                  <td className="px-3 py-2 uppercase">{bot.kind}</td>
                  <td className="px-3 py-2">{Number(bot.counts?.instances || 0)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{bot.latestVersionId || '—'}</td>
                  <td className="px-3 py-2 text-xs">{formatDate(bot.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/trade-bots/${bot.id}`} className="rounded border border-white/15 px-2 py-1 text-xs text-gray-100">
                        Detail
                      </Link>
                      <Link
                        to={`/trade-bots/${bot.id}/instances`}
                        className="rounded border border-white/15 px-2 py-1 text-xs text-gray-100"
                      >
                        Instances
                      </Link>
                      <button
                        type="button"
                        className="rounded border border-primary-300/35 bg-primary-500/10 px-2 py-1 text-xs text-primary-100"
                        onClick={() => setRuntimeBot(bot)}
                      >
                        Runtime Popup
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runtimeBot && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onClick={() => setRuntimeBot(null)}
        >
          <div
            className="mx-auto w-full max-w-5xl rounded-3xl border border-white/15 bg-black/90 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 px-6 py-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Runtime Controls</p>
                <h3 className="text-3xl font-semibold text-main">{runtimeBot.name}</h3>
                <p className="mt-1 text-sm text-gray-300">Control instance lifecycle for this bot from one popup.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setRuntimeBot(null)}>
                Close
              </button>
            </div>

            <div className="p-6">
              <BotInstanceControlsPanel botId={runtimeBot.id} showHeader />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
