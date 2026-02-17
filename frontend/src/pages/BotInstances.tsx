import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { getBot } from '../api/tradeBots';
import BotInstanceControlsPanel from '../components/BotInstanceControlsPanel';

export default function BotInstances() {
  const { botId = '' } = useParams();
  const [botName, setBotName] = useState<string>('');
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadBot = async () => {
      if (!botId) return;
      const bot = await getBot(botId);
      if (!mounted) return;
      setBotName(bot?.name || '');
    };

    loadBot();
    return () => {
      mounted = false;
    };
  }, [botId]);

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Bot Instances</h1>
        <p className="text-gray-500">Lifecycle controls for deployed instances.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link to="/trade-bots" className="rounded border border-white/15 px-3 py-2 text-sm text-gray-100">
          Back To Trade Bots
        </Link>
        <Link to={`/trade-bots/${botId}`} className="rounded border border-white/15 px-3 py-2 text-sm text-gray-100">
          Bot Detail
        </Link>
        <button
          type="button"
          className="rounded border border-primary-300/35 bg-primary-500/10 px-3 py-2 text-sm text-primary-100"
          onClick={() => setShowPopup(true)}
          disabled={!botId}
        >
          Open Runtime Popup
        </button>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Selected Bot</p>
            <h2 className="text-xl font-semibold text-gray-100">{botName || botId || 'Unknown Bot'}</h2>
          </div>
          {botId && <p className="text-xs font-mono text-gray-500">{botId}</p>}
        </div>

        {botId ? (
          <BotInstanceControlsPanel botId={botId} showHeader />
        ) : (
          <p className="text-sm text-rose-300">Missing bot id in route.</p>
        )}
      </section>

      {showPopup && botId && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowPopup(false)}
        >
          <div
            className="mx-auto w-full max-w-5xl rounded-3xl border border-white/15 bg-black/90 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 px-6 py-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Runtime Controls</p>
                <h3 className="text-3xl font-semibold text-main">{botName || botId}</h3>
                <p className="mt-1 text-sm text-gray-300">Start, pause, restart, and stop controls for all bot instances.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowPopup(false)}>
                Close
              </button>
            </div>

            <div className="p-6">
              <BotInstanceControlsPanel botId={botId} showHeader />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
