import { inject, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

async function apiRequest(path, { method = 'GET', body } = {}) {
  const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
  const url = `${base}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  // Use token from apiClient if available on window; otherwise rely on bearer in store
  const token = window.__appAuthToken__ || null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

export default {
  name: 'DatabasesAdmin',
  setup() {
    const store = inject('dashboardStore');
    const items = ref([]);
    const loading = ref(false);
    const error = ref('');
    const creating = ref(false);
    const form = ref({ name: '', engine: 'postgres', version: '16', region: 'us-east' });

    async function load() {
      loading.value = true; error.value = '';
      try {
        const rows = await apiRequest('/admin/databases', { method: 'GET' });
        items.value = Array.isArray(rows) ? rows : [];
      } catch (e) {
        error.value = e?.message || String(e);
      } finally { loading.value = false; }
    }

    async function createDb() {
      creating.value = true; error.value='';
      try {
        await apiRequest('/admin/databases', { method: 'POST', body: { ...form.value } });
        form.value = { name: '', engine: 'postgres', version: '16', region: 'us-east' };
        await load();
      } catch (e) { error.value = e?.message || String(e); }
      finally { creating.value = false; }
    }

    async function rotate(id) {
      try { await apiRequest(`/admin/databases/${encodeURIComponent(id)}/rotate`, { method: 'POST' }); await load(); }
      catch (e) { error.value = e?.message || String(e); }
    }

    async function remove(id) {
      try { await apiRequest(`/admin/databases/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load(); }
      catch (e) { error.value = e?.message || String(e); }
    }

    const showConfirm = ref(false);
    const reason = ref('');
    async function rotateAll() {
      showConfirm.value = true;
    }
    async function confirmRotateAll() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/databases/rotate-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined },
          body: JSON.stringify({ reason: reason.value })
        });
        if (!res.ok) throw new Error(await res.text());
        showConfirm.value = false; reason.value='';
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    onMounted(load);
    return { store, items, loading, error, form, creating, createDb, rotate, remove, rotateAll, showConfirm, reason, confirmRotateAll };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Databases</h3>
          <div class="flex items-center gap-2">
            <span class="section-label">Admin</span>
            <button class="btn btn-secondary" title="Rotate credentials for all" @click="rotateAll">Rotate all</button>
          </div>
        </header>
        <p v-if="loading" class="text-sm muted-text mt-3">Loading...</p>
        <p v-if="error" class="text-sm text-rose-400 mt-3">{{ error }}</p>
        <table v-if="!loading" class="w-full text-sm mt-3">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">Name</th>
              <th class="py-2">Engine</th>
              <th class="py-2">Region</th>
              <th class="py-2">Created</th>
              <th class="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="db in items" :key="db.id" class="border-t border-white/5">
              <td class="py-2">{{ db.name }}</td>
              <td class="py-2">{{ db.engine || 'postgres' }}</td>
              <td class="py-2">{{ db.region || 'us-east' }}</td>
              <td class="py-2">{{ db.createdAt || '—' }}</td>
              <td class="py-2">
                <button class="btn btn-secondary" @click="rotate(db.id)">Rotate</button>
                <button class="btn btn-secondary" @click="remove(db.id)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="card-shell">
        <h3 class="text-lg font-semibold text-main">Create Database</h3>
        <div class="mt-4 grid gap-3 md:grid-cols-4">
          <input v-model="form.name" placeholder="Name" class="field" />
          <select v-model="form.engine" class="field"><option>postgres</option></select>
          <input v-model="form.version" placeholder="Version" class="field" />
          <input v-model="form.region" placeholder="Region" class="field" />
        </div>
        <div class="mt-4">
          <button class="btn btn-white-animated" :disabled="creating || !form.name" @click="createDb">Create</button>
        </div>
      </article>

      <!-- Confirm rotate-all modal -->
      <div v-if="showConfirm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div class="card-shell w-full max-w-md">
          <h4 class="text-main font-semibold">Confirm rotate credentials for all databases</h4>
          <p class="text-sm muted-text mt-2">This action affects all managed databases.</p>
          <label class="block mt-3 text-sm muted-text">Reason (optional)
            <input v-model="reason" class="field mt-1" placeholder="Why?" />
          </label>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button class="btn btn-secondary" @click="showConfirm=false">Cancel</button>
            <button class="btn btn-white-animated" @click="confirmRotateAll">Confirm</button>
          </div>
        </div>
      </div>
    </section>
  `
};
