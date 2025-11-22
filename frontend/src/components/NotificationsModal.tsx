import type { ReactNode } from 'react';

type NotificationItem = { id: string; title: string; body: string; ts: string };

interface NotificationsModalProps {
  open: boolean;
  items: NotificationItem[];
  onClose: () => void;
  footer?: ReactNode;
}

export function NotificationsModal({ open, items, onClose, footer }: NotificationsModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0e13] p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-main uppercase tracking-[0.22em]">Notifications</h3>
          <button className="text-xs text-gray-400 hover:text-white" onClick={onClose} type="button">Close</button>
        </div>
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
          {items.length === 0 && <p className="text-sm text-gray-500">No notifications yet.</p>}
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{item.ts}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-main">{item.title}</p>
              <p className="mt-1 text-sm text-gray-300">{item.body}</p>
            </article>
          ))}
        </div>
        {footer && <div className="mt-3 text-xs text-gray-400">{footer}</div>}
      </div>
    </div>
  );
}

export type { NotificationItem };
