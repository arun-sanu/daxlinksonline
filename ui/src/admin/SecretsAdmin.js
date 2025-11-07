import { inject, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'SecretsAdmin',
  setup() {
    const store = inject('dashboardStore');
    const items = ref([]);
    const error = ref('');
    const loading = ref(false);
    const form = ref({ key: '', value: '', workspaceId: '' });
    const reveal = ref({ open: false, id: '', reason: '', value: '' });

    async function load() {
      loading.value = true; error.value='';
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__||{}).workspaceId || '';
        const res = await fetch(`${base}/admin/secrets?workspaceId=${encodeURIComponent(ws)}`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        items.value = await res.json();
      } catch (e) { error.value = e?.message || String(e); }
      finally { loading.value = false; }
    }

    async function createSecret() {
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__||{}).workspaceId || '';
        const body = { workspaceId: ws, key: form.value.key, value: form.value.value };
        const res = await fetch(`${base}/admin/secrets`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await res.text());
        form.value = { key: '', value: '', workspaceId: '' };
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function rotate(id) {
      const newValue = prompt('Enter new value');
      if (!newValue) return;
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const reason = prompt('Reason for rotation (optional)') || '';
        const res = await fetch(`${base}/admin/secrets/${encodeURIComponent(id)}/rotate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify({ newValue, reason }) });
        if (!res.ok) throw new Error(await res.text());
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function remove(id) {
      if (!confirm('Delete secret?')) return;
      const reason = prompt('Reason for deletion (required)');
      if (!reason) return;
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/secrets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify({ reason }) });
        if (!res.ok) throw new Error(await res.text());
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function openReveal(id) {
      reveal.value = { open: true, id, reason: '', value: '' };
    }

    async function confirmReveal() {
      try {
        const base = (window.__DAXLINKS_CONFIG__||{}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/secrets/${encodeURIComponent(reveal.value.id)}/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify({ reason: reveal.value.reason }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        reveal.value.value = data.value || '';
      } catch (e) { error.value = e?.message || String(e); }
    }

    function closeReveal() { reveal.value = { open: false, id: '', reason: '', value: '' }; }

    onMounted(load);
    return { store, items, error, loading, form, load, createSecret, rotate, remove, reveal, openReveal, confirmReveal, closeReveal };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Secrets</h3>
          <span class="section-label">Admin</span>
        </header>
        <p v-if="error" class="text-sm text-rose-400 mt-3">{{ error }}</p>
        <div class="mt-3 grid gap-3 md:grid-cols-3">
          <input v-model="form.key" class="field" placeholder="Key (e.g., STRIPE_API_KEY)" />
          <input v-model="form.value" class="field" placeholder="Value" />
          <button class="btn btn-white-animated" @click="createSecret">Create</button>
        </div>
        <table class="w-full text-sm mt-4">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">Key</th>
              <th class="py-2">Masked</th>
              <th class="py-2">Updated</th>
              <th class="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in items" :key="s.id" class="border-t border-white/5">
              <td class="py-2">{{ s.key }}</td>
              <td class="py-2">{{ s.valueMasked }}</td>
              <td class="py-2">{{ s.updatedAt }}</td>
              <td class="py-2">
                <button class="btn btn-secondary" @click="rotate(s.id)">Rotate</button>
                <button class="btn btn-secondary" @click="remove(s.id)">Delete</button>
                <button class="btn btn-secondary" @click="openReveal(s.id)">Reveal</button>
              </td>
            </tr>
          </tbody>
        </table>
      </article>

      <!-- Reveal modal -->
      <div v-if="reveal.open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div class="card-shell w-full max-w-lg">
          <h4 class="text-main font-semibold">One-time reveal</h4>
          <p class="text-xs text-gray-400 mt-1">Enter a reason to reveal this secret. This action is audited.</p>
          <label class="mt-3 text-sm muted-text">Reason
            <input v-model="reveal.reason" class="field mt-1" placeholder="Reason for reveal" />
          </label>
          <div class="mt-3 flex items-center gap-2">
            <button class="btn btn-secondary" @click="closeReveal">Cancel</button>
            <button class="btn btn-white-animated" :disabled="!reveal.reason" @click="confirmReveal">Reveal</button>
          </div>
          <div v-if="reveal.value" class="mt-4">
            <h5 class="text-sm text-main">Value (copy now; not stored)</h5>
            <pre class="mt-2 whitespace-pre-wrap text-xs">{{ reveal.value }}</pre>
          </div>
        </div>
      </div>
    </section>
  `
};
