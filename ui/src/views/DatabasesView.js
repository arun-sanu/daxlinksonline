import { inject, onMounted, ref, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import DatabaseCard from '../components/DatabaseCard.js';
  import DatabaseMiniCard from '../components/DatabaseMiniCard.js';
  import {
    databaseStore,
    derived,
    loadDatabases,
    createDatabase,
    setSearch,
    setStatusFilter,
    selectDatabase,
    upgradePlan,
    deleteDatabase,
    renameDatabase as storeRenameDatabase
  } from '../stores/databaseStore.js';

export default {
  name: 'DatabasesView',
  components: { DatabaseCard },
  setup() {
    const store = databaseStore;
    const dash = inject('dashboardStore');
    const isAuthenticated = computed(() => Boolean(dash?.auth?.user));
    const isSuperAdmin = computed(() => Boolean(dash?.auth?.user?.isSuperAdmin));
    const search = ref(store.search);
    const status = ref(store.status);

    const refresh = async () => {
      setSearch(search.value);
      setStatusFilter(status.value);
      await loadDatabases();
    };

    const openCreate = async () => {
      if (!isAuthenticated.value) return;
      try {
        await createDatabase({ name: search.value || 'My First DB', sizeGb: 100 });
      } catch {}
    };

    onMounted(async () => {
      await refresh();
      if (!store.selectedId && store.items.length) {
        selectDatabase(store.items[0].id);
      }
    });

    const usageText = derived.usageText;
    const usagePercent = derived.usagePercent;

    function onView(db) {
      const router = window.__appRouter__;
      if (router) router.push({ path: `/databases/${db.id}` });
    }

    const section = ref('databases'); // 'dash' | 'databases' | 'subscriptions'
    const actionTab = ref('actions'); // actions | stats | webhooks | export
    const selectedId = computed(() => store.selectedId);
    const selectedDb = computed(() => store.items.find((d) => d.id === selectedId.value) || null);

    function handleSelect(db) {
      selectDatabase(db.id);
    }

    const chosenPlan = ref('free');
    async function applyUpgrade() {
      if (!selectedDb.value) return;
      await upgradePlan(selectedDb.value.id, chosenPlan.value);
    }

    async function removeSelected() {
      if (!selectedDb.value) return;
      if (!confirm('Remove this database? This action cannot be undone.')) return;
      await deleteDatabase(selectedDb.value.id);
    }

    // Inline rename via tiny pencil icon
    async function promptRename() {
      if (!selectedDb.value) return;
      const current = selectedDb.value.name || '';
      const next = (window.prompt('Rename database', current) || '').trim();
      if (!next || next === current) return;
      await storeRenameDatabase(selectedDb.value.id, next);
    }

    return {
      store,
      search,
      status,
      refresh,
      openCreate,
      usageText,
      usagePercent,
      onView,
      isAuthenticated,
      isSuperAdmin,
      section,
      selectedId,
      selectedDb,
      handleSelect,
      chosenPlan,
      applyUpgrade,
      removeSelected,
      promptRename,
      actionTab
    };
  },
  template: `
    <main class="layout-container py-8 space-y-6">
      <section v-if="!isSuperAdmin" class="card-shell text-center py-16">
        <p class="text-lg font-semibold text-main">Access restricted</p>
        <p class="mt-2 text-sm text-gray-400">Only super admins can access Databases.</p>
      </section>
      <template v-else>
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <nav class="text-xs uppercase tracking-[0.28em] text-gray-500">Home · Databases</nav>
          <h1 class="mt-2 text-2xl font-semibold text-main">My Databases</h1>
        </div>
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <div class="w-full md:w-80">
            <input v-model="search" @keyup.enter="refresh" type="search" placeholder="Search databases" class="field w-full" />
          </div>
          <select v-model="status" @change="refresh" class="field md:w-44">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </header>

      <nav class="flex items-center gap-6 text-[11px] uppercase tracking-[0.28em] text-gray-500">
        <button type="button" class="transition hover:text-primary-200" :class="section==='dash' ? 'text-primary-200' : ''" @click="section='dash'">dash</button>
        <button type="button" class="transition hover:text-primary-200" :class="section==='databases' ? 'text-primary-200' : ''" @click="section='databases'">databases</button>
        <button type="button" class="transition hover:text-primary-200" :class="section==='subscriptions' ? 'text-primary-200' : ''" @click="section='subscriptions'">subscriptions</button>
      </nav>

      <section v-if="section==='dash'" class="p-1">
        <p class="text-xs text-gray-300">{{ usageText }}</p>
        <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10 storage-animated">
          <div class="h-full rounded-full bg-emerald-400/80" :style="{ width: usagePercent + '%' }"></div>
        </div>
      </section>

      <section v-else-if="section==='subscriptions'" class="text-sm text-gray-300">
        Subscription management coming soon.
      </section>

      <section v-else>
        <div v-if="store.loading" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div v-for="n in 6" :key="n" class="card-shell h-44 animate-pulse bg-white/5"></div>
        </div>
        <div v-else-if="store.items.length === 0" class="card-shell text-center py-16">
          <p class="text-lg font-semibold text-main">No databases yet</p>
          <p class="mt-2 text-sm text-gray-400">Subscribe to start storing trades!</p>
          <button type="button" class="mt-6 btn btn-primary btn-white-animated text-xs tracking-[0.28em]" :disabled="!isAuthenticated" @click="openCreate">+ New Database</button>
        </div>
        <div v-else class="space-y-4">
          <div class="flex items-center justify-end">
            <button
              v-if="section==='databases'"
              type="button"
              class="btn btn-primary btn-white-animated text-xs tracking-[0.28em]"
              :disabled="!isAuthenticated"
              @click="openCreate"
            >
              + New Database
            </button>
          </div>
          <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <aside class="space-y-3">
            <DatabaseMiniCard
              v-for="db in store.items"
              :key="db.id"
              :database="db"
              :selected="selectedId===db.id"
              @select="handleSelect"
              @tables="onView"
              @view="onView"
            />
            </aside>
            <section class="space-y-4">
              <div v-if="!selectedDb" class="text-sm text-gray-400">Select a database from the left to manage.</div>
              <template v-else>
              <header class="flex items-center justify-between">
                <div>
                  <h3 class="text-lg font-semibold text-main">
                    {{ selectedDb.name }}
                    <button
                      type="button"
                      class="ml-2 align-middle text-[12px] text-gray-400 hover:text-white"
                      title="Rename"
                      aria-label="Rename database"
                      @click="promptRename"
                    >✏️</button>
                  </h3>
                  <p class="text-xs text-gray-400">Created {{ new Date(selectedDb.createdAt).toLocaleString() }} · {{ (selectedDb.tradesCount||0).toLocaleString() }} trades</p>
                </div>
                <span class="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.28em] text-gray-300">{{ selectedDb.status }}</span>
              </header>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-gray-300">
                  <span>Storage</span>
                  <span>{{ selectedDb.usedGb || 0 }} GB / {{ selectedDb.sizeGb || 0 }} GB</span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-white/10 storage-animated">
                  <div class="h-full rounded-full bg-emerald-400/80" :style="{ width: Math.min(100, Math.round(((selectedDb.usedGb||0)/(selectedDb.sizeGb||1))*100)) + '%' }"></div>
                </div>
              </div>

              <div>
                <div class="mb-2 flex items-center gap-4 text-[11px] uppercase tracking-[0.28em] text-gray-500">
                  <button type="button" class="transition hover:text-primary-200" :class="actionTab==='actions' ? 'text-primary-200' : ''" @click="actionTab='actions'">Actions</button>
                  <button type="button" class="transition hover:text-primary-200" :class="actionTab==='stats' ? 'text-primary-200' : ''" @click="actionTab='stats'">Statistics</button>
                  <button type="button" class="transition hover:text-primary-200" :class="actionTab==='webhooks' ? 'text-primary-200' : ''" @click="actionTab='webhooks'">Webhooks</button>
                  <button type="button" class="transition hover:text-primary-200" :class="actionTab==='export' ? 'text-primary-200' : ''" @click="actionTab='export'">Export</button>
                </div>
                <div v-if="actionTab==='actions'" class="grid gap-3 sm:grid-cols-2">
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p class="text-xs uppercase tracking-[0.22em] text-gray-500">Adjust size</p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <label v-for="opt in [{k:'free',l:'100 GB'},{k:'plus',l:'500 GB'},{k:'enterprise',l:'2 TB'}]" :key="opt.k" class="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-gray-300">
                        <input type="radio" name="plan" :value="opt.k" v-model="chosenPlan" /> {{ opt.l }}
                      </label>
                    </div>
                    <button type="button" class="mt-3 btn btn-secondary text-[11px]" @click="applyUpgrade">Apply</button>
                  </div>
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p class="text-xs uppercase tracking-[0.22em] text-gray-500">Other</p>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <button type="button" class="btn btn-secondary text-[11px]" @click="onView(selectedDb)">View Tables</button>
                      <button type="button" class="btn btn-secondary text-[11px]" @click="removeSelected">Remove Database</button>
                    </div>
                  </div>
                </div>
                <div v-else-if="actionTab==='stats'" class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                  More statistics coming soon.
                </div>
                <div v-else-if="actionTab==='webhooks'" class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                  Webhooks management coming soon.
                </div>
                <div v-else-if="actionTab==='export'" class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                  Export tools coming soon.
                </div>
              </div>
            </template>
            </section>
          </div>
        </div>
      </section>
      </template>
    </main>
  `
};
