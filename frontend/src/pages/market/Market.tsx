import { useEffect, useMemo, useState } from 'react';
import type { ExchangeAccount, MarketBotSummary, Plan } from '../../api/types';
import { listExchangeAccounts, listMarketBots, rentBot } from '../../api/tradeBots';
import { Link } from 'react-router-dom';

type RentState = {
  bot: MarketBotSummary | null;
  planId: string;
  exchangeId: string;
  symbol: string;
};

export default function Market() {
  const [bots, setBots] = useState<MarketBotSummary[]>([]);
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [rentState, setRentState] = useState<RentState>({ bot: null, planId: '', exchangeId: '', symbol: 'BTCUSDT' });
  const [renting, setRenting] = useState(false);
  const [rentMessage, setRentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [marketRes, exchRes] = await Promise.all([listMarketBots(), listExchangeAccounts()]);
      setBots(marketRes.items);
      setAccounts(exchRes.items);
    } catch (err) {
      console.error(err);
      setError('Unable to load marketplace data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function openRentDrawer(bot: MarketBotSummary) {
    const firstPlan = bot.plans[0]?.id || '';
    setRentState({ bot, planId: firstPlan, exchangeId: accounts[0]?.id || '', symbol: 'BTCUSDT' });
    setRentMessage(null);
    setError(null);
  }

  const drawerOpen = rentState.bot !== null;
  const selectedPlan = rentState.bot?.plans.find((p) => p.id === rentState.planId) || null;
  const exchangeOptions = useMemo(() => accounts.map((acc) => ({ value: acc.id, label: `${acc.name} (${acc.venue})` })), [accounts]);

  async function confirmRent() {
    if (!rentState.bot || !rentState.planId || !rentState.exchangeId) return;
    setRenting(true);
    setRentMessage(null);
    setError(null);
    try {
      const resp = await rentBot(rentState.bot.id, {
        planId: rentState.planId,
        exchangeAccountId: rentState.exchangeId,
        symbol: rentState.symbol || 'BTCUSDT'
      });
      if (!resp) {
        setError('Unable to rent bot.');
      } else {
        setRentMessage(`Rental confirmed. Manage instance ${resp.instanceId ? `#${resp.instanceId}` : ''} from My Rentals.`);
      }
    } catch (err) {
      console.error(err);
      setError('Unable to rent bot.');
    } finally {
      setRenting(false);
    }
  }

  function closeDrawer() {
    setRentState({ bot: null, planId: '', exchangeId: '', symbol: 'BTCUSDT' });
    setRentMessage(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Marketplace</h1>
          <p className="text-gray-500">Discover published bots and rent capacity with managed plans.</p>
        </div>
        <Link to="/market/rentals" className="px-3 py-2 rounded bg-blue-600 text-white text-sm">
          View My Rentals
        </Link>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading ? (
        <div className="text-gray-500">Loading marketplace…</div>
      ) : bots.length === 0 ? (
        <div className="text-gray-500">No published bots available yet.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {bots.map((bot) => (
            <article key={bot.id} className="border rounded-lg p-4 bg-white dark:bg-gray-900/60 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{bot.name}</h2>
                    <p className="text-sm text-gray-500">by {bot.workspace.name}</p>
                  </div>
                  <div className="text-right text-sm text-yellow-600">★★★★★ 4.8</div>
                </div>
                <p className="text-sm text-gray-600 mt-2 min-h-[3rem]">{bot.description || 'No description provided.'}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-800">
                    <div className="text-gray-500">Updated</div>
                    <div>{bot.updatedAt ? new Date(bot.updatedAt).toLocaleDateString() : '—'}</div>
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-800">
                    <div className="text-gray-500">Plans</div>
                    <div>{bot.plans.length || 0}</div>
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-800">
                    <div className="text-gray-500">Starting</div>
                    <div>{formatPrice(bot.plans[0])}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <button
                  className={`w-full px-4 py-2 rounded text-white ${bot.plans.length ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}
                  onClick={() => openRentDrawer(bot)}
                  disabled={!bot.plans.length}
                >
                  Rent Bot
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {drawerOpen && rentState.bot && (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={closeDrawer}>
          <div className="w-full max-w-md h-full bg-white dark:bg-gray-900 shadow-xl p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold">Rent {rentState.bot.name}</h3>
                <p className="text-sm text-gray-500">{rentState.bot.workspace.name}</p>
              </div>
              <button onClick={closeDrawer} className="text-gray-500 hover:text-gray-800">✕</button>
            </div>
            {rentState.bot.plans.length === 0 ? (
              <div className="text-sm text-gray-500">Publisher has no active plans available.</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium mb-2">Choose Plan</div>
                  <div className="space-y-2">
                    {rentState.bot.plans.map((plan) => (
                      <label key={plan.id} className={`block border rounded p-3 cursor-pointer ${rentState.planId === plan.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-800'}`}>
                        <div className="flex items-center gap-2">
                          <input type="radio" name="plan" checked={rentState.planId === plan.id} onChange={() => setRentState((prev) => ({ ...prev, planId: plan.id }))} />
                          <div className="flex-1">
                            <div className="font-medium">{plan.name}</div>
                            <div className="text-xs text-gray-500">CPU {plan.cpuMilli}m · Mem {plan.memMiB} MiB</div>
                          </div>
                          <div className="font-semibold">{formatPlanPrice(plan)}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Exchange Account</label>
                  {exchangeOptions.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No exchange accounts found. <Link to="/exchange-accounts" className="text-blue-600">Add one first</Link>.
                    </p>
                  ) : (
                    <select
                      className="w-full border rounded px-3 py-2 bg-white dark:bg-gray-900"
                      value={rentState.exchangeId}
                      onChange={(e) => setRentState((prev) => ({ ...prev, exchangeId: e.target.value }))}
                    >
                      {exchangeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Symbol</label>
                  <input
                    type="text"
                    value={rentState.symbol}
                    onChange={(e) => setRentState((prev) => ({ ...prev, symbol: e.target.value }))}
                    className="w-full border rounded px-3 py-2 bg-white dark:bg-gray-900"
                  />
                </div>
                {rentMessage && <div className="text-sm text-green-600">{rentMessage}</div>}
                {error && <div className="text-sm text-red-600">{error}</div>}
                <button
                  className={`w-full px-4 py-2 rounded text-white ${rentState.planId && rentState.exchangeId && exchangeOptions.length ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}
                  onClick={confirmRent}
                  disabled={renting || !rentState.planId || !rentState.exchangeId || exchangeOptions.length === 0}
                >
                  {renting ? 'Booking…' : `Rent for ${formatPlanPrice(selectedPlan)}`}
                </button>
                <p className="text-xs text-gray-500">
                  Renting deploys a managed instance in your workspace. Fees are billed monthly; cancel anytime before renewal.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatPlanPrice(plan?: Plan | null) {
  if (!plan) return '$—';
  return `$${plan.priceMonthly}/mo`;
}

function formatPrice(plan?: Plan) {
  if (!plan) return '$—';
  return `$${plan.priceMonthly}`;
}
