import { useEffect, useState } from 'react';
import { Responsive as ResponsiveGrid, type Layouts, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

type WidgetKind = 'time' | 'date' | 'notes';
type WidgetInstance = { id: string; type: WidgetKind };
const ResponsiveGridLayout = WidthProvider(ResponsiveGrid);
const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: 'time-1', type: 'time' },
  { id: 'date-1', type: 'date' }
];
const AVAILABLE_WIDGETS: Array<{ type: WidgetKind; name: string; description: string }> = [
  { type: 'time', name: 'Clock', description: 'Live clock with seconds and timezone.' },
  { type: 'date', name: 'Calendar', description: 'Shows current date and month at a glance.' },
  { type: 'notes', name: 'Notes', description: 'Quick notes and scratchpad for reminders.' }
];

export default function DashboardPage() {
  const [now, setNow] = useState(() => new Date());
  const [, setCurrentBreakpoint] = useState<'lg' | 'md' | 'sm' | 'xs' | 'xxs'>('lg');
  const [activeWidgets, setActiveWidgets] = useState<WidgetInstance[]>(DEFAULT_WIDGETS);
  const [layouts, setLayouts] = useState<Layouts>({
    lg: [
      { i: 'time-1', x: 0, y: 0, w: 3, h: 2 },
      { i: 'date-1', x: 3, y: 0, w: 3, h: 2 }
    ],
    md: [
      { i: 'time-1', x: 0, y: 0, w: 3, h: 2 },
      { i: 'date-1', x: 3, y: 0, w: 3, h: 2 }
    ],
    sm: [
      { i: 'time-1', x: 0, y: 0, w: 3, h: 2 },
      { i: 'date-1', x: 0, y: 2, w: 3, h: 2 }
    ],
    xs: [
      { i: 'time-1', x: 0, y: 0, w: 2, h: 2 },
      { i: 'date-1', x: 0, y: 2, w: 2, h: 2 }
    ],
    xxs: [
      { i: 'time-1', x: 0, y: 0, w: 2, h: 2 },
      { i: 'date-1', x: 0, y: 2, w: 2, h: 2 }
    ]
  });
  const [locked, setLocked] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [widgetOverlayOpen, setWidgetOverlayOpen] = useState(false);

  function removeWidget(widgetId: string) {
    setActiveWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    setLayouts((prev) => {
      const next: Layouts = {};
      Object.entries(prev).forEach(([bp, layout]) => {
        next[bp] = layout.filter((item) => item.i !== widgetId);
      });
      return next;
    });
  }

  function addWidget(kind: WidgetKind) {
    const uniqueId = `${kind}-${Date.now()}`;
    setActiveWidgets((prev) => [...prev, { id: uniqueId, type: kind }]);
    setLayouts((prev) => {
      const next: Layouts = {};
      Object.entries(prev).forEach(([bp, layout]) => {
        const cols = bp === 'lg' ? 12 : bp === 'md' ? 10 : bp === 'sm' ? 6 : 2;
        const width = Math.min(3, cols);
        const height = kind === 'notes' ? 3 : 2;
        const y = layout.length ? Math.max(...layout.map((l) => l.y + l.h)) : 0;
        next[bp] = [
          ...layout,
          {
            i: uniqueId,
            x: 0,
            y,
            w: width,
            h: height
          }
        ];
      });
      return next;
    });
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = now.getHours();
  const hoursMinutes = `${(((hours + 11) % 12) + 1).toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const meridiem = hours < 12 ? 'AM' : 'PM';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayOfMonth = now.getDate().toString().padStart(2, '0');
  const numericDate = `${dayOfMonth}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  const weekday = now.toLocaleDateString([], { weekday: 'long' });
  const monthYear = now.toLocaleDateString([], { month: 'long', year: 'numeric' });

  function renderWidget(widget: WidgetInstance) {
    const { id, type } = widget;
    const isDragging = draggingId === id;

    if (type === 'time') {
      return (
        <div
          key={id}
          className={`widget-card relative mx-auto w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-lg shadow-black/10 ${
            isDragging ? 'opacity-80' : ''
          }`}
        >
          <div className="absolute left-[10%] top-0 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-transparent">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'oklch(72.3% 0.219 149.579)' }}
            >
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </div>
          <div className="relative mt-3 space-y-3 pt-2">
            <p className="absolute right-0 -top-4 text-[11px] tracking-[0.18em] text-gray-400 text-right">{timeZone}</p>
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="flex items-baseline gap-2 text-4xl font-semibold text-main font-['IBM_Plex_Sans'] tracking-[0.18em]">
                <span className="inline-block text-sm font-semibold tracking-[0.16em] text-primary-200 -translate-y-2 transform">
                  {meridiem}
                </span>
                <span>{hoursMinutes}</span>
                <span className="align-baseline text-lg font-light text-primary-200/60">:{seconds}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (type === 'date') {
      return (
        <div
          key={id}
          className={`widget-card relative mx-auto w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-lg shadow-black/10 ${
            isDragging ? 'opacity-80' : ''
          }`}
        >
          <div className="absolute left-[10%] top-0 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-transparent">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'oklch(72.3% 0.219 149.579)' }}
            >
              <rect x="4" y="5" width="16" height="15" rx="2" />
              <line x1="16" y1="3" x2="16" y2="7" />
              <line x1="8" y1="3" x2="8" y2="7" />
              <line x1="4" y1="11" x2="20" y2="11" />
            </svg>
          </div>
          <div className="relative mt-3 space-y-3 pt-2">
            <p className="absolute right-0 -top-4 text-[11px] tracking-[0.12em] text-gray-400">{numericDate}</p>
            <div className="flex items-end gap-1">
              <p className="text-4xl font-semibold text-main font-mono tracking-[0.32em] drop-shadow-[0_0_18px_rgba(107,107,247,0.35)]">
                {dayOfMonth}
              </p>
              <div className="flex flex-col leading-tight -translate-y-2 transform">
                <p className="text-[10px] tracking-tight text-gray-400">{weekday}</p>
                <p className="text-sm tracking-tight text-gray-400">{monthYear}</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        key={id}
        className={`widget-card relative mx-auto w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-lg shadow-black/10 ${
          isDragging ? 'opacity-80' : ''
        }`}
      >
        <div className="absolute left-[10%] top-0 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-transparent">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'oklch(72.3% 0.219 149.579)' }}
          >
            <path d="M4 6h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
            <path d="M8 10h8" />
            <path d="M8 14h5" />
          </svg>
        </div>
        <div className="relative mt-3 space-y-3 pt-2">
          <p className="text-sm font-semibold text-main">Notes</p>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-gray-200">
            <p className="text-xs uppercase tracking-[0.22em] text-gray-400">Sticky</p>
            <p className="mt-1 text-sm text-gray-100">Drop quick reminders here to pin next to your clock and date.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-16">
      <section className="layout-container section-pad">
        <div className="space-y-6">
          <p className="section-label">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold text-main">Welcome back</h1>
          <p className="mt-2 text-sm text-gray-300">
            You&apos;re signed in. This dashboard is ready for your widgets and metrics when you&apos;re ready to add them.
          </p>

          <ResponsiveGridLayout
            className="layout"
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={58}
            margin={[8, 8]}
            containerPadding={[0, 0]}
            compactType={null}
            isResizable={false}
            isDraggable={!locked}
            draggableHandle=".widget-card"
            draggableCancel="input,textarea,button,select,option"
            layouts={layouts}
            onDragStart={(_, __, elem) => setDraggingId(elem.i)}
            onDragStop={() => setDraggingId(null)}
            onBreakpointChange={(bp) => setCurrentBreakpoint(bp as typeof currentBreakpoint)}
            onLayoutChange={(_, allLayouts) => setLayouts(allLayouts)}
          >
            {activeWidgets.map((widget) => (
              <div key={widget.id}>{renderWidget(widget)}</div>
            ))}
          </ResponsiveGridLayout>
        </div>
        <div className="sticky bottom-12 flex justify-end gap-3 pr-2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 shadow-lg shadow-black/25 backdrop-blur-md">
            <button
              type="button"
              aria-label="Search widgets"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:border-white/30 hover:bg-white/15"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="6" />
                <line x1="15.5" y1="15.5" x2="20" y2="20" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Add widget"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-primary-500/20 text-primary-100 transition hover:border-primary-200/60 hover:bg-primary-500/30"
              onClick={() => setWidgetOverlayOpen(true)}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
          </div>
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 shadow-lg shadow-black/25 backdrop-blur-md">
            <button
              type="button"
              aria-label="Security lock"
              className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                locked
                  ? 'border-yellow-300/70 bg-yellow-500/15 text-yellow-200'
                  : 'border-emerald-300/70 bg-emerald-500/15 text-emerald-100'
              } transition hover:border-white/30 hover:bg-white/15`}
              title={locked ? 'Unlock layout' : 'Lock layout'}
              aria-pressed={locked}
              onClick={() => setLocked((prev) => !prev)}
            >
              {locked ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M9 11V8a3 3 0 1 1 6 0v3" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M15 11V8a3 3 0 0 0-5.83-1.02" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </section>
      {widgetOverlayOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Widget library"
        >
          <div className="relative w-full max-w-5xl rounded-3xl border border-white/15 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-7 shadow-[0_20px_80px_rgba(0,0,0,0.65)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.4em] text-primary-200">Widget Lab</p>
                <h2 className="mt-2 text-3xl font-semibold text-white">Assemble your dashboard kit</h2>
                <p className="mt-2 text-sm text-gray-300">
                  Mix clocks, calendars, and notes. No motion—just clean, experimental glass panels.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close widget library"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:border-white/40 hover:bg-white/15"
                onClick={() => setWidgetOverlayOpen(false)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-white/15 bg-white/5/90 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Active widgets</h3>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-300">
                    Live
                  </span>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-gray-200">
                  {activeWidgets.length === 0 && <li className="text-xs text-gray-400">No widgets pinned. Unlock to add them back.</li>}
                  {activeWidgets.map((widget) => {
                    const meta = AVAILABLE_WIDGETS.find((w) => w.type === widget.type);
                    return (
                      <li key={widget.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex flex-col">
                          <p className="font-semibold text-white">{meta?.name ?? widget.type}</p>
                          <p className="text-xs text-gray-400">{meta?.description ?? 'Pinned to your layout.'}</p>
                        </div>
                        <button
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-red-500/70 bg-red-700/15 text-red-200 transition hover:border-red-400 hover:bg-red-700/25"
                          onClick={() => removeWidget(widget.id)}
                          aria-label={`Remove ${meta?.name ?? widget.type}`}
                          disabled={locked}
                          title={locked ? 'Unlock layout to remove widgets' : 'Remove widget'}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 6l12 12M6 18L18 6" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5/90 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Available</h3>
                  <span className="rounded-full border border-primary-200/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-100">
                    Build
                  </span>
                </div>
                <div className="mt-4 grid gap-3">
                  {AVAILABLE_WIDGETS.map((widget) => (
                    <div key={widget.type} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-gradient-to-r from-white/8 via-white/0 to-white/8 px-3 py-3">
                      <div>
                        <p className="font-semibold text-white">{widget.name}</p>
                        <p className="text-xs text-gray-400">{widget.description}</p>
                      </div>
                      <button
                        type="button"
                        className="rounded-full border border-primary-200/60 bg-primary-500/20 px-3 py-1 text-xs font-semibold text-primary-50 transition hover:border-primary-200 hover:bg-primary-500/30"
                        onClick={() => addWidget(widget.type)}
                        disabled={locked}
                        title={locked ? 'Unlock layout to add widgets' : `Add ${widget.name}`}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
