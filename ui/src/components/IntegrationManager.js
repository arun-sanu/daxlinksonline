export default {
  name: 'IntegrationManager',
  inheritAttrs: false,
  props: {
    profiles: {
      type: Array,
      default: () => []
    },
    availableExchanges: {
      type: Array,
      default: () => []
    },
    credentialEvents: {
      type: Array,
      default: () => []
    }
  },
  emits: ['test-integration'],
  data() {
    return {
      selectedExchangeId: '',
      imgErr: {}
    };
  },
  computed: {
    linkedMap() {
      return this.profiles.reduce((acc, profile) => {
        acc[profile.id] = profile;
        acc[profile.exchange || profile.id] = profile;
        return acc;
      }, {});
    },
    selectedExchange() {
      return this.availableExchanges.find((exchange) => exchange.id === this.selectedExchangeId) || null;
    },
    selectedProfile() {
      if (!this.selectedExchangeId) return null;
      return (
        this.profiles.find(
          (profile) => profile.exchange === this.selectedExchangeId
        ) || null
      );
    },
    orderedExchanges() {
      return [...this.availableExchanges].sort((a, b) => a.name.localeCompare(b.name));
    }
  },
  watch: {
    availableExchanges: {
      immediate: true,
      handler() {
        this.ensureSelection();
      }
    },
    selectedExchangeId(newId, oldId) {
      if (newId === oldId) return;
      // no-op on change
    }
  },
  methods: {
    resolvedIconUrl(exchange) {
      if (!exchange) return '';
      if (exchange.iconUrl && typeof exchange.iconUrl === 'string') return exchange.iconUrl;
      // Fallback to local asset by id if present
      if (exchange.id) return `/assets/${exchange.id}.svg`;
      return '';
    },
    ensureSelection() {
      if (this.availableExchanges.length === 0) {
        this.selectedExchangeId = '';
        return;
      }
      if (!this.selectedExchangeId) {
        const firstUnlinked =
          this.availableExchanges.find((exchange) => !this.linkedMap[exchange.id]) ||
          this.availableExchanges[0];
        this.selectedExchangeId = firstUnlinked.id;
      }
    },
    selectExchange(id) {
      this.selectedExchangeId = id;
      if (typeof window !== 'undefined' && window.__appRouter__) {
        window.__appRouter__.push({ name: 'exchange-detail', params: { exchangeId: id } });
      }
    }
  },
  template: `
    <section v-bind="$attrs" class="section-pad space-y-10">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-semibold text-main">Link Your Exchanges</h2>
          <p class="mt-2 text-sm muted-text">
            Choose only the venues you need. DaxLinks keeps credentials encrypted and lets you test connections instantly.
          </p>
        </div>
      </header>

      <div class="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <aside class="space-y-6">
          <div class="card-shell space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-main">Linked exchanges</h3>
              <span class="text-xs uppercase tracking-[0.24em] muted-text">{{ profiles.length }} connected</span>
            </div>
            <ul class="space-y-4">
              <li
                v-if="profiles.length === 0"
                class="rounded-xl border border-white/5 bg-white/5 px-4 py-6 text-xs text-center muted-text"
              >
                No exchanges connected yet. Select a venue to begin.
              </li>
              <li
                v-for="profile in profiles"
                :key="profile.id"
                class="rounded-xl border border-white/5 bg-white/5 px-4 py-4 text-xs text-main"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-main">{{ profile.name }}</p>
                    <p class="mt-1 text-[11px] uppercase tracking-[0.28em] muted-text">{{ profile.environment }}</p>
                  </div>
                  <span
                    class="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em]"
                    :style="profile.connected ? 'background: rgba(52,211,153,0.18); color: #34D399;' : 'background: rgba(250,204,21,0.18); color: #FACC15;'"
                  >
                    {{ profile.connected ? 'Live' : 'Pending' }}
                  </span>
                </div>
                <div class="mt-3 flex items-center justify-between gap-3 text-[11px] muted-text">
                  <span>Throttle {{ profile.rateLimit }} req/s</span>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    style="padding: 0.55rem 0.9rem;"
                    @click="$emit('test-integration', profile)"
                  >
                    Test
                  </button>
                </div>
              </li>
            </ul>
          </div>

          
        </aside>

        <div class="card-shell space-y-6">
          <div>
            <h3 class="text-sm font-semibold text-main">Available venues</h3>
            <div class="mt-4 flex flex-wrap gap-3">
              <button
                v-for="exchange in orderedExchanges"
                :key="exchange.id"
                type="button"
                @click="selectExchange(exchange.id)"
                class="rounded-2xl border px-4 py-3 text-left transition"
                :class="selectedExchangeId === exchange.id
                  ? 'border-primary-500/60 bg-primary-500/15 text-primary-100 shadow-[0_0_28px_rgba(107,107,247,0.35)]'
                  : 'border-white/10 bg-black/20 text-gray-300 hover:border-primary-500/30 hover:text-white'"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xl flex items-center justify-center h-6 w-6">
                    <img
                      v-if="!imgErr[exchange.id]"
                      :src="resolvedIconUrl(exchange)"
                      alt=""
                      class="h-6 w-6 object-contain"
                      referrerpolicy="no-referrer"
                      decoding="async"
                      @error="imgErr[exchange.id] = true"
                    />
                    <span v-else>{{ exchange.icon }}</span>
                  </span>
                  <span
                    v-if="linkedMap[exchange.id]"
                    class="rounded-full border border-primary-500/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-primary-100"
                  >
                    Linked
                  </span>
                </div>
                <p class="mt-3 text-sm font-semibold text-main">{{ exchange.name }}</p>
                <p class="mt-1 text-xs text-gray-400">{{ exchange.tagline }}</p>
              </button>
            </div>
          </div>

          <div v-if="selectedProfile && selectedExchange" class="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-main">{{ selectedExchange.name }} connected</p>
                <p class="mt-1 text-xs muted-text">Environment: {{ selectedProfile.environment }}</p>
              </div>
              <button
                type="button"
                class="btn btn-secondary text-xs tracking-[0.2em]"
                @click="$emit('test-integration', selectedProfile)"
              >
                Run connectivity test
              </button>
            </div>
            <p class="text-xs muted-text">Rotate keys or switch environments from the table on the left.</p>
          </div>

          <div v-else class="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-xs text-gray-500">
            Select an exchange above to manage it.
          </div>
        </div>
      </div>
    </section>
  `
};
