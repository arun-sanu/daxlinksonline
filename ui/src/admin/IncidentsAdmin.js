import { inject, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'IncidentsAdmin',
  setup() {
    const store = inject('dashboardStore');
    const items = ref([]);
    const loading = ref(false);
    const error = ref('');
    const filterStatus = ref('open');
    const filterSeverity = ref('');
    const page = ref(1);
    const pageSize = ref(20);
    const total = ref(0);
    const selected = ref(null);
    const noteBody = ref('');
    const form = ref({ title: '', summary: '', severity: 'low' });

    async function load() {
      loading.value = true; error.value='';
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) });
        if (filterStatus.value) params.set('status', filterStatus.value);
        if (filterSeverity.value) params.set('severity', filterSeverity.value);
        const res = await fetch(`${base}/admin/incidents?${params.toString()}`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        items.value = data.rows || [];
        total.value = data.total || items.value.length;
      } catch (e) { error.value = e?.message || String(e); }
      finally { loading.value = false; }
    }

    async function openIncident(id) {
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/incidents/${encodeURIComponent(id)}`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        selected.value = await res.json();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function createIncident() {
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/incidents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify(form.value) });
        if (!res.ok) throw new Error(await res.text());
        form.value = { title: '', summary: '', severity: 'low' };
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function updateIncident(patch) {
      if (!selected.value) return;
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/incidents/${encodeURIComponent(selected.value.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify(patch) });
        if (!res.ok) throw new Error(await res.text());
        selected.value = await res.json();
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function addNote() {
      if (!selected.value || !noteBody.value) return;
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/incidents/${encodeURIComponent(selected.value.id)}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify({ body: noteBody.value }) });
        if (!res.ok) throw new Error(await res.text());
        noteBody.value = '';
        await openIncident(selected.value.id);
      } catch (e) { error.value = e?.message || String(e); }
    }

    onMounted(load);
    return { store, items, loading, error, filterStatus, filterSeverity, page, pageSize, total, selected, noteBody, form, load, openIncident, createIncident, updateIncident, addNote };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Incidents</h3>
          <span class="section-label">SRE</span>
        </header>
        <div class="mt-3 grid gap-3 md:grid-cols-5">
          <label class="text-xs text-gray-400">Status
            <select v-model="filterStatus" class="field" @change="page=1; load()">
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="ack">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <label class="text-xs text-gray-400">Severity
            <select v-model="filterSeverity" class="field" @change="page=1; load()">
              <option value="">All</option>
              <option>low</option><option>medium</option><option>high</option><option>critical</option>
            </select>
          </label>
          <div class="md:col-span-3 flex items-center justify-end gap-2">
            <button class="btn btn-secondary" @click="load">Refresh</button>
          </div>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <input v-model="form.title" class="field" placeholder="Title (e.g., Webhook latency spike)" />
          <select v-model="form.severity" class="field"><option>low</option><option>medium</option><option>high</option><option>critical</option></select>
          <button class="btn btn-white-animated" @click="createIncident">Create</button>
          <input v-model="form.summary" class="field md:col-span-3" placeholder="Summary (optional)" />
        </div>
        <table class="w-full text-sm mt-4">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">Title</th>
              <th class="py-2">Severity</th>
              <th class="py-2">Status</th>
              <th class="py-2">Started</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in items" :key="i.id" class="border-t border-white/5 hover:bg-white/5 cursor-pointer" @click="openIncident(i.id)">
              <td class="py-2">{{ i.title }}</td>
              <td class="py-2">{{ i.severity }}</td>
              <td class="py-2">{{ i.status }}</td>
              <td class="py-2">{{ i.startedAt }}</td>
            </tr>
          </tbody>
        </table>
        <div class="mt-3 flex items-center justify-end gap-2 text-xs text-gray-400">
          <button class="btn btn-secondary" :disabled="page<=1" @click="page--; load()">Prev</button>
          <span>Page {{ page }}</span>
          <button class="btn btn-secondary" :disabled="page*pageSize>=total" @click="page++; load()">Next</button>
        </div>
      </article>

      <article v-if="selected" class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Incident — {{ selected.title }}</h3>
          <button class="btn btn-secondary" @click="selected=null">Close</button>
        </header>
        <div class="mt-3 grid gap-3 md:grid-cols-4">
          <label class="text-xs text-gray-400">Severity
            <select class="field" v-model="selected.severity" @change="updateIncident({ severity: selected.severity })"><option>low</option><option>medium</option><option>high</option><option>critical</option></select>
          </label>
          <label class="text-xs text-gray-400">Status
            <select class="field" v-model="selected.status" @change="updateIncident({ status: selected.status })"><option>open</option><option>ack</option><option>resolved</option></select>
          </label>
          <div class="text-xs text-gray-400">Started: {{ selected.startedAt }}</div>
          <div class="text-xs text-gray-400">Updated: {{ selected.updatedAt }}</div>
        </div>
        <div class="mt-3">
          <h4 class="text-sm text-main">Summary</h4>
          <textarea class="field mt-2 w-full" rows="3" v-model="selected.summary" @blur="updateIncident({ summary: selected.summary })"></textarea>
        </div>
        <div class="mt-4">
          <h4 class="text-sm text-main">Notes</h4>
          <ul class="mt-2 space-y-2">
            <li v-for="n in selected.notes" :key="n.id" class="border-b border-white/5 pb-2">
              <div class="text-xs text-gray-400">{{ n.createdAt }}</div>
              <div class="text-sm">{{ n.body }}</div>
            </li>
          </ul>
          <div class="mt-2 flex items-center gap-2">
            <input v-model="noteBody" class="field flex-1" placeholder="Add note..." />
            <button class="btn btn-secondary" @click="addNote">Add</button>
          </div>
        </div>
      </article>
    </section>
  `
};
