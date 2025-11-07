import { ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'QueuesAdmin',
  setup() {
    const stats = ref({ workers: 0, queues: [], dlq: 0 });
    const error = ref('');
    async function load() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/queues/summary`, {
          headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }
        });
        if (!res.ok) throw new Error(await res.text());
        stats.value = await res.json();
      } catch (e) { error.value = e?.message || String(e); }
    }
    onMounted(load);
    return { stats, error, load };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Jobs & Queues</h3>
          <span class="section-label">SRE</span>
        </header>
        <div class="mt-4 grid gap-4 md:grid-cols-4">
          <div class="stat-tile"><dt>Workers</dt><dd>{{ stats.workers }}</dd></div>
          <div class="stat-tile"><dt>Queues</dt><dd>{{ stats.queues.length }}</dd></div>
          <div class="stat-tile"><dt>DLQ</dt><dd>{{ stats.dlq || stats.queues.reduce((a,q)=>a+q.retries,0) }}</dd></div>
          <div class="stat-tile"><dt>Webhook queued</dt><dd>{{ (stats.queues.find(q=>q.name==='webhooks')||{}).depth || 0 }}</dd></div>
        </div>
        <p v-if="error" class="mt-3 text-sm text-rose-400">{{ error }}</p>
        <table class="w-full text-sm mt-6">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">Queue</th>
              <th class="py-2">Depth</th>
              <th class="py-2">Retries</th>
              <th class="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in stats.queues" :key="q.name" class="border-t border-white/5">
              <td class="py-2">{{ q.name }}</td>
              <td class="py-2">{{ q.depth }}</td>
              <td class="py-2">{{ q.retries }}</td>
              <td class="py-2">
                <button class="btn btn-secondary" disabled title="Pause coming soon">Pause</button>
                <button class="btn btn-secondary" disabled title="Drain coming soon">Drain</button>
                <button class="btn btn-secondary" disabled title="Replay DLQ coming soon">Replay DLQ</button>
              </td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>
  `
};
