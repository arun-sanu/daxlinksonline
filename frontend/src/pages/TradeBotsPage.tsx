import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { Bot } from '../api/types';
import { listBots } from '../api/tradeBots';
import BotInstanceControlsPanel from '../components/BotInstanceControlsPanel';

type BotRow = Bot & {
  latestVersion?: {
    id?: string | null;
    status?: string | null;
    language?: string | null;
  } | null;
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

function normalizeVersionStatus(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function versionStatusLabel(bot: BotRow) {
  const status = normalizeVersionStatus(bot.latestVersion?.status);
  if (status) return status;
  return bot.latestVersionId ? 'versioned' : 'unversioned';
}

function versionStatusClass(bot: BotRow) {
  const status = normalizeVersionStatus(bot.latestVersion?.status);
  if (['published', 'approved', 'running', 'active'].includes(status)) {
    return 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100';
  }
  if (['rejected', 'failed', 'error', 'disabled'].includes(status)) {
    return 'border-rose-300/45 bg-rose-500/15 text-rose-100';
  }
  if (['draft', 'building', 'scanning', 'pending'].includes(status)) {
    return 'border-amber-300/45 bg-amber-500/15 text-amber-100';
  }
  return 'border-white/20 bg-white/10 text-gray-200';
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function WidgetCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{helper}</p>
    </article>
  );
}

function StatItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className={`mt-1 text-xs text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

export default function TradeBotsPage() {
  const [items, setItems] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedBot, setSelectedBot] = useState<BotRow | null>(null);

  const totalInstances = useMemo(
    () => items.reduce((sum, bot) => sum + toNumber(bot.counts?.instances), 0),
    [items]
  );
  const botsWithInstances = useMemo(
    () => items.filter((bot) => toNumber(bot.counts?.instances) > 0).length,
    [items]
  );
  const publishedOrActiveBots = useMemo(
    () =>
      items.filter((bot) => {
        const status = normalizeVersionStatus(bot.latestVersion?.status);
        return ['published', 'approved', 'running', 'active'].includes(status);
      }).length,
    [items]
  );
  const guardrailAlertBots = useMemo(
    () =>
      items.filter((bot) => Boolean(bot.guardrailAlert) || toNumber(bot.counts?.guardrailEvents) > 0).length,
    [items]
  );
  const recentlyUpdatedBots = useMemo(() => {
    const windowMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    return items.filter((bot) => {
      const ts = new Date(bot.updatedAt).getTime();
      return Number.isFinite(ts) && now - ts <= windowMs;
    }).length;
  }, [items]);
  const avgInstancesPerBot = useMemo(() => {
    if (items.length === 0) return '0.0';
    return (totalInstances / items.length).toFixed(1);
  }, [items.length, totalInstances]);

  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return items;
    return items.filter((bot) => {
      const haystack = [
        bot.name,
        bot.kind,
        bot.description || '',
        bot.latestVersionId || '',
        bot.latestVersion?.status || '',
        bot.latestVersion?.language || ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [items, query]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listBots();
      const nextItems = ((response.items || []) as BotRow[]).slice().sort((a, b) => {
        const aTs = new Date(a.updatedAt).getTime();
        const bTs = new Date(b.updatedAt).getTime();
        return bTs - aTs;
      });
      setItems(nextItems);
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
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-main">Trade Bots</h1>
        <p className="text-sm text-gray-300">
          Card-based bot catalog with direct runtime popup controls and quick health signals.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <WidgetCard label="Bots" value={String(items.length)} helper="Workspace catalog size" />
        <WidgetCard label="Instances" value={String(totalInstances)} helper="Total deployed instances" />
        <WidgetCard label="Bots With Instances" value={String(botsWithInstances)} helper="Ready for runtime control" />
        <WidgetCard label="Published/Active" value={String(publishedOrActiveBots)} helper="Live or approved statuses" />
        <WidgetCard label="Guardrail Alerts" value={String(guardrailAlertBots)} helper="Needs risk attention" />
        <WidgetCard label="Updated (24h)" value={String(recentlyUpdatedBots)} helper={`Avg instances/bot: ${avgInstancesPerBot}`} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            className="w-64 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-gray-100 outline-none focus:border-primary-300/60"
            placeholder="Search bot name, status, kind"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 transition hover:border-primary-300/45 hover:bg-primary-500/10"
            onClick={load}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/market" className="btn btn-white-animated btn-small">
            Open Marketplace
          </Link>
          <Link to="/market/rentals" className="btn btn-secondary btn-small">
            My Rentals
          </Link>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading bots…</p>}
      {error && <p className="rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{error}</p>}
      {!loading && !error && filteredItems.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">No bots found for this filter.</p>
      )}

      {!loading && filteredItems.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((bot) => (
            <article key={bot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-300/40 hover:bg-primary-500/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{bot.name}</h3>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-gray-400">
                    {bot.kind} {bot.latestVersion?.language ? `· ${bot.latestVersion.language}` : ''}
                  </p>
                </div>
                <span className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${versionStatusClass(bot)}`}>
                  {versionStatusLabel(bot)}
                </span>
              </div>

              <p className="mt-3 min-h-12 text-sm text-gray-300">{bot.description || 'No description available.'}</p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <StatItem label="Instances" value={String(toNumber(bot.counts?.instances))} />
                <StatItem label="Orders" value={String(toNumber(bot.counts?.orders))} />
                <StatItem label="Version" value={bot.latestVersion?.id || bot.latestVersionId || '—'} mono />
                <StatItem label="Updated" value={formatDate(bot.updatedAt)} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-primary-300/45 bg-primary-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary-100"
                  onClick={() => setSelectedBot(bot)}
                >
                  Open Bot Popup
                </button>
                <Link to={`/trade-bots/${bot.id}`} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-gray-100">
                  Detail
                </Link>
                <Link to={`/trade-bots/${bot.id}/instances`} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-gray-100">
                  Instances
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}

      {selectedBot && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedBot(null)}
        >
          <div
            className="mx-auto w-full max-w-5xl rounded-3xl border border-white/15 bg-black/90 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 px-6 py-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Bot Popup</p>
                <h3 className="text-3xl font-semibold text-main">{selectedBot.name}</h3>
                <p className="mt-1 text-sm text-gray-300">Review bot context and control all instances from one place.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectedBot(null)}>
                Close
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <WidgetCard label="Kind" value={selectedBot.kind.toUpperCase()} helper="Execution mode" />
                <WidgetCard label="Instances" value={String(toNumber(selectedBot.counts?.instances))} helper="Deployed runtime count" />
                <WidgetCard label="Orders" value={String(toNumber(selectedBot.counts?.orders))} helper="Orders mapped in summary" />
                <WidgetCard label="Updated" value={formatDate(selectedBot.updatedAt)} helper="Last bot update timestamp" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Link to={`/trade-bots/${selectedBot.id}`} className="btn btn-secondary btn-small">
                  Open Detail Page
                </Link>
                <Link to={`/trade-bots/${selectedBot.id}/instances`} className="btn btn-secondary btn-small">
                  Open Instances Page
                </Link>
              </div>

              <BotInstanceControlsPanel
                botId={selectedBot.id}
                showHeader
                title="Runtime Controls"
                subtitle="Start, pause, restart, and stop this bot’s instances."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
