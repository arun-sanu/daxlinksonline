import { ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'AuditLog',
  setup() {
    const entries = ref([]);
    const error = ref('');
    const q = ref('');
    const action = ref('');
    const userId = ref('');
    const dateFrom = ref('');
    const dateTo = ref('');
    const page = ref(1);
    const pageSize = ref(20);
    const total = ref(0);
    async function load() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) });
        if (q.value) params.set('q', q.value);
        if (action.value) params.set('action', action.value);
        if (userId.value) params.set('userId', userId.value);
        if (dateFrom.value) params.set('from', new Date(dateFrom.value).toISOString());
        if (dateTo.value) params.set('to', new Date(dateTo.value).toISOString());
        const res = await fetch(`${base}/admin/audit?${params.toString()}`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const rows = data.rows || [];
        entries.value = rows.map(r => ({ id: r.id, action: r.action, actor: r.userId, ts: r.createdAt, detail: r.summary }));
        total.value = data.total || rows.length;
      } catch (e) { error.value = e?.message || String(e); }
    }
    function exportCsv() {
      const cols = ['id','ts','actor','action','detail'];
      const header = cols.join(',');
      const rows = entries.value.map(e => cols.map(c => {
        const v = e[c] == null ? '' : String(e[c]);
        return '"' + v.replaceAll('"','""') + '"';
      }).join(','));
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'audit.csv'; a.click();
      URL.revokeObjectURL(url);
    }
    onMounted(load);
    return { entries, error, load, q, action, userId, dateFrom, dateTo, page, pageSize, total, exportCsv };
  },
  template: `
    <article class="card-shell">
      <header class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-main">Audit Log</h3>
        <div class="flex items-center gap-2">
          <span class="section-label">Recent</span>
          <button class="btn btn-secondary" @click="exportCsv">Export CSV</button>
        </div>
      </header>
      <div class="mt-3 grid gap-2 md:grid-cols-5">
        <input v-model="q" class="field" placeholder="Search text" />
        <input v-model="action" class="field" placeholder="Action contains" />
        <input v-model="userId" class="field" placeholder="User ID" />
        <input type="date" v-model="dateFrom" class="field" placeholder="From" />
        <input type="date" v-model="dateTo" class="field" placeholder="To" />
        <div class="md:col-span-5 flex items-center justify-end">
          <button class="btn btn-secondary" @click="page=1; load()">Apply</button>
        </div>
      </div>
      <p v-if="error" class="mt-3 text-sm text-rose-400">{{ error }}</p>
      <ul class="mt-4 space-y-3 text-sm">
        <li v-for="e in entries" :key="e.id" class="flex items-start justify-between border-b border-white/5 pb-2">
          <div>
            <p class="text-main">{{ e.action }}</p>
            <p class="muted-text">{{ e.detail }}</p>
          </div>
          <div class="text-right">
            <p class="text-xs text-gray-400">{{ e.actor }}</p>
            <p class="text-xs text-gray-500">{{ e.ts }}</p>
          </div>
        </li>
      </ul>
      <div class="mt-3 flex items-center justify-end gap-2 text-xs text-gray-400">
        <button class="btn btn-secondary" :disabled="page<=1" @click="page--; load()">Prev</button>
        <span>Page {{ page }}</span>
        <button class="btn btn-secondary" :disabled="page*pageSize>=total" @click="page++; load()">Next</button>
      </div>
    </article>
  `
};
