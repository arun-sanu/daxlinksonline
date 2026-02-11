import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import AlertRail from '../components/AlertRail';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', exact: true },
  { to: '/account', label: 'Account' },
  { to: '/platform', label: 'Platform' }
];

const breadcrumbLabelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  account: 'Account',
  register: 'Register',
  subscriptions: 'Subscriptions',
  platform: 'Platform',
  databases: 'Databases',
  banking: 'Banking',
  wallet: 'Wallet',
  integrations: 'Integrations',
  webhooks: 'Webhooks',
  workflow: 'Workflow',
  monitoring: 'Monitoring',
  orders: 'Orders',
  'trade-bots': 'Trade Bots',
  dns: 'DNS',
  deployment: 'Deployment',
  vpn: 'VPN',
  support: 'Support',
  alerts: 'Alert Rail',
  chat: 'Chat & Channels'
};

const formatSegment = (slug: string) =>
  breadcrumbLabelMap[slug] ||
  slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export default function AppLayout() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleMobile = () => setMobileNavOpen((prev) => !prev);
  const closeMobile = () => setMobileNavOpen(false);
  const isRegistration = location.pathname.startsWith('/account/register');
  const visibleNavItems = isRegistration
    ? navItems.filter((item) => item.label !== 'Dashboard' && item.label !== 'Platform')
    : navItems;
  const hideFooter = location.pathname.startsWith('/platform') || location.pathname.startsWith('/account');
  const breadcrumbs = useMemo(() => {
    const cleaned = location.pathname.replace(/^\/+|\/$/g, '');
    if (!cleaned) return [];
    const segments = cleaned.split('/');
    const crumbs = [];
    let pathAccumulator = '';

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      pathAccumulator += `/${segment}`;
      const isLast = i === segments.length - 1;
      crumbs.push({
        label: formatSegment(segment),
        path: isLast ? undefined : pathAccumulator
      });
    }

    return crumbs;
  }, [location.pathname]);

  return (
    <div className="app-shell relative text-main">
      <div
        className="constellation-canvas"
        aria-hidden="true"
        style={{ background: 'radial-gradient(circle at 15% 10%, rgba(107,107,247,0.25), transparent 55%)' }}
      ></div>
      <header className="header-blur sticky top-0 z-30">
        <div className="layout-container flex flex-col gap-2 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 select-none" aria-label="Brand">
              <span className="brand-cyber">D&gt;&lt;</span>
            </div>
            <nav className="hidden flex-1 flex-wrap items-center justify-center gap-2 overflow-x-auto text-[11px] font-semibold uppercase tracking-[0.22em] md:flex md:gap-3">
              {visibleNavItems.map((item) => {
                const matchesRoot = breadcrumbs[0]?.label === item.label;
                const extraCrumbs = matchesRoot ? breadcrumbs.slice(1) : [];
                const composedLabel =
                  extraCrumbs.length > 0 ? `${item.label} > ${extraCrumbs.map((c) => c.label).join(' > ')}` : item.label;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `desktop-nav-pill ${isActive ? 'desktop-nav-pill--active' : ''}`}
                    end={item.exact}
                    onClick={closeMobile}
                  >
                    {composedLabel}
                  </NavLink>
                );
              })}
            </nav>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-black/60 p-2 transition hover:border-white/30 hover:text-white md:hidden"
                onClick={toggleMobile}
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-nav"
                aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
                style={{ color: 'var(--primary)' }}
              >
                {mobileNavOpen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        {mobileNavOpen && (
          <div
            id="mobile-nav"
            className="border-t bg-black/95 shadow-[0_-25px_60px_rgba(18,152,230,0.18)] md:hidden"
            style={{ borderColor: 'rgba(107,107,247,0.1)' }}
          >
            <div className="layout-container py-4">
              <nav className="flex flex-col gap-3 text-sm font-semibold text-gray-300">
                {visibleNavItems.map((item) => {
                  const matchesRoot = breadcrumbs[0]?.label === item.label;
                  const extraCrumbs = matchesRoot ? breadcrumbs.slice(1) : [];
                  const composedLabel =
                    extraCrumbs.length > 0 ? `${item.label} > ${extraCrumbs.map((c) => c.label).join(' > ')}` : item.label;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `mobile-nav-link bg-gradient-to-r from-gray-900 via-gray-950 to-black/80 ${isActive ? 'mobile-nav-link--active' : ''}`
                      }
                      end={item.exact}
                      onClick={closeMobile}
                    >
                      {composedLabel}
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <AlertRail />
      {!hideFooter && (
        <footer className="footer-shell" role="contentinfo">
          <div className="layout-container flex flex-col gap-8 text-sm muted-text md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-main text-lg font-semibold">DaxLinks Online</p>
              <p className="mt-2 text-xs uppercase tracking-[0.28em] text-gray-500">Advanced automation, calm confidence.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.24em] footer-links">
              <a href="https://daxlinks.online/docs" target="_blank" rel="noreferrer">Docs</a>
              <a href="https://daxlinks.online/legal" target="_blank" rel="noreferrer">Legal</a>
              <a href="https://daxlinks.online/security" target="_blank" rel="noreferrer">Security</a>
              <a href="https://daxlinks.online/support" target="_blank" rel="noreferrer">Support</a>
            </div>
            <p className="text-xs text-gray-500">© {new Date().getFullYear()} DaxLinks. All rights reserved.</p>
          </div>
        </footer>
      )}
    </div>
  );
}
