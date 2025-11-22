import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationsModal, type NotificationItem } from './NotificationsModal';

export default function AlertRail() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const seenKey = useMemo(() => {
    try {
      const user = localStorage.getItem('authUser');
      if (user) {
        const parsed = JSON.parse(user);
        return parsed?.id ? `dax_inbox_seen_${parsed.id}` : 'dax_inbox_seen';
      }
    } catch {}
    return 'dax_inbox_seen';
  }, []);

  useEffect(() => {
    // preload some friendly defaults so the rail feels alive offline
    if (!items.length) {
      setItems([
        { id: 'n1', title: 'Welcome to Alert Rail', body: 'Wire TradingView alerts and bot events into your channels.', ts: new Date().toLocaleString() }
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchInbox() {
    try {
      const res = await fetch('/api/v1/notify/inbox?limit=50', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      if (json?.items) {
        const mapped = json.items.map((n: any) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          ts: new Date(n.ts).toLocaleString()
        }));
        setItems(mapped);
        const lastSeenIso = localStorage.getItem(seenKey) || '';
        const lastSeen = lastSeenIso ? new Date(lastSeenIso).getTime() : 0;
        const unreadCount = mapped.filter((n) => new Date(n.ts).getTime() > lastSeen).length;
        setUnread(unreadCount);
        if (!lastSeenIso && mapped.length) {
          localStorage.setItem(seenKey, new Date().toISOString());
        }
      }
    } catch {
      // ignore, fallback stays
    }
  }

  useEffect(() => {
    fetchInbox();
    const timer = setInterval(fetchInbox, 15000);
    return () => clearInterval(timer);
  }, []);

  function openNotifications() {
    fetchInbox();
    setOpen(true);
    try { localStorage.setItem(seenKey, new Date().toISOString()); } catch {}
    setUnread(0);
  }

  function goAlertsPage() {
    navigate('/platform/alerts');
  }

  return (
    <>
      <aside className="alert-tab" aria-label="Notifications panel">
        <button type="button" className="alert-tab__button" aria-label="View notifications" onClick={openNotifications} title="Notifications">
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="currentColor"
            style={{
              color: 'oklch(82.8% 0.189 84.429)',
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35)) drop-shadow(0 0 6px rgba(255,255,255,0.15))'
            }}
          >
            <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-1.91 1.91A1 1 0 0 0 5 20h14a1 1 0 0 0 .71-1.71Z" />
          </svg>
          {unread > 0 && (
            <span className="ml-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread}
            </span>
          )}
        </button>
        <button type="button" className="alert-tab__button alert-tab__button--accent" aria-label="View alerts" onClick={goAlertsPage} title="Alerts">
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="currentColor"
            style={{
              color: 'oklch(82.8% 0.189 84.429)',
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35)) drop-shadow(0 0 6px rgba(255,255,255,0.15))'
            }}
          >
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
        </button>
      </aside>

      <NotificationsModal open={open} items={items} onClose={() => setOpen(false)} footer={<span>Marking read syncs to Alert Rail.</span>} />
    </>
  );
}
