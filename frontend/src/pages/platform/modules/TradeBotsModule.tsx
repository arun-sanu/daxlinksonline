import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBots, listMarketBots, listRentals } from '../../../api/tradeBots';
import type { Bot, MarketBotSummary, Rental } from '../../../api/types';

type TradeBotRow = Bot & {
  latestVersion?: { id?: string | null; status?: string | null; language?: string | null } | null;
  counts?: { versions?: number; instances?: number; rentals?: number; orders?: number };
};

type TabKey = 'overview' | 'workspace' | 'marketplace' | 'rentals';

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
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [workspaceInput, setWorkspaceInput] = useState(() => getWorkspaceId() || DEFAULT_WORKSPACE_ID);
  const [bots, setBots] = useState<TradeBotRow[]>([]);
  const [marketBots, setMarketBots] = useState<MarketBotSummary[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [automationEnabled, setAutomationEnabled] = useState(true);

  const activeWorkspace = useMemo(() => getWorkspaceId() || '', [workspaceInput, lastLoadedAt]);

  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((bot) => {
      const text = [bot.name, bot.kind, bot.description || '', bot.latestVersion?.status || '', bot.latestVersion?.language || '']
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [bots, query]);

  const totalInstances = useMemo(
    () => bots.reduce((sum, bot) => sum + Number(bot.counts?.instances || 0), 0),
    [bots]
  );

  const activeRentals = useMemo(
    () =>
      rentals.filter((rental) => {
        const status = (rental.status || '').toLowerCase();
        return status === 'active' || status === 'running';
      }),
    [rentals]
  );

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [botsRes, marketRes, rentalsRes] = await Promise.all([listBots(), listMarketBots(), listRentals()]);
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

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '/icons/hub.svg' },
    { key: 'workspace', label: 'Workspace', icon: '/icons/smart-toy.svg' },
    { key: 'marketplace', label: 'Marketplace', icon: '/icons/account-balance.svg' },
    { key: 'rentals', label: 'Rentals', icon: '/icons/route.svg' }
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-label">Trade Bots · Global</p>
            <h2 className="headline text-3xl">Trade Bots Integration</h2>
            <p className="text-sm text-gray-300 max-w-3xl">
              Workspace bots, marketplace listings, and rentals in the same visual language as exchange integration pages.
            </p>
          </div>
          <Link to="/platform" className="text-xs uppercase tracking-[0.3em] text-primary-200">
            ← Back
          </Link>
        </div>

        <div className="mt-3 inline-flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`group relative flex aspect-square w-40 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-5 py-5 text-center text-base font-semibold transition ${
                  isActive
                    ? 'border-primary-200/80 bg-primary-400/10 text-white'
                    : 'border-white/10 bg-transparent text-white/80 hover:border-primary-400/40 hover:bg-primary-500/10'
                }`}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-bl from-white/40 to-white/0 opacity-10 z-0"></span>
                <span className={`relative z-10 flex h-10 w-10 items-center justify-center ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                  <img src={tab.icon} alt="" className="h-6 w-6" style={{ filter: 'invert(1) brightness(0.85)' }} />
                </span>
                <span className={`relative z-10 leading-snug text-base ${isActive ? 'text-white' : 'text-white/70'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Workspace Bots" value={String(bots.length)} helper="Loaded bots" />
        <MetricCard label="Active Instances" value={String(totalInstances)} helper="Across versions" />
        <MetricCard label="Marketplace" value={String(marketBots.length)} helper="Published bots" />
        <StatusToggleCard label="Automation Status" enabled={automationEnabled} onToggle={() => setAutomationEnabled((v) => !v)} />
      </section>

      {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      {activeTab === 'overview' && (
        <section className="card-shell space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Control Plane</p>
              <h3 className="text-xl font-semibold text-main">Trade bot operations summary</h3>
            </div>
            <button type="button" className="btn btn-secondary btn-small" onClick={load}>
              Refresh
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <StatCard label="Workspace" value={activeWorkspace || 'not-set'} mono />
            <StatCard label="Active rentals" value={String(activeRentals.length)} />
            <StatCard label="Last loaded" value={formatDate(lastLoadedAt)} />
          </div>
          <p className="text-sm text-gray-300">
            Use the tabs above to manage workspace bots, inspect marketplace listings, and review rentals in detail.
          </p>
        </section>
      )}

      {activeTab === 'workspace' && (
        <section className="card-shell space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-gray-300">
              Workspace ID
              <input
                className="rounded-xl border border-white/20 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-primary-300/70"
                value={workspaceInput}
                onChange={(event) => setWorkspaceInput(event.target.value)}
                placeholder="workspace UUID"
              />
            </label>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-gray-200">
              <p className="uppercase tracking-[0.16em] text-gray-400">Current workspace</p>
              <p className="mt-1 break-all font-mono text-[11px]">{activeWorkspace || 'not-set'}</p>
              <button
                type="button"
                className="mt-2 rounded-lg border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-gray-100"
                onClick={() => setWorkspaceInput(DEFAULT_WORKSPACE_ID)}
              >
                Use Provided Workspace
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleApplyWorkspace}
                className="h-[42px] rounded-xl border border-primary-300/45 bg-primary-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary-100 hover:bg-primary-500/35"
              >
                Apply + Reload
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Workspace Bots</p>
              <p className="text-sm text-gray-300">Data source: `/api/v1/trade-bots/:workspaceId/bots`</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100"
                placeholder="Search bot name/status"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" className="btn btn-secondary btn-small" onClick={load}>
                Refresh
              </button>
            </div>
          </div>

          {loading && <p className="text-sm text-gray-400">Loading trade bot data...</p>}
          {!loading && filteredBots.length === 0 && !error && <p className="text-sm text-gray-400">No bots found for this workspace.</p>}
          {!loading && filteredBots.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {filteredBots.map((bot) => (
                <article
                  key={bot.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-300/40 hover:bg-primary-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold text-white">{bot.name}</h3>
                      <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{bot.kind}</p>
                    </div>
                    <span className="rounded-lg border border-primary-300/35 bg-primary-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-primary-100">
                      {bot.latestVersion?.status || 'unknown'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-300">{bot.description || 'No description'}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                    <InfoTile label="Version" value={versionText(bot)} mono />
                    <InfoTile label="Updated" value={formatDate(bot.updatedAt)} />
                    <InfoTile label="Instances" value={String(bot.counts?.instances || 0)} />
                    <InfoTile label="Orders" value={String(bot.counts?.orders || 0)} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'marketplace' && (
        <section className="card-shell space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Marketplace Snapshot</p>
              <p className="text-sm text-gray-300">Published bots currently visible to this workspace.</p>
            </div>
            <Link to="/market" className="btn btn-white-animated btn-small">
              Open Marketplace
            </Link>
          </div>
          {loading && <p className="text-sm text-gray-400">Loading marketplace bots...</p>}
          {!loading && marketBots.length === 0 && <p className="text-sm text-gray-400">No marketplace bots available.</p>}
          {!loading && marketBots.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {marketBots.map((bot) => (
                <div key={bot.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{bot.name}</p>
                    <p className="text-xs text-gray-400">{bot.workspace?.name || '—'}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-300">
                    Plans: {bot.plans?.length || 0} • Updated: {formatDate(bot.updatedAt)}
                  </p>
                  <p className="mt-2 text-xs text-gray-400">{bot.description || 'No description provided.'}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'rentals' && (
        <section className="card-shell space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Rental Status</p>
              <p className="text-sm text-gray-300">Active and historical workspace rentals.</p>
            </div>
            <Link to="/market/rentals" className="btn btn-white-animated btn-small">
              Open Rentals
            </Link>
          </div>
          {loading && <p className="text-sm text-gray-400">Loading rentals...</p>}
          {!loading && rentals.length === 0 && <p className="text-sm text-gray-400">No rentals found for this workspace.</p>}
          {!loading && rentals.length > 0 && (
            <div className="space-y-2">
              {rentals.slice(0, 10).map((rental) => (
                <div key={rental.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{rental.bot?.name || rental.botId}</p>
                    <span className="text-xs uppercase tracking-[0.14em] text-gray-300">{rental.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Plan {rental.plan?.name || rental.planId} • Expires {formatDate(rental.expiresAt)}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">Instance {rental.botInstanceId || 'provisioning'}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto text-right">
        <p className="text-2xl font-semibold text-main">{value}</p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 mt-1">{helper}</p>
      </div>
    </div>
  );
}

function StatusToggleCard({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto flex items-center justify-between">
        <p className="text-lg font-semibold text-main">{enabled ? 'Enabled' : 'Disabled'}</p>
        <label className="relative inline-flex h-6 w-12 cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={enabled} onChange={onToggle} />
          <span className="absolute inset-0 rounded-full bg-white/10 peer-checked:bg-emerald-400/60 transition"></span>
          <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/80 transition peer-checked:translate-x-6 peer-checked:bg-emerald-100"></span>
        </label>
      </div>
    </div>
  );
}

function StatCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-2 text-sm font-mono text-gray-100 break-all' : 'mt-2 text-xl font-semibold text-white'}>{value}</p>
    </div>
  );
}

function InfoTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-1 font-mono text-[11px] text-gray-100' : 'mt-1 text-[11px] text-gray-100'}>{value}</p>
    </div>
  );
}
