import { inject, computed, onMounted, onBeforeUnmount, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import * as apiClient from '../services/apiClient.js?v=20251106a';

export default {
  name: 'ExchangeLogsPage',
  setup(_, { attrs }) {
    const store = inject('dashboardStore');
    const route = (typeof window !== 'undefined' && window.__appRouter__?.currentRoute?.value) || { params: {} };
    const exchangeId = computed(() => route.params.exchangeId || attrs?.exchangeId || '');

    const exchange = computed(() =>
      store.availableExchanges.find((e) => e.id === exchangeId.value) || null
    );

    const integrations = computed(() =>
      store.integrationProfiles.filter((p) => p.exchange === exchangeId.value)
    );

    const loading = ref(true);
    let pollTimer = null;
    function levelClass(title) {
      const t = String(title || '').toLowerCase();
      if (t.includes('fail') || t.includes('error')) return 'text-red-300';
      if (t.includes('success') || t.includes('succeed')) return 'text-green-300';
      if (t.includes('warn')) return 'text-yellow-300';
      return 'text-blue-300';
    }

    const integrationIds = computed(() => integrations.value.map((i) => i.id));
    const filteredLogs = computed(() => {
      const ids = new Set(integrationIds.value);
      return (store.credentialEvents || []).filter((e) => !e.integrationId || ids.has(e.integrationId));
    });

    async function refresh() {
      try {
        const data = await apiClient.fetchInitialData();
        if (data && typeof window !== 'undefined') {
          // Defer applyInitialData to the app to maintain consistency
          const { applyInitialData } = await import('../stores/dashboardStore.js');
          applyInitialData(data);
        }
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      await refresh();
      pollTimer = setInterval(refresh, 5000);
    });
    onBeforeUnmount(() => {
      if (pollTimer) clearInterval(pollTimer);
    });

    function goOverview() {
      if (typeof window !== 'undefined' && window.__appRouter__) {
        window.__appRouter__.push({ name: 'exchange-detail', params: { exchangeId: exchangeId.value } });
      }
    }

    return { store, exchangeId, exchange, filteredLogs, levelClass, loading, goOverview };
  },
  template: `
    <main class="layout-container section-pad space-y-8">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.28em] muted-text">Exchange</p>
          <h2 class="text-2xl font-semibold text-main">{{ exchange?.name || exchangeId }}</h2>
          <p class="mt-1 text-sm muted-text">{{ exchange?.tagline }}</p>
        </div>
        <div class="inline-flex items-center rounded-md border border-white/10 bg-white/5 overflow-hidden shadow-sm">
          <button
            type="button"
            class="px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] hover:bg-white/10"
            @click="goOverview"
          >
            Overview
          </button>
          <span class="px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] bg-primary-500/20 text-primary-100">
            Logs
          </span>
        </div>
      </div>

      <section class="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-main">Live Activity</h3>
          <span class="text-[11px] uppercase tracking-[0.24em] muted-text" v-if="loading">Refreshing…</span>
        </div>
        <ul class="space-y-2">
          <li v-for="e in filteredLogs" :key="e.id" class="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
            <div class="flex items-center justify-between">
              <span :class="levelClass(e.title)">{{ e.title }}</span>
              <span class="text-[10px] muted-text">{{ e.time }}</span>
            </div>
            <p class="mt-1 text-[11px] text-gray-300">{{ e.detail }}</p>
          </li>
          <li v-if="filteredLogs.length === 0" class="text-center text-gray-400">No recent activity for this exchange.</li>
        </ul>
      </section>
    </main>
  `
};
