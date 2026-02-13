import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Bot } from '../api/types';
import { listBots } from '../api/tradeBots';

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function TradeBotsPage() {
  const [items, setItems] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      setError(null);
      try {
        const response = await listBots();
        if (!mounted) return;
        setItems(response.items || []);
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || 'Failed to load trade bots.');
        setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Trade Bots</h1>
        <p className="text-gray-500">Workspace bot catalog with published versions and latest updates.</p>
      </header>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">Total bots: {items.length}</p>
        <div className="flex items-center gap-2">
          <Link to="/market" className="rounded bg-blue-600 px-3 py-2 text-sm text-white">
            Open Marketplace
          </Link>
          <button
            type="button"
            className="rounded border border-white/10 px-3 py-2 text-sm text-gray-200"
            onClick={() => window.location.reload()}
          >
            Refresh
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
                <th className="px-3 py-2">Latest Version</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((bot) => (
                <tr key={bot.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-semibold">{bot.name}</td>
                  <td className="px-3 py-2 uppercase">{bot.kind}</td>
                  <td className="px-3 py-2 font-mono text-xs">{bot.latestVersionId || '—'}</td>
                  <td className="px-3 py-2 text-xs">{formatDate(bot.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
