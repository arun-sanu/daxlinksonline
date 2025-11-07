import { onMounted, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import * as dbApi from '../services/databaseApi.js';

export default {
  name: 'DatabaseDetailView',
  setup(_props, { attrs }) {
    const route = attrs?.route || null;
    const id = route?.params?.id || (location.hash.match(/databases\/([^?]+)/)?.[1] ?? '');
    const loading = ref(true);
    const db = ref(null);
    const tab = ref('overview');

    onMounted(async () => {
      try {
        db.value = await dbApi.getDatabase(id);
      } catch (e) {
        console.warn('[DatabaseDetail] Failed to load', e?.message || e);
      } finally {
        loading.value = false;
      }
    });

    return { loading, db, tab };
  },
  template: `
    <main class="layout-container py-8 space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <nav class="text-xs uppercase tracking-[0.28em] text-gray-500">Home · Databases</nav>
          <h1 class="mt-2 text-2xl font-semibold text-main">{{ db?.name || 'Database' }}</h1>
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-white/5 p-2">
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary text-[11px]" :class="tab==='overview' && 'bg-white/20'" @click="tab='overview'">Overview</button>
          <button type="button" class="btn btn-secondary text-[11px]" :class="tab==='analytics' && 'bg-white/20'" @click="tab='analytics'">Analytics</button>
          <button type="button" class="btn btn-secondary text-[11px]" :class="tab==='webhooks' && 'bg-white/20'" @click="tab='webhooks'">Webhooks</button>
          <button type="button" class="btn btn-secondary text-[11px]" :class="tab==='settings' && 'bg-white/20'" @click="tab='settings'">Settings</button>
        </div>
      </div>

      <section v-if="loading" class="card-shell h-64 animate-pulse"></section>

      <section v-else>
        <div v-if="tab==='overview'" class="space-y-4">
          <div class="card-shell">
            <p class="text-sm text-gray-300">Storage · {{ db?.usedGb || 0 }} GB / {{ db?.sizeGb || 0 }} GB</p>
            <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-emerald-400/80" :style="{ width: ((db?.usedGb||0)/(db?.sizeGb||1))*100 + '%' }"></div>
            </div>
          </div>
          <div class="card-shell">
            <header class="mb-3 flex items-center justify-between">
              <h3 class="text-sm font-semibold text-main">Live Trades</h3>
              <div class="text-xs text-gray-400">Realtime stream coming soon</div>
            </header>
            <div class="max-h-80 overflow-auto text-sm text-gray-300">
              <table class="w-full text-left">
                <thead class="text-xs text-gray-400">
                  <tr><th class="py-2">Symbol</th><th>Side</th><th>PnL</th><th>Time</th></tr>
                </thead>
                <tbody>
                  <tr><td class="py-2">—</td><td>—</td><td>—</td><td>—</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div v-else-if="tab==='analytics'" class="card-shell h-[60vh]">
          <iframe src="about:blank" title="Analytics" class="h-full w-full rounded-xl border-0 bg-black/20"></iframe>
        </div>

        <div v-else-if="tab==='webhooks'" class="card-shell">
          <p class="text-sm text-gray-300">Add endpoints to receive trade events. UI coming soon.</p>
        </div>

        <div v-else-if="tab==='settings'" class="card-shell">
          <button type="button" class="btn btn-secondary text-[11px]">Upgrade</button>
          <button type="button" class="btn btn-secondary text-[11px] ml-2">Delete</button>
        </div>
      </section>
    </main>
  `
};

