import { inject, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'UsersRoles',
  setup() {
    const store = inject('dashboardStore');
    const users = ref([]);
    const loading = ref(false);
    const error = ref('');

    async function load() {
      loading.value = true; error.value = '';
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/users`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        users.value = await res.json();
      } catch (e) { error.value = e?.message || String(e); }
      finally { loading.value = false; }
    }

    async function update(u) {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/users/${encodeURIComponent(u.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined },
          body: JSON.stringify({ role: u.role, isSuperAdmin: u.isSuperAdmin })
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) { error.value = e?.message || String(e); }
    }

    onMounted(load);
    return { store, users, loading, error, load, update };
  },
  template: `
    <article class="card-shell">
      <header class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-main">Users & Roles</h3>
        <span class="section-label">RBAC</span>
      </header>
      <div class="mt-4">
        <p v-if="loading" class="text-sm muted-text">Loading...</p>
        <p v-if="error" class="text-sm text-rose-400">{{ error }}</p>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">Name</th>
              <th class="py-2">Email</th>
              <th class="py-2">Role</th>
              <th class="py-2">Superadmin</th>
              <th class="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-t border-white/5">
              <td class="py-2">{{ u.name || '—' }}</td>
              <td class="py-2">{{ u.email || '—' }}</td>
              <td class="py-2">
                <select v-model="u.role" class="field py-2 px-2" @change="update(u)">
                  <option value="operator">operator</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td class="py-2">
                <label class="inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" v-model="u.isSuperAdmin" @change="update(u)" />
                  <span>Super</span>
                </label>
              </td>
              <td class="py-2"><button class="btn btn-secondary" @click="update(u)">Save</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  `
};
