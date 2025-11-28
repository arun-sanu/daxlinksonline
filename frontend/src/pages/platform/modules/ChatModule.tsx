const rooms = [
  { name: 'Ops · War Room', status: 'Live', topic: 'Incidents, deploys, hotfix threads', members: 18 },
  { name: 'Product · Signals', status: 'Muted', topic: 'Signals, experiments, roadmap', members: 24 },
  { name: 'Support · Tier 2', status: 'Live', topic: 'Customer escalations + RCA', members: 12 }
];

const templates = [
  { title: 'Create Channel', detail: 'Spin a new room with permissions and pinned topics.' },
  { title: 'Escalate to Alerts', detail: 'Mirror messages into alert rail + push.' },
  { title: 'Sync to Webhooks', detail: 'Fan out channel messages to downstream systems.' }
];

export default function ChatModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Chat & Channels</p>
        <h2 className="text-3xl font-semibold text-main">Rooms, threads, and on-call sync</h2>
        <p className="muted-text max-w-3xl text-sm">
          Keep live rooms beside alert rail and webhooks. Create channels, mirror incidents, and keep on-call in sync without leaving
          the console.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card-shell space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-main">Active rooms</p>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-gray-400">Live</span>
          </div>
          <div className="space-y-2">
            {rooms.map((room) => (
              <div key={room.name} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">{room.name}</p>
                  <p className="text-xs text-gray-400">{room.topic}</p>
                  <p className="text-[11px] text-gray-500">{room.members} members</p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.22em] ${
                    room.status === 'Live' ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30' : 'bg-white/10 text-gray-300 border border-white/15'
                  }`}
                >
                  {room.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card-shell space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-main">Channel actions</p>
            <span className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Playbooks</span>
          </div>
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div key={tpl.title} className="rounded-xl border border-white/10 bg-gradient-to-r from-white/5 via-transparent to-white/5 px-3 py-3">
                <p className="text-sm font-semibold text-white">{tpl.title}</p>
                <p className="text-xs text-gray-400">{tpl.detail}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button className="btn btn-secondary btn-small px-4" type="button">
              New channel
            </button>
            <button className="rounded-full border border-white/15 px-3 py-2 uppercase tracking-[0.18em] text-gray-200" type="button">
              Mirror alerts
            </button>
            <span className="text-[11px] text-gray-500">Syncs with alert rail + webhooks.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
