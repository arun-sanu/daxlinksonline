import { ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'NotificationsPage',
  setup() {
    const loading = ref(false);
    const err = ref('');
    const items = ref([]);

    const fetchInbox = async () => {
      loading.value = true; err.value = '';
      try {
        const res = await fetch('/api/v1/notify/inbox?limit=100', { credentials: 'include' });
        const json = await res.json();
        if (!json?.ok) throw new Error('Failed to load notifications');
        items.value = (json.items || []).map(n => ({ id: n.id, title: n.title, body: n.body, ts: new Date(n.ts).toLocaleString() }));
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

