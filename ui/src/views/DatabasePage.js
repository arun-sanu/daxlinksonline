import { inject, computed, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import * as api from '../services/apiClient.js?v=20251105h';

export default {
  name: 'DatabasePage',
  setup() {
    const store = inject('dashboardStore');
    const isAuthenticated = computed(() => Boolean(store?.auth?.user));
    const isSuperAdmin = computed(() => Boolean(store?.auth?.user?.isSuperAdmin));
    const loading = ref(false);
    const rows = ref([]);
    const form = ref({ name: '', provider: 'self_hosted', region: 'us-east', sizeTier: 'free' });

    const load = async () => {
      if (!isAuthenticated.value) return;
      loading.value = true;
      try {
        const list = await api.adminListDatabases();
        rows.value = Array.isArray(list) ? list : [];
      } catch (e) {
        console.error('[Database] list error', e);
      } finally {
        loading.value = false;
      }
    };

    const createNewDatabase = async () => {
      if (!isSuperAdmin.value) {
        console.warn('[Database] Super admin required');
        return;
      }
      if (!form.value.name) return;
      loading.value = true;
      try {
        await api.adminCreateDatabase({
          name: form.value.name,
          provider: form.value.provider,
          region: form.value.region,
          sizeTier: form.value.sizeTier
        });
        form.value.name = '';
        await load();
      } catch (e) {
        console.error('[Database] create error', e);
      } finally {
        loading.value = false;
      }
    };

    const rotate = async (id) => {
      if (!isSuperAdmin.value) return;
      await api.adminRotateDatabase(id);
      await load();
    };

    const removeDb = async (id) => {
      if (!isSuperAdmin.value) return;
      if (!confirm('Delete this database?')) return;
      await api.adminDeleteDatabase(id);
      await load();
    };

    onMounted(load);
    return { isAuthenticated, isSuperAdmin, loading, rows, form, createNewDatabase, rotate, removeDb };
  },
  template: `
    <main class="layout-container py-16 space-y-10">
      <section class="card-shell">
        <header class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-main">Database Instances</h2>
          <span v-if="!isSuperAdmin" class="text-xs uppercase tracking-[0.3em] text-gray-500">Read-only</span>
        </header>
        <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading...</div>
        <div v-else class="mt-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-gray-400">
              <tr>
                <th class="py-2">Name</th>
                <th class="py-2">Provider</th>
                <th class="py-2">Region</th>
                <th class="py-2">Size</th>
                <th class="py-2">Status</th>
                <th class="py-2">Host</th>
                <th class="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" class="border-t border-white/10">
                <td class="py-2">{{ row.name }}</td>
                <td class="py-2">{{ row.provider }}</td>
                <td class="py-2">{{ row.region }}</td>
                <td class="py-2">{{ row.sizeTier }}</td>
                <td class="py-2">{{ row.status }}</td>
                <td class="py-2">{{ row.host || '—' }}</td>
                <td class="py-2 text-right space-x-2">
                  <button class="btn btn-secondary text-[11px]" :disabled="!isSuperAdmin" @click="rotate(row.id)">Rotate</button>
                  <button class="btn btn-secondary text-[11px]" :disabled="!isSuperAdmin" @click="removeDb(row.id)">Delete</button>
                </td>
              </tr>
              <tr v-if="rows.length === 0">
                <td colspan="7" class="py-6 text-center text-gray-500">No databases yet</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card-shell" v-if="isSuperAdmin">
        <h3 class="text-sm font-semibold text-main">Create Database</h3>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2 text-sm text-gray-400">
            Name
            <input v-model="form.name" type="text" placeholder="analytics-prod" class="field" />
          </label>
          <label class="flex flex-col gap-2 text-sm text-gray-400">
            Provider
            <select v-model="form.provider" class="field">
              <option value="self_hosted">Self Hosted</option>
              <option value="neon">Neon</option>
              <option value="supabase">Supabase</option>
              <option value="render">Render</option>
            </select>
          </label>
          <label class="flex flex-col gap-2 text-sm text-gray-400">
            Region
            <input v-model="form.region" type="text" placeholder="us-east" class="field" />
          </label>
          <label class="flex flex-col gap-2 text-sm text-gray-400">
            Size Tier
            <select v-model="form.sizeTier" class="field">
              <option value="free">Free</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
        </div>
        <div class="mt-4">
          <button type="button" class="btn btn-primary text-xs tracking-[0.3em]" :disabled="loading || !form.name" @click="createNewDatabase">Create</button>
        </div>
      </section>
    </main>
  `
};
