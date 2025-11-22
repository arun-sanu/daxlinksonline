import { useEffect, useMemo, useState } from 'react';
import { createDatabase, deleteDatabase, listDatabases, rotateDatabase, type DatabaseInstance } from '../../../api/databases';

export default function DatabasesModule() {
  const [section, setSection] = useState<'dash' | 'databases'>('dash');
  const [items, setItems] = useState<DatabaseInstance[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [authBlocked, setAuthBlocked] = useState(false);

  const selectedDb = useMemo(() => items.find((d) => d.id === selectedId) || null, [items, selectedId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await listDatabases();
        if (!mounted) return;
        setItems(rows);
        if (rows.length) setSelectedId(rows[0].id);
      } catch (e: any) {
        if (mounted) {
          setError(e?.message || 'Failed to load databases');
          if (/401|403/i.test(String(e?.message))) setAuthBlocked(true);
          // fallback to skeleton data so UI stays alive
          const mockNow = new Date().toISOString();
          const mock: DatabaseInstance[] = [
            { id: 'mock-1', name: 'Signals Core', status: 'active', provider: 'self_hosted', engine: 'postgres', version: '16', region: 'ap-sg', sizeTier: 'free', storageGb: 120, computeClass: 'standard', host: 'mock-1.internal', port: 5432, database: 'db_mock1', username: 'u_mock', passwordMasked: '****', sslRequired: true, createdAt: mockNow },
            { id: 'mock-2', name: 'Guardrails', status: 'active', provider: 'self_hosted', engine: 'postgres', version: '16', region: 'us-east', sizeTier: 'free', storageGb: 90, computeClass: 'standard', host: 'mock-2.internal', port: 5432, database: 'db_mock2', username: 'u_mock', passwordMasked: '****', sslRequired: true, createdAt: mockNow }
          ];
          setItems(mock);
          setSelectedId(mock[0]?.id || '');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleCreate() {
    const name = window.prompt('Name this database');
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const row = await createDatabase({ name, region: 'us-east', storageGb: 20 });
      setItems((prev) => [row, ...prev]);
      setSelectedId(row.id);
    } catch (e: any) {
      setError(e?.message || 'Failed to create database');
    } finally {
      setCreating(false);
    }
  }

  async function handleRotate(id: string) {
    setRotating(id);
    setError('');
    try {
      const updated = await rotateDatabase(id);
      setItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    } catch (e: any) {
      setError(e?.message || 'Failed to rotate credentials');
    } finally {
      setRotating(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this database? This cannot be undone.')) return;
    setDeleting(id);
    setError('');
    try {
      await deleteDatabase(id);
      setItems((prev) => prev.filter((d) => d.id !== id));
      if (selectedId === id) setSelectedId(items.find((d) => d.id !== id)?.id || '');
    } catch (e: any) {
      setError(e?.message || 'Failed to delete database');
    } finally {
      setDeleting(null);
    }
  }

  const usagePercent = useMemo(() => {
    const total = items.reduce((a, d) => a + (d.storageGb || 0), 0);
    if (!total || items.length === 0) return 0;
    const active = items.filter((d) => d.status === 'active').length;
    return Math.min(100, Math.round(((active || 1) / items.length) * 100));
  }, [items]);

  function storagePct(db: DatabaseInstance) {
    // lacking "used" from backend; assume 40% util for display
    const base = db.storageGb || 0;
    const pct = base ? 40 : 0;
    return pct;
  }

  return (
    <div className="space-y-8 w-full max-w-6xl mx-auto px-4 md:px-6">
      <header className="space-y-3">
        <span className="section-label">Databases</span>
        <h2 className="text-3xl font-semibold text-main">Telemetry &amp; trades at rest</h2>
        <p className="max-w-3xl text-sm muted-text">
          Replica-aware document stores for signals, guardrails, and replay buffers. Built-in retention, health checks, and export flows.
        </p>
      </header>

      <nav className="flex items-center gap-6 text-[11px] uppercase tracking-[0.28em] text-gray-500">
        <button type="button" className={`transition hover:text-primary-200 ${section === 'dash' ? 'text-primary-200' : ''}`} onClick={() => setSection('dash')}>
          dash
        </button>
        <button type="button" className={`transition hover:text-primary-200 ${section === 'databases' ? 'text-primary-200' : ''}`} onClick={() => setSection('databases')}>
          databases
        </button>
      </nav>

      {section === 'dash' && (
        <section className="grid gap-6 md:grid-cols-2">
          <article className="card-shell space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Storage</p>
                <p className="text-lg text-main">Fleet utilization</p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-emerald-300">Aligned</span>
            </div>
            <p className="text-xs text-gray-300">{usagePercent}% of pooled storage allocated</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 storage-animated">
              <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${usagePercent}%` }}></div>
            </div>
            <div className="grid gap-2 text-xs text-gray-400 md:grid-cols-2">
              <p>Active: {items.filter((d) => d.status === 'active').length}</p>
              <p>Pending: {items.filter((d) => d.status === 'pending').length}</p>
            </div>
          </article>
          <article className="card-shell space-y-3">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Snapshots</p>
            <p className="text-3xl font-light text-main">8 per day</p>
            <p className="text-sm text-gray-400">Shipped to cold storage + customer vaults with signed manifests.</p>
            <p className="text-xs text-gray-500">Retention: 35 days · Geo: ap-sg/us-east/eu-central</p>
          </article>
        </section>
      )}

      {section === 'databases' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Home · Databases</p>
              <h3 className="mt-1 text-2xl font-semibold text-main">My databases</h3>
            </div>
            <div className="flex items-center gap-3">
              {error && <div className="text-xs text-red-300">{error}</div>}
              <button
                type="button"
                className="btn btn-primary btn-white-animated text-xs tracking-[0.28em]"
                onClick={handleCreate}
                disabled={creating || authBlocked}
              >
                {creating ? 'Creating…' : '+ New Database'}
              </button>
            </div>
          </div>
          {authBlocked && <p className="text-xs text-amber-300">Sign in as super admin to manage databases. Showing demo data.</p>}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <aside className="space-y-3">
              {loading && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400 animate-pulse">Loading databases…</div>
              )}
              {!loading && items.length === 0 && <p className="text-sm text-gray-400">No databases yet.</p>}
              {items.map((db) => (
                <button
                  key={db.id}
                  type="button"
                  onClick={() => setSelectedId(db.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedId === db.id ? 'border-primary-400/50 bg-primary-400/5 shadow-[0_0_25px_rgba(107,107,247,0.25)]' : 'border-white/10 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between text-main">
                    <span className="font-semibold">{db.name}</span>
                    <span className="text-[11px] uppercase tracking-[0.24em] text-gray-400">{db.region || 'n/a'}</span>
                  </div>
                  <p className="text-xs text-gray-400">{db.status}</p>
                  <p className="text-xs text-gray-400">Size · {db.storageGb ?? 0} GB</p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10 storage-animated">
                    <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${storagePct(db)}%` }}></div>
                  </div>
                </button>
              ))}
            </aside>

            <section className="space-y-4">
              {!selectedDb && <p className="text-sm text-gray-400">Select a database to view details.</p>}
              {selectedDb && (
                <>
                  <header className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-semibold text-main">{selectedDb.name}</h4>
                      <p className="text-xs text-gray-400">
                        Created {new Date(selectedDb.createdAt).toLocaleString()} · {(selectedDb.tradesCount || 0).toLocaleString()} trades
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.28em] text-gray-300">
                      {selectedDb.status}
                    </span>
                  </header>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span>Storage</span>
                      <span>{selectedDb.storageGb ?? 0} GB</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 storage-animated">
                      <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${storagePct(selectedDb)}%` }}></div>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-gray-300 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Region</p>
                      <p className="text-main">{selectedDb.region || 'n/a'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Engine</p>
                      <p className="text-main">
                        {selectedDb.engine || 'postgres'} {selectedDb.version || ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Host</p>
                      <p className="font-mono text-main text-sm break-all">{selectedDb.host || 'provisioning…'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Username</p>
                      <p className="font-mono text-main text-sm">{selectedDb.username || '---'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Port</p>
                      <p className="font-mono text-main text-sm">{selectedDb.port || 5432}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Password</p>
                      <p className="font-mono text-main text-sm">{selectedDb.passwordMasked || 'rotated'}</p>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-4 text-[11px] uppercase tracking-[0.28em] text-gray-500">
                      <span className="text-primary-200">Actions</span>
                      <span>Statistics</span>
                      <span>Webhooks</span>
                      <span>Export</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold text-main">Rotate credentials</p>
                        <p className="text-xs text-gray-400">Issue a fresh DSN and revoke existing connections.</p>
                        <button
                          type="button"
                          className="mt-3 btn btn-secondary btn-small text-[11px] uppercase tracking-[0.24em]"
                          disabled={rotating === selectedDb.id}
                          onClick={() => handleRotate(selectedDb.id)}
                        >
                          {rotating === selectedDb.id ? 'Rotating…' : 'Rotate'}
                        </button>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold text-main">Scale storage</p>
                        <p className="text-xs text-gray-400">Upgrade capacity to handle replay or dense signals.</p>
                        <button type="button" className="mt-3 btn btn-primary btn-small text-[11px] uppercase tracking-[0.24em]">
                          Upgrade
                        </button>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold text-main">Export snapshot</p>
                        <p className="text-xs text-gray-400">Push an encrypted dump to your S3 vault.</p>
                        <button type="button" className="mt-3 btn btn-secondary btn-small text-[11px] uppercase tracking-[0.24em]">
                          Export
                        </button>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm font-semibold text-main">Delete database</p>
                        <p className="text-xs text-gray-400">Tears down replicas and purges snapshots.</p>
                        <button
                          type="button"
                          className="mt-3 btn btn-danger btn-small text-[11px] uppercase tracking-[0.24em]"
                          disabled={deleting === selectedDb.id}
                          onClick={() => handleDelete(selectedDb.id)}
                        >
                          {deleting === selectedDb.id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
