import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

type SizingLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function SizingLayout({ title, subtitle, children }: SizingLayoutProps) {
  return (
    <div className="layout-container pt-16 pb-24 space-y-6">
      <header className="space-y-2">
        <p className="section-label">Platform · Orders · Sizing</p>
        <h1 className="headline text-3xl">{title}</h1>
        {subtitle && <p className="muted-text max-w-3xl text-sm">{subtitle}</p>}
      </header>

      <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 text-xs uppercase tracking-[0.2em]">
        {[
          { label: 'Order Status', to: '/platform/orders' },
          { label: 'Sizing', to: '/platform/orders/sizing/details' }
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `rounded-xl px-3 py-2 transition ${
                isActive ? 'bg-sky-500/20 text-sky-100' : 'text-gray-300 hover:bg-white/10'
              }`
            }
            end={item.to === '/platform/orders'}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 text-xs uppercase tracking-[0.2em]">
        {[
          { label: 'Details', to: '/platform/orders/sizing/details' },
          { label: 'Reports', to: '/platform/orders/sizing/reports' }
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `rounded-xl px-3 py-2 transition ${
                isActive ? 'bg-sky-500/20 text-sky-100' : 'text-gray-300 hover:bg-white/10'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}
