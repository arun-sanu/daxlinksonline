import { inject, computed, ref, onMounted, onBeforeUnmount } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { useRouter, useRoute } from 'https://unpkg.com/vue-router@4/dist/vue-router.esm-browser.js';

export default {
  name: 'AdminLayout',
  setup() {
    const store = inject('dashboardStore');
    const router = useRouter();
    const route = useRoute();
    const isAdmin = computed(() => !!store.auth?.user && (store.auth.user.isSuperAdmin || store.auth.user.role === 'admin'));
    const nav = [
      { label: 'Home', name: 'admin-home' },
      { label: 'Users & Roles', name: 'admin-users' },
      { label: 'Databases', name: 'admin-databases' },
      { label: 'Webhooks', name: 'admin-webhooks' },
      { label: 'Jobs & Queues', name: 'admin-queues' },
      { label: 'Config & Flags', name: 'admin-flags' },
      { label: 'Incidents', name: 'admin-incidents' },
      { label: 'Secrets', name: 'admin-secrets' },
      { label: 'API Explorer', name: 'admin-api-explorer' },
      { label: 'Audit Log', name: 'admin-audit' }
    ];

    // Breadcrumbs
    const sectionLabel = computed(() => {
      const m = new Map(nav.map(n => [n.name, n.label]));
      return m.get(route.name) || 'Admin';
    });

    // Command palette (Ctrl/Cmd+K)
    const paletteOpen = ref(false);
    const paletteQuery = ref('');
    const commands = computed(() => [
      { id: 'go-home', label: 'Go to Admin Home', type: 'nav', to: { name: 'admin-home' } },
      { id: 'go-users', label: 'Manage Users & Roles', type: 'nav', to: { name: 'admin-users' } },
      { id: 'go-databases', label: 'Databases', type: 'nav', to: { name: 'admin-databases' } },
      { id: 'go-webhooks', label: 'Webhooks', type: 'nav', to: { name: 'admin-webhooks' } },
      { id: 'go-queues', label: 'Jobs & Queues', type: 'nav', to: { name: 'admin-queues' } },
      { id: 'go-flags', label: 'Config & Feature Flags', type: 'nav', to: { name: 'admin-flags' } },
      { id: 'go-audit', label: 'Audit Log', type: 'nav', to: { name: 'admin-audit' } },
      { id: 'enable-all-webhooks', label: 'Enable all webhooks (current workspace)', type: 'action', run: () => bulkWebhooks('enable') },
      { id: 'disable-all-webhooks', label: 'Disable all webhooks (current workspace)', type: 'action', run: () => bulkWebhooks('disable') },
      { id: 'rotate-all-dbs', label: 'Rotate credentials for all databases', type: 'action', run: () => rotateAllDbs() }
    ]);
    const filtered = computed(() => {
      const q = paletteQuery.value.toLowerCase().trim();
      if (!q) return commands.value;
      return commands.value.filter(c => c.label.toLowerCase().includes(q));
    });

    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        paletteOpen.value = !paletteOpen.value;
        paletteQuery.value = '';
      }
      if (e.key === 'Escape' && paletteOpen.value) {
        paletteOpen.value = false;
      }
    }
    onMounted(() => window.addEventListener('keydown', onKey));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

    async function bulkWebhooks(action) {
      const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
      const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
      if (!ws) return alert('No workspace selected');
      const res = await fetch(`${base}/admin/webhooks/${encodeURIComponent(ws)}/bulk?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }
      });
      if (!res.ok) alert(await res.text());
      else alert(`${action} queued`);
      paletteOpen.value = false;
    }
    async function rotateAllDbs() {
      const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
      const res = await fetch(`${base}/admin/databases/rotate-all`, {
        method: 'POST',
        headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }
      });
      if (!res.ok) alert(await res.text());
      else alert('Rotate-all requested');
      paletteOpen.value = false;
    }

    function run(cmd) {
      if (cmd.type === 'nav' && cmd.to) router.push(cmd.to);
      if (cmd.type === 'action' && typeof cmd.run === 'function') cmd.run();
    }

    return { store, isAdmin, nav, sectionLabel, paletteOpen, paletteQuery, filtered, run };
  },
  template: `
    <div class="grid min-h-[70vh] grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
      <aside class="card-shell space-y-3 h-full">
        <h2 class="text-sm section-label">Admin Console</h2>
        <nav class="flex flex-col gap-2">
          <router-link v-for="item in nav" :key="item.name" :to="{ name: item.name }" class="mobile-nav-link">
            {{ item.label }}
          </router-link>
        </nav>
        <p v-if="!isAdmin" class="text-xs text-rose-400">You do not have admin privileges.</p>
      </aside>
      <section class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-400">Admin / <span class="text-main">{{ sectionLabel }}</span></div>
          <button class="btn btn-secondary" title="Command palette (Ctrl/Cmd+K)" @click="paletteOpen = true">⌘K</button>
        </div>
        <router-view />
      </section>
      <!-- Command palette overlay -->
      <div v-if="paletteOpen" class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4">
        <div class="w-full max-w-xl card-shell">
          <input v-model="paletteQuery" autofocus class="field w-full" placeholder="Type a command or page..." />
          <ul class="mt-3 max-h-[50vh] overflow-y-auto">
            <li v-for="cmd in filtered" :key="cmd.id" class="flex items-center justify-between border-b border-white/5 py-2">
              <button class="text-left" @click="run(cmd)">{{ cmd.label }}</button>
              <span class="text-xs text-gray-500">{{ cmd.type }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  `
};
