import { NavLink, Outlet, useParams } from 'react-router-dom';

export default function BotDetail() {
  const { botId } = useParams();
  const base = `#/trade-bots/${botId}`;
  const link = 'px-3 py-2 rounded hover:bg-gray-200 dark:hover:bg-gray-800';
  const active = 'font-semibold bg-gray-200 dark:bg-gray-800';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bot {botId}</h1>
      <div className="flex gap-2 mb-4">
        <a href={`${base}`} className={`${link}`}>Overview</a>
        <a href={`${base}/versions`} className={`${link}`}>Versions</a>
        <a href={`${base}/instances`} className={`${link}`}>Instances</a>
      </div>
      <Outlet />
    </div>
  );
}

