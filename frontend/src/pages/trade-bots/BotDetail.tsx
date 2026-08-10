import { NavLink, Outlet, useParams } from 'react-router-dom';

export default function BotDetail() {
  const { botId } = useParams();
  const tabs = [
    { label: 'Overview', to: `/trade-bots/${botId}` },
    { label: 'Versions', to: `/trade-bots/${botId}/versions` },
    { label: 'Instances', to: `/trade-bots/${botId}/instances` }
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bot {botId}</h1>
      <nav className="flex flex-wrap gap-2 mb-4 text-xs">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `rounded-full border px-3 py-2 uppercase tracking-[0.24em] transition ${
                isActive ? 'border-blue-400 text-blue-200' : 'border-white/10 text-gray-400 hover:border-blue-500/40'
              }`
            }
            end={tab.to === `/trade-bots/${botId}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
