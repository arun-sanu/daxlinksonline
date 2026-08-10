import { ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'FlagsAdmin',
  setup() {
    const flags = ref([]);
    const error = ref('');
    async function load() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/flags`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        const rows = await res.json();
        flags.value = rows.map(r => ({ key: r.key, on: r.enabled, description: r.description, rolloutPercent: r.rolloutPercent || 0, audience: r.audience || null, rules: r.rules || null }));
      } catch (e) { error.value = e?.message || String(e); }
    }
    async function toggle(f) {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/flags/${encodeURIComponent(f.key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined },
          body: JSON.stringify({ enabled: !f.on })
        });
        if (!res.ok) throw new Error(await res.text());
        const row = await res.json();
        f.on = row.enabled;
      } catch (e) { error.value = e?.message || String(e); }
    }
    async function saveRollout(f) {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const res = await fetch(`${base}/admin/flags/${encodeURIComponent(f.key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined },
          body: JSON.stringify({ rolloutPercent: Number(f.rolloutPercent || 0) })
        });
        if (!res.ok) throw new Error(await res.text());
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }
    const evalKey = ref('');
    const evalUserId = ref('');
    const evalWorkspaceId = ref('');
    const evalResult = ref('');
    async function evaluate() {
      try {
        const key = evalKey.value || (flags.value[0]?.key || '');
        if (!key) return;
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const params = new URLSearchParams({ userId: evalUserId.value || '', workspaceId: evalWorkspaceId.value || '' }).toString();
        const res = await fetch(`${base}/admin/flags/${encodeURIComponent(key)}/evaluate?${params}`, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        evalResult.value = JSON.stringify(await res.json(), null, 2);
      } catch (e) { error.value = e?.message || String(e); }
    }
    const showAudience = ref(false);
    const aKey = ref('');
    const aUserIds = ref('');
    const aWorkspaceIds = ref('');
    const aRules = ref('');
    function openAudience(f) {
      showAudience.value = true;
      aKey.value = f.key;
      const aud = f.audience || {};
      aUserIds.value = (aud.userIds || []).join(',');
      aWorkspaceIds.value = (aud.workspaceIds || []).join(',');
      aRules.value = f.rules ? JSON.stringify(f.rules, null, 2) : '';
    }
    async function saveAudience() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const audience = { userIds: aUserIds.value.split(',').map(s=>s.trim()).filter(Boolean), workspaceIds: aWorkspaceIds.value.split(',').map(s=>s.trim()).filter(Boolean) };
        const body = { audience };
        if (aRules.value.trim()) {
          try { body.rules = JSON.parse(aRules.value); } catch { alert('Rules JSON invalid'); return; }
        }
        const res = await fetch(`${base}/admin/flags/${encodeURIComponent(aKey.value)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }, body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(await res.text());
        showAudience.value = false; await load();
      } catch (e) { error.value = e?.message || String(e); }
    }
    onMounted(load);
    return { flags, toggle, error, load, saveRollout, evalKey, evalUserId, evalWorkspaceId, evalResult, evaluate, showAudience, aKey, aUserIds, aWorkspaceIds, aRules, openAudience, saveAudience };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Config & Feature Flags</h3>
          <span class="section-label">Preview</span>
        </header>
        <p v-if="error" class="mt-3 text-sm text-rose-400">{{ error }}</p>
        <ul class="mt-4 divide-y divide-white/5">
          <li v-for="f in flags" :key="f.key" class="flex items-center justify-between py-3">
            <div>
              <p class="text-main">{{ f.key }}</p>
              <p class="text-xs text-gray-400">{{ f.description }}</p>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs text-gray-400">Rollout
                <input type="number" min="0" max="100" v-model="f.rolloutPercent" class="field w-20 ml-2" />
              </label>
              <button class="btn btn-secondary" @click="saveRollout(f)">Save</button>
              <button class="btn btn-secondary" @click="openAudience(f)">Audience</button>
              <button class="btn btn-secondary" @click="toggle(f)">{{ f.on ? 'Disable' : 'Enable' }}</button>
            </div>
          </li>
        </ul>
        <div class="mt-6 card-shell">
          <h4 class="text-main font-semibold">Evaluate Flag</h4>
          <div class="mt-3 grid gap-3 md:grid-cols-3">
            <input v-model="evalKey" class="field" placeholder="Flag key (default: first)" />
            <input v-model="evalUserId" class="field" placeholder="User ID (optional)" />
            <input v-model="evalWorkspaceId" class="field" placeholder="Workspace ID (optional)" />
          </div>
          <div class="mt-3 flex items-center justify-end">
            <button class="btn btn-secondary" @click="evaluate">Evaluate</button>
          </div>
          <pre class="mt-3 whitespace-pre-wrap text-xs">{{ evalResult }}</pre>
        </div>
        <!-- Audience modal -->
        <div v-if="showAudience" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div class="card-shell w-full max-w-lg">
            <h4 class="text-main font-semibold">Edit Audience — {{ aKey }}</h4>
            <div class="mt-3 grid gap-3">
              <label class="text-sm muted-text">User IDs (comma-separated)
                <input v-model="aUserIds" class="field mt-1" />
              </label>
              <label class="text-sm muted-text">Workspace IDs (comma-separated)
                <input v-model="aWorkspaceIds" class="field mt-1" />
              </label>
              <label class="text-sm muted-text">Rules (JSON, optional)
                <textarea v-model="aRules" class="field mt-1" rows="6" placeholder='{"country":"US"}'></textarea>
              </label>
            </div>
            <div class="mt-4 flex items-center justify-end gap-2">
              <button class="btn btn-secondary" @click="showAudience=false">Cancel</button>
              <button class="btn btn-white-animated" @click="saveAudience">Save</button>
            </div>
          </div>
        </div>
      </article>
    </section>
  `
};
