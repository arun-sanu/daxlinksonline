import { useEffect, useState } from 'react';
import type { Bot } from '../../api/types';
import { listBots, createBot } from '../../api/tradeBots';

export default function BotsList() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'webhook', description: '' });
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const res = await listBots();
    setBots(res.items);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate() {
    setSaving(true);
    try {
      const bot = await createBot({ name: form.name.trim(), kind: form.kind as any, description: form.description || null });
      setBots((prev) => [bot, ...prev]);
      setShowModal(false);
      setForm({ name: '', kind: 'webhook', description: '' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Trade Bots</h1>
        <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={() => setShowModal(true)}>New Bot</button>
      </div>
      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Kind</th>
                <th className="text-left p-2">Latest</th>
                <th className="text-left p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {bots.length === 0 && (
                <tr><td className="p-3 text-gray-500" colSpan={4}>No bots yet</td></tr>
              )}
              {bots.map((b) => (
                <tr key={b.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <span>{b.name}</span>
                      {b.guardrailAlert && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Guardrails</span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">{b.kind}</td>
                  <td className="p-2">{b.latestVersionId || '-'}</td>
                  <td className="p-2">{new Date(b.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded shadow w-full max-w-md p-4 space-y-3">
            <h2 className="text-lg font-semibold">New Bot</h2>
            <div className="space-y-2">
              <label className="block text-sm">Name</label>
              <input className="w-full border rounded px-2 py-1 bg-transparent" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="block text-sm">Kind</label>
              <select className="w-full border rounded px-2 py-1 bg-transparent" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="webhook">Webhook</option>
                <option value="code">Code</option>
                <option value="rule">Rule</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm">Description</label>
              <textarea className="w-full border rounded px-2 py-1 bg-transparent" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="px-3 py-2" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={saving || !form.name.trim()} onClick={onCreate}>
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
