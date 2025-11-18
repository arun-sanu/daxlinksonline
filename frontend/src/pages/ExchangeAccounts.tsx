import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { ExchangeAccount } from '../api/types';
import { createExchangeAccount, deleteExchangeAccount, listExchangeAccounts } from '../api/tradeBots';

const VENUES = [
  { id: 'okx', name: 'OKX', requiresPassphrase: true },
  { id: 'bybit', name: 'Bybit', requiresPassphrase: false },
  { id: 'binance', name: 'Binance', requiresPassphrase: false },
  { id: 'mexc', name: 'MEXC', requiresPassphrase: false },
  { id: 'kucoin', name: 'KuCoin', requiresPassphrase: false },
  { id: 'bitget', name: 'Bitget', requiresPassphrase: true },
  { id: 'phemex', name: 'Phemex', requiresPassphrase: false },
  { id: 'blofin', name: 'Blofin', requiresPassphrase: false }
];

const initialVenue = VENUES[0]?.id || 'okx';

type FormState = {
  name: string;
  venue: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  isSandbox: boolean;
};

const initialForm: FormState = {
  name: '',
  venue: initialVenue,
  apiKey: '',
  apiSecret: '',
  passphrase: '',
  isSandbox: false
};

export default function ExchangeAccounts() {
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(initialForm);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listExchangeAccounts();
      setAccounts(res.items);
    } catch (err) {
      console.error(err);
      setError('Unable to load exchange accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requiresPassphrase = useMemo(() => VENUES.find((v) => v.id === form.venue)?.requiresPassphrase ?? false, [form.venue]);

  const canSubmit = form.name.trim().length > 0 && form.apiKey.trim().length > 0 && form.apiSecret.trim().length > 0;

  function handleField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createExchangeAccount({
        name: form.name.trim(),
        venue: form.venue,
        apiKey: form.apiKey.trim(),
        apiSecret: form.apiSecret.trim(),
        passphrase: form.passphrase ? form.passphrase.trim() : undefined,
        isSandbox: form.isSandbox
      });
      if (!created) {
        setError('Unable to create exchange account.');
      } else {
        setForm({ ...initialForm, venue: form.venue });
        refresh();
      }
    } catch (err) {
      console.error(err);
      setError('Unable to create exchange account.');
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(account: ExchangeAccount) {
    if (!confirm(`Delete ${account.name}? This cannot be undone.`)) return;
    setDeletingId(account.id);
    setError(null);
    try {
      const ok = await deleteExchangeAccount(account.id);
      if (!ok) {
        setError('Unable to delete exchange account.');
      }
      refresh();
    } catch (err) {
      console.error(err);
      setError('Unable to delete exchange account.');
    } finally {
      setDeletingId(null);
    }
  }

  function venueLabel(id: string) {
    return VENUES.find((v) => v.id === id)?.name || id.toUpperCase();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Exchange Accounts</h1>
        <p className="text-gray-500">Connect broker credentials for orchestrated trade bots.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={onSubmit} className="border rounded p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              className="w-full rounded border px-3 py-2 bg-white dark:bg-gray-900"
              value={form.name}
              onChange={(e) => handleField('name', e.target.value)}
              placeholder="My OKX Futures"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
            <select
              className="w-full rounded border px-3 py-2 bg-white dark:bg-gray-900"
              value={form.venue}
              onChange={(e) => handleField('venue', e.target.value)}
            >
              {VENUES.map((venue) => (
                <option key={venue.id} value={venue.id}>{venue.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
              API Key
              <span className="text-gray-400 cursor-help" title="Keys are encrypted with Vault/KMS and never shown again.">ℹ️</span>
            </label>
            <input
              type="text"
              className="w-full rounded border px-3 py-2 bg-white dark:bg-gray-900"
              value={form.apiKey}
              onChange={(e) => handleField('apiKey', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Secret</label>
            <input
              type="password"
              className="w-full rounded border px-3 py-2 bg-white dark:bg-gray-900"
              value={form.apiSecret}
              onChange={(e) => handleField('apiSecret', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
              Passphrase (optional)
              {requiresPassphrase && <span className="text-xs text-yellow-600">Required for {venueLabel(form.venue)}</span>}
            </label>
            <input
              type="password"
              className="w-full rounded border px-3 py-2 bg-white dark:bg-gray-900"
              value={form.passphrase}
              onChange={(e) => handleField('passphrase', e.target.value)}
              placeholder={requiresPassphrase ? 'Enter API passphrase' : 'Leave blank if not applicable'}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isSandbox}
              onChange={(e) => handleField('isSandbox', e.target.checked)}
            />
            Sandbox / Testnet account
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={!canSubmit || creating}
            className={`w-full px-4 py-2 rounded text-white ${!canSubmit || creating ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {creating ? 'Saving…' : 'Save Account'}
          </button>
        </form>

        <div className="border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Connected Accounts</h2>
            <button className="text-sm text-blue-600" onClick={refresh}>Refresh</button>
          </div>
          {loading ? (
            <div className="text-gray-500 text-sm">Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div className="text-gray-500 text-sm">No exchange accounts yet. Add one using the form.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-800">
                  <tr>
                    <th className="text-left px-2 py-1">Name</th>
                    <th className="text-left px-2 py-1">Venue</th>
                    <th className="text-left px-2 py-1">Mode</th>
                    <th className="text-left px-2 py-1">Added</th>
                    <th className="text-left px-2 py-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className="border-t border-gray-200 dark:border-gray-800">
                      <td className="px-2 py-2 font-medium">{account.name}</td>
                      <td className="px-2 py-2">{venueLabel(account.venue)}</td>
                      <td className="px-2 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${account.isSandbox ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                          {account.isSandbox ? 'Sandbox' : 'Live'}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{new Date(account.createdAt).toLocaleDateString()}</td>
                      <td className="px-2 py-2 text-right">
                        <button
                          className="text-sm text-red-600 hover:underline"
                          onClick={() => onDelete(account)}
                          disabled={deletingId === account.id}
                        >
                          {deletingId === account.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
