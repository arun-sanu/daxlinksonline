import { ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'NotificationsPage',
  setup() {
    const loading = ref(false);
    const err = ref('');
    const items = ref([]);
    const authHeaders = () => {
      try {
        const token = window.__appAuthToken__ || window.localStorage?.getItem('daxlinksToken') || window.localStorage?.getItem('authToken');
        return token ? { Authorization: `Bearer ${token}` } : {};
      } catch {
        return {};
      }
    };

    const fetchInbox = async () => {
      loading.value = true; err.value = '';
      try {
        const base = (typeof window !== 'undefined' && window.__DAXLINKS_CONFIG__?.apiBaseUrl) || '';
        const normalizedBase = base.replace(/\/$/, '');
        const inboxUrl = normalizedBase ? `${normalizedBase}/users/alerts?limit=100` : '/api/v1/users/alerts?limit=100';
        const res = await fetch(inboxUrl, { credentials: 'include', headers: authHeaders() });
        if (!res.ok) throw new Error('Failed to load alerts');
        const json = await res.json();
        const rows = Array.isArray(json?.items) ? json.items : [];
        items.value = rows.map((n) => {
          const ts = n.receivedAt || n.createdAt || n.ts || Date.now();
          return {
            id: n.id || `${ts}-${n.userId || ''}`,
            title: n.strategyName || n.symbol || n.status || 'Alert',
            body: n.errorMessage || n.side || '',
            ts: new Date(ts).toLocaleString()
          };
        });
      } catch (e) {
        err.value = String(e?.message || e);
      } finally {
        loading.value = false;
      }
    };

    onMounted(fetchInbox);
    return { loading, err, items, fetchInbox };
  },
  template: `
  <div class="alerts-page">
    <header class="alerts-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <div>
        <h1>Notifications</h1>
        <p class="muted">Your recent in-app notifications.</p>
      </div>
      <button class="notify-close" @click="$router?.back?.()">← Back</button>
    </header>

    <section class="card">
      <div v-if="loading">Loading…</div>
      <div v-else-if="err" class="error">{{ err }}</div>
      <div v-else>
        <div v-if="!items.length" class="notify-empty">No notifications yet.</div>
        <div v-else class="notify-list">
          <article v-for="n in items" :key="n.id" class="notify-item">
            <div class="notify-item-title">{{ n.title }}</div>
            <div class="notify-item-body" v-if="n.body">{{ n.body }}</div>
            <div class="notify-item-time">{{ n.ts }}</div>
          </article>
        </div>
      </div>
    </section>
  </div>
  `
};
