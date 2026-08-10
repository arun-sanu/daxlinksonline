import { ref, inject, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import NotificationsModal from './NotificationsModal.js';

export default {
  name: 'AlertRail',
  props: { unreadCount: { type: Number, default: 0 } },
  components: { NotificationsModal },
  setup() {
    const actions = inject('dashboardActions', {});
    const router = inject('router', null);
    const store = inject('dashboardStore', null);

    const modalOpen = ref(false);
    const notifications = ref([]);
    const unread = ref(0);
    const userId = (() => {
      try { return store?.auth?.user?.id || (window.__lastUser__ && window.__lastUser__.id) || null; } catch { return null; }
    })();
    const seenKey = userId ? `dax_inbox_seen_${userId}` : 'dax_inbox_seen';
    if (!notifications.value.length) {
      notifications.value = [
        { id: 'n1', title: 'Welcome', body: 'Notifications are now live.', ts: new Date().toLocaleString() }
      ];
    }

    const markAllRead = () => {
      try { localStorage.setItem(seenKey, new Date().toISOString()); } catch {}
      unread.value = 0;
    };
    const fetchInbox = async () => {
      try {
        const res = await fetch('/api/v1/notify/inbox?limit=50', { credentials: 'include' });
        const json = await res.json();
        if (json?.ok) {
          notifications.value = (json.items || []).map(n => ({ id: n.id, title: n.title, body: n.body, ts: new Date(n.ts).toLocaleString() }));
          const lastSeenIso = (() => { try { return localStorage.getItem(seenKey) || ''; } catch { return ''; } })();
          const lastSeen = lastSeenIso ? new Date(lastSeenIso).getTime() : 0;
          const newest = (json.items || []).reduce((acc, it) => Math.max(acc, new Date(it.ts).getTime()), 0);
          unread.value = (json.items || []).filter(it => new Date(it.ts).getTime() > lastSeen).length;
          // Initialize seen time if none exists to avoid perpetual badge on first load
          if (!lastSeenIso && newest) { try { localStorage.setItem(seenKey, new Date().toISOString()); } catch {} }
        }
      } catch {}
    };
    onMounted(fetchInbox);
    const openNotifications = async () => { await fetchInbox(); modalOpen.value = true; };
    const goAlertsPage = () => {
      let navigated = false;
      // Prefer the app router if provided via inject
      try {
        if (router && typeof router.push === 'function') {
          router.push({ name: 'alerts' });
          navigated = true;
        }
      } catch {}
      // Try global router reference set at boot
      if (!navigated) {
        try {
          const r = window.__appRouter__;
          if (r && typeof r.push === 'function') {
            r.push({ name: 'alerts' });
            navigated = true;
          }
        } catch {}
      }
      // Fallbacks: hash first, then hard nav
      if (!navigated && 'location' in window) {
        try {
          window.location.hash = '#/alerts';
          navigated = true;
        } catch {}
      }
      if (!navigated && 'location' in window) {
        try { window.location.assign('/#/alerts'); } catch {}
      }
    };
    const logout = () => { if (typeof actions.logoutAccount === 'function') actions.logoutAccount(); };

    return { modalOpen, notifications, unread, openNotifications, goAlertsPage, logout, markAllRead };
  },
  template: `
    <aside class="alert-tab" aria-label="Notifications panel">
      <button type="button" class="alert-tab__button" aria-label="View notifications" @click="openNotifications" title="Notifications">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0 0 1m6 0H9" />
        </svg>
        <span v-if="unread" style="margin-left:4px; font-size:10px; background:#ef4444; color:#fff; padding:0 6px; border-radius:999px; line-height:16px; min-width:16px; text-align:center;">{{ unread }}</span>
      </button>
      <button type="button" class="alert-tab__button alert-tab__button--accent" aria-label="View alerts" @click="goAlertsPage" title="Alerts">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3m0 3h.01m-.01-12a9 9 0 100 18 9 9 0 000-18z" />
        </svg>
      </button>
      <button type="button" class="alert-tab__button" aria-label="Log out" title="Log out" @click="logout">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12H3m12 0l-4-4m4 4l-4 4M21 5v14a2 2 0 01-2 2h-6" />
        </svg>
      </button>
      <NotificationsModal v-model="modalOpen" :items="notifications" @dismiss="markAllRead" />
    </aside>
  `
};
