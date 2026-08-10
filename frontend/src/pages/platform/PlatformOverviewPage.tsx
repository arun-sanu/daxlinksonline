import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const MODULES = [
  { id: 'integrations', label: 'Integrations', icon: '📡', metric: '11 connected exchanges', requiresAuth: true },
  { id: 'databases', label: 'Databases', icon: '🗄️', metric: '3 clusters', requiresAuth: true },
  { id: 'webhooks', label: 'Webhooks', icon: '🔗', metric: '18 active routes', requiresAuth: true },
  { id: 'workflow', label: 'Workflow', icon: '🧠', metric: '5 nodes', requiresAuth: true, comingSoon: true },
  { id: 'monitoring', label: 'Monitoring', icon: '📈', metric: 'Telemetry feed', requiresAuth: true, comingSoon: true },
  { id: 'resources', label: 'Resources', icon: '📚', metric: 'Docs + runbooks' },
  { id: 'trade-bots', label: 'Trade Bots', icon: '🤖', metric: 'Strategies ready', requiresAuth: true },
  { id: 'banking', label: 'Banking', icon: '🏦', metric: 'Settlement windows', requiresAuth: true, comingSoon: true },
  { id: 'dns', label: 'DNS', icon: '🛰️', metric: 'Edge profiles', requiresAuth: true },
  { id: 'deployment', label: 'Deployment', icon: '🚀', metric: '3 pipelines', requiresAuth: true },
  { id: 'vpn', label: 'VPN', icon: '🔐', metric: 'Edge tunnels', requiresAuth: true, comingSoon: true },
  { id: 'support', label: 'Support', icon: '🎧', metric: 'Ops concierge', comingSoon: true }
];

export default function PlatformOverviewPage() {
  const [now, setNow] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hoursMinutes = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const formattedDate = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return MODULES;
    return MODULES.filter((module) => module.label.toLowerCase().includes(query));
  }, [searchQuery]);

  return (
    <div className="layout-container pt-16 pb-24 space-y-8">
      <header className="space-y-2">
        <p className="section-label">Platform</p>
        <h1 className="headline text-4xl">Command modules</h1>
        <p className="muted-text max-w-3xl text-sm">
          Centralize everything from integrations to VPN tunnels. Use the module grid to jump directly into detailed runbooks.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] items-start">
        <section className="space-y-6">
          <div className="space-y-2">
            <p className="text-5xl font-light text-main font-mono tracking-wider md:text-6xl lg:text-7xl">
              {hoursMinutes}
              <span className="align-baseline text-lg font-light text-primary-200">:{seconds}</span>
            </p>
            <p className="text-sm text-gray-400">{formattedDate}</p>
          </div>

          <div className="card-shell space-y-3">
            <p className="section-label">daxlinks.online</p>
            <p className="text-sm text-gray-300">
              Keep operations, monitoring, and integrations unified. Select any module to view the exact controls you remember from
              the legacy console.
            </p>
          </div>

          <div className="relative">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              type="text"
              placeholder="Search modules"
              className="w-full rounded-xl border border-white/15 bg-transparent px-4 py-2 text-xs text-gray-200 placeholder:text-gray-500 focus:border-primary-400 focus:outline-none"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.3em] text-gray-600">
              SCAN
            </span>
          </div>
        </section>

        <section className="rounded-3xl border border-transparent p-2">
          <div className="scroll-shell max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {filtered.map((module) => (
                <Link
                  key={module.id}
                  to={`/platform/${module.id}`}
                  className="group relative flex aspect-square flex-col items-center justify-center gap-3 rounded-3xl border px-4 py-5 transition border-white/10 bg-transparent hover:border-primary-400/40 hover:bg-primary-500/10"
                >
                  <div className="absolute right-4 top-3 flex flex-col items-center gap-1 text-sm">
                    {(module.comingSoon || module.id === 'databases') && (
                      <span className="mt-1 h-3 w-3 rounded-full border border-primary-200/60 border-t-transparent spin-indicator"></span>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-3 text-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-3xl text-white/80 group-hover:bg-white/15 group-hover:text-white">
                      {module.icon}
                    </span>
                    <span className="text-sm font-semibold text-white/90">{module.label}</span>
                    <div className="text-xs text-gray-400">{module.metric}</div>
                  </div>
                </Link>
              ))}
              {!filtered.length && (
                <p className="col-span-full py-12 text-center text-sm text-gray-500">No modules match “{searchQuery}”.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
