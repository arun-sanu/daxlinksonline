import { Link } from 'react-router-dom';
import { PLATFORM_MODULES } from '../../icons/platformIcons';

export default function PlatformOverviewPage() {
  const filtered = PLATFORM_MODULES;

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
          <div className="card-shell space-y-3">
            <p className="section-label">daxlinks.online</p>
            <p className="text-sm text-gray-300">
              Keep operations, monitoring, and integrations unified. Select any module to view the exact controls you remember from
              the legacy console.
            </p>
          </div>

        </section>

        <section className="rounded-3xl border border-transparent p-2 -mt-19 md:-mt-20">
          <div className="scroll-shell max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-5">
              {filtered.map((module) => {
                const Icon = module.icon;
                return (
                  <Link
                    key={module.id}
                    to={module.path || `/platform/${module.id}`}
                    className="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 transition border-white/10 bg-transparent hover:border-primary-400/40 hover:bg-primary-500/10"
                  >
                    <span className="flex h-14 w-14 items-center justify-center text-white/80">
                      <Icon className="h-7 w-7 text-white/85" strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <div className="absolute right-4 top-3 flex flex-col items-center gap-1 text-sm">
                      {(module.comingSoon || module.id === 'databases') && (
                        <span className="mt-1 h-3 w-3 rounded-full border border-primary-200/60 border-t-transparent spin-indicator"></span>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <span className="text-xs font-semibold text-white/90">{module.label}</span>
                      <div className="text-[11px] text-gray-400">{module.metric}</div>
                    </div>
                  </Link>
                );
              })}
              {!filtered.length && (
                <p className="col-span-full py-12 text-center text-sm text-gray-500">No modules available.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
