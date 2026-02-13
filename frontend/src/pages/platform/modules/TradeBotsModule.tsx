import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBots, listMarketBots, listRentals } from '../../../api/tradeBots';
import type { Bot, MarketBotSummary, Rental } from '../../../api/types';

type TradeBotRow = Bot & {
  description?: string | null;
  latestVersion?: { id?: string | null; status?: string | null; language?: string | null } | null;
  counts?: { versions?: number; instances?: number; rentals?: number; orders?: number };
};

const DEFAULT_WORKSPACE_ID = '1cf2ee51-ff24-4b38-a7a3-bd0a45a9d0ba';

function getWorkspaceId() {
  try {
    return localStorage.getItem('workspaceId') || '';
  } catch {
    return '';
  }
}

function setWorkspaceId(value: string) {
  try {
    localStorage.setItem('workspaceId', value);
  } catch {
    // ignore storage failures
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function versionText(bot: TradeBotRow) {
  if (bot.latestVersion?.id) return bot.latestVersion.id;
  if (bot.latestVersionId) return bot.latestVersionId;
  return 'No version';
}

export default function TradeBotsModule() {
  const [workspaceInput, setWorkspaceInput] = useState(() => getWorkspaceId() || DEFAULT_WORKSPACE_ID);
  const [bots, setBots] = useState<TradeBotRow[]>([]);
  const [marketBots, setMarketBots] = useState<MarketBotSummary[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const activeWorkspace = useMemo(() => getWorkspaceId() || '', [workspaceInput, lastLoadedAt]);

  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((bot) => {
      const text = [
        bot.name,
        bot.kind,
        bot.description || '',
        bot.latestVersion?.status || '',
        bot.latestVersion?.language || ''
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [bots, query]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [botsRes, marketRes, rentalsRes] = await Promise.all([
        listBots(),
        listMarketBots(),
        listRentals()
      ]);
      setBots((botsRes.items || []) as TradeBotRow[]);
      setMarketBots(marketRes.items || []);
      setRentals(rentalsRes.items || []);
      setLastLoadedAt(new Date().toISOString());
    } catch (err: any) {
      setError(err?.message || 'Failed to load trade bot module data.');
      setBots([]);
      setMarketBots([]);
      setRentals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleApplyWorkspace = async () => {
    const next = workspaceInput.trim();
    if (!next) return;
    setWorkspaceId(next);
    await load();
  };

  const totalInstances = useMemo(
    () => bots.reduce((sum, bot) => sum + Number(bot.counts?.instances || 0), 0),
    [bots]
  );

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-sky-300/20 bg-gradient-to-br from-[#0b1228] via-[#101836] to-[#0f2748] p-5 shadow-[0_20px_80px_rgba(14,130,255,0.2)]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-[-80px] h-48 w-48 rounded-full bg-blue-300/15 blur-3xl" />
        <div className="relative space-y-5">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.28em] text-sky-200">Trade Bots · Live Control Plane</p>
            <h2 className="text-3xl font-semibold text-white">Workspace bots + marketplace visibility</h2>
            <p className="max-w-3xl text-sm text-sky-100/85">
              This module now reads live data from your workspace and marketplace APIs. If data is missing, you can switch workspace ID and reload in place.
            </p>
          </header>
          <div className="grid gap-3 md:grid-cols-4">
            <Metric title="Workspace Bots" value={String(bots.length)} />
            <Metric title="Instances" value={String(totalInstances)} />
            <Metric title="Marketplace Bots" value={String(marketBots.length)} />
            <Metric title="Active Rentals" value={String(rentals.filter((r) => r.status === 'active').length)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-sky-100/80">
              Workspace ID
              <input
                className="rounded-xl border border-white/20 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-sky-300/70"
                value={workspaceInput}
                onChange={(event) => setWorkspaceInput(event.target.value)}
                placeholder="workspace UUID"
              />
            </label>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-sky-100/85">
              <p className="uppercase tracking-[0.16em] text-sky-200/70">Current workspace in browser</p>
              <p className="mt-1 break-all font-mono text-[11px]">{activeWorkspace || 'not-set'}</p>
              <button
                type="button"
                className="mt-2 rounded-lg border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-sky-100"
                onClick={() => setWorkspaceInput(DEFAULT_WORKSPACE_ID)}
              >
                Use Provided Workspace
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleApplyWorkspace}
                className="h-[42px] rounded-xl border border-sky-300/45 bg-sky-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 hover:bg-sky-500/35"
              >
                Apply + Reload
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Workspace Bots</p>
            <p className="text-sm text-gray-300">Real list from `/api/v1/trade-bots/:workspaceId/bots`</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100"
              placeholder="Search bot name/status"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="button"
              className="rounded-xl border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200"
              onClick={load}
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading && <p className="text-sm text-gray-400">Loading trade bot data...</p>}
        {!loading && filteredBots.length === 0 && !error && (
          <p className="text-sm text-gray-400">No bots found for this workspace.</p>
        )}

        {!loading && filteredBots.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredBots.map((bot) => (
              <article
                key={bot.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-sky-300/40 hover:bg-sky-500/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-white">{bot.name}</h3>
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{bot.kind}</p>
                  </div>
                  <span className="rounded-lg border border-sky-300/35 bg-sky-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-sky-100">
                    {bot.latestVersion?.status || 'unknown'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-300">{bot.description || 'No description'}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                  <Info label="Version" value={versionText(bot)} mono />
                  <Info label="Updated" value={formatDate(bot.updatedAt)} />
                  <Info label="Instances" value={String(bot.counts?.instances || 0)} />
                  <Info label="Orders" value={String(bot.counts?.orders || 0)} />
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="text-[11px] text-gray-500">
          Last loaded: {formatDate(lastLoadedAt)} • Workspace: {activeWorkspace || 'not-set'}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-shell space-y-3">
          <div>
            <p className="section-label">Marketplace Snapshot</p>
            <p className="text-sm text-gray-300">Published bots visible to this workspace.</p>
          </div>
          {marketBots.length === 0 ? (
            <p className="text-sm text-gray-400">No marketplace bots available.</p>
          ) : (
            <div className="space-y-2">
              {marketBots.map((bot) => (
                <div key={bot.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{bot.name}</p>
                    <p className="text-xs text-gray-400">{bot.workspace?.name || '—'}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-300">
                    Plans: {bot.plans?.length || 0} • Updated: {formatDate(bot.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Link
            to="/market"
            className="inline-flex rounded-xl border border-sky-300/40 bg-sky-500/15 px-3 py-2 text-xs uppercase tracking-[0.16em] text-sky-100"
          >
            Open Marketplace
          </Link>
        </section>

        <section className="card-shell space-y-3">
          <div>
            <p className="section-label">Rental Status</p>
            <p className="text-sm text-gray-300">Active and historical workspace rentals.</p>
          </div>
          {rentals.length === 0 ? (
            <p className="text-sm text-gray-400">No rentals found for this workspace.</p>
          ) : (
            <div className="space-y-2">
              {rentals.slice(0, 6).map((rental) => (
                <div key={rental.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{rental.bot?.name || rental.botId}</p>
                    <span className="text-xs uppercase tracking-[0.14em] text-gray-300">{rental.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Expires {formatDate(rental.expiresAt)} • Instance {rental.botInstanceId || 'provisioning'}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Link
            to="/market/rentals"
            className="inline-flex rounded-xl border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-gray-200"
          >
            Open Rentals
          </Link>
        </section>
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-sky-100">
      <p className="uppercase tracking-[0.16em] text-sky-200/80">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-1 font-mono text-[11px] text-gray-100' : 'mt-1 text-[11px] text-gray-100'}>{value}</p>
    </div>
  );
}
