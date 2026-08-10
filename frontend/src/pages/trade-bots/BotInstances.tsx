import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BotInstance } from '../../api/types';
import { listInstances } from '../../api/tradeBots';

export default function BotInstances() {
  const { botId } = useParams();
  const [items, setItems] = useState<BotInstance[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!botId) return;
    setLoading(true);
    const res = await listInstances(botId);
    setItems(res.items);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [botId]);

  const defaultPlan = useMemo(() => '250m / 256MiB', []);

  function statusClass(status: string) {
    if (status === 'running') return 'bg-green-100 text-green-800';
    if (status === 'error') return 'bg-red-100 text-red-800';
    if (status === 'paused') return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-800';
  }

  function formatTimestamp(ts?: string | null) {
    return ts ? new Date(ts).toLocaleString() : '—';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Instances</h2>
        <button className="px-3 py-2 rounded bg-blue-600 text-white">New Instance</button>
      </div>
      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="text-left p-2">Symbol</th>
                <th className="text-left p-2">Exchange</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">CPU/RAM Plan</th>
                <th className="text-left p-2">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td className="p-3 text-gray-500" colSpan={5}>No instances yet</td></tr>
              )}
              {items.map((i) => (
                <tr key={i.id} className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/30">
                  <td className="p-2 font-medium">
                    <Link to={`/instances/${i.id}`} className="text-blue-600 hover:underline">
                      {i.symbol}
                    </Link>
                  </td>
                  <td className="p-2">{i.exchangeAccountId}</td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs capitalize ${statusClass(i.status)}`}>{i.status}</span>
                  </td>
                  <td className="p-2">{defaultPlan}</td>
                  <td className="p-2 whitespace-nowrap">{formatTimestamp(i.startedAt || i.stoppedAt || i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
