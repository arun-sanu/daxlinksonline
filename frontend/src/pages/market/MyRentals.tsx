import { useEffect, useState } from 'react';
import type { Rental } from '../../api/types';
import { listRentals } from '../../api/tradeBots';
import { Link } from 'react-router-dom';

export default function MyRentals() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await listRentals();
      setRentals(res.items);
    } catch (err) {
      console.error(err);
      setError('Unable to load rentals.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Rentals</h1>
          <p className="text-gray-500">Active marketplace subscriptions tied to your workspace.</p>
        </div>
        <button onClick={refresh} className="text-sm text-blue-600">Refresh</button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading ? (
        <div className="text-gray-500">Loading rentals…</div>
      ) : rentals.length === 0 ? (
        <div className="text-gray-500">No rentals yet. Visit the <Link className="text-blue-600" to="/market">Marketplace</Link> to rent a bot.</div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="text-left px-3 py-2">Bot</th>
                <th className="text-left px-3 py-2">Plan</th>
                <th className="text-left px-3 py-2">Exchange</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Expires</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rentals.map((rental) => (
                <tr key={rental.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-3 py-2">
                    <div className="font-medium">{rental.bot?.name || rental.botId}</div>
                    <div className="text-xs text-gray-500">Revenue share {rental.revenueShareBps / 100}%</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{rental.plan?.name || 'Plan'}</div>
                    {rental.plan && <div className="text-xs text-gray-500">${rental.plan.priceMonthly}/mo</div>}
                  </td>
                  <td className="px-3 py-2">{rental.exchangeAccount?.name || rental.exchangeAccountId}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusClass(rental.status)}`}>{rental.status}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(rental.expiresAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    {rental.botInstanceId ? (
                      <Link to={`/instances/${rental.botInstanceId}`} className="text-blue-600 hover:underline text-sm">
                        Manage Instance
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-500">Provisioning…</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusClass(status: string) {
  if (status === 'active') return 'bg-green-100 text-green-800';
  if (status === 'canceled') return 'bg-gray-200 text-gray-800';
  if (status === 'expired') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-800';
}
