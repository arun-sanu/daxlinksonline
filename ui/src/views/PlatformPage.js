import { inject, computed, ref, onMounted, onBeforeUnmount, watch } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { useRouter } from 'https://unpkg.com/vue-router@4/dist/vue-router.esm-browser.js';

function pluralize(count, singular, plural = `${singular}s`) {
  const safeCount = Number.isFinite(count) ? count : 0;
  return `${safeCount} ${safeCount === 1 ? singular : plural}`;
}

function buildModuleInventory(store) {
  const safeIntegrations = Array.isArray(store.integrationProfiles) ? store.integrationProfiles.length : 0;
  const safeWebhooks = Array.isArray(store.webhooks) ? store.webhooks.length : 0;
  const safeWorkflow = Array.isArray(store.dataflowNodes) ? store.dataflowNodes.length : 0;
  const safeEvents = Array.isArray(store.credentialEvents) ? store.credentialEvents.length : 0;
  const safeResources = Array.isArray(store.resources) ? store.resources.length : 0;
  const safeSessions = Array.isArray(store.recentSessions) ? store.recentSessions.length : 0;

  const baseModules = [
    {
      id: 'integrations',
      name: 'integrations',
      label: 'Integrations',
      metric: pluralize(safeIntegrations, 'connected exchange'),
      icon: '📡',
      requiresAuth: true,
      comingSoon: false
    },
    {
      id: 'databases',
      name: 'databases',
      label: 'Databases',
      metric: 'Managed clusters',
      icon: '🗄️',
      requiresAuth: true,
      requiresSuperAdmin: true,
      comingSoon: false
    },
    {
      id: 'webhooks',
      name: 'webhooks',
      label: 'Webhooks',
      metric: pluralize(safeWebhooks, 'active webhook'),
      icon: '🔗',
      requiresAuth: true,
      comingSoon: false
    },
    {
      id: 'workflow',
      name: 'workflow',
      label: 'Workflow',
      metric: pluralize(safeWorkflow, 'node'),
      icon: '🧠',
      requiresAuth: true,
      comingSoon: false
    },
    {
      id: 'monitoring',
      name: 'monitoring',
      label: 'Monitoring',
      metric: pluralize(safeEvents, 'recent event'),
      icon: '📈',
      requiresAuth: true,
      comingSoon: true
    },
    {
      id: 'resources',
      name: 'resources',
      label: 'Resources',
      metric: pluralize(safeResources, 'resource entry'),
      icon: '📚',
      requiresAuth: false,
      comingSoon: false
    },
    {
      id: 'trade-bots',
      name: 'trade-bots',
      label: 'Trade Bots',
      metric: 'Strategies ready',
      icon: '🤖',
      requiresAuth: true,
      comingSoon: false
    },
    {
      id: 'banking',
      name: 'banking',
      label: 'Banking',
      metric: 'Settlement windows synced',
      icon: '🏦',
      requiresAuth: true,
      comingSoon: true
    },
    {
      id: 'dns',
      name: 'dns',
      label: 'DNS',
      metric: 'Domains overseen',
      icon: '🛰️',
      requiresAuth: true,
      comingSoon: false
    },
    {
      id: 'deployment',
      name: 'deployment',
      label: 'Deployment',
      metric: 'Pipelines monitored',
      icon: '🚀',
      requiresAuth: true,
      comingSoon: false
    }
  ];

  const futureModules = [
    
    {
      id: 'vpn',
      name: 'vpn',
      label: 'VPN',
      metric: 'Edge tunnels',
      icon: '🔐',
      requiresAuth: true,
      comingSoon: true
    },
    {
      id: 'support',
      name: 'support',
      label: 'Support',
      metric: 'Ops concierge',
      icon: '🎧',
      requiresAuth: false,
      comingSoon: true
    },
    {
      id: 'intelligent-visualizations',
      name: 'intelligent-visualizations',
      label: 'Intelligent Visualizations',
      metric: 'Adaptive dashboards',
      icon: '🧬',
      requiresAuth: true,
      comingSoon: true
    },
    {
      id: 'ar',
      name: 'ar',
      label: 'AR',
      metric: 'Field overlays',
      icon: '🕶️',
      requiresAuth: true,
      comingSoon: true
    },
    {
      id: 'chart',
      name: 'chart',
      label: 'Chart',
      metric: 'Precision charting',
      icon: '📊',
      requiresAuth: true,
      comingSoon: true
    }
  ];

  return [...baseModules, ...futureModules];
}

export default {
  name: 'PlatformPage',
  setup() {
    const store = inject('dashboardStore');
    const router = useRouter();

    const now = ref(new Date());
    let timer = null;

    const loading = computed(() => store.loading);
    const modules = computed(() => buildModuleInventory(store));
    const selectedId = ref(null);
    const searchQuery = ref('');
    const lockedMessage = ref('');

    const isAuthenticated = computed(() => Boolean(store.auth?.user));
    const isSuperAdmin = computed(() => Boolean(store.auth?.user?.isSuperAdmin));
    const isDeveloper = computed(() => {
      const role = String(store.auth?.user?.role || '').toLowerCase();
      return role === 'developer' || role === 'engineer' || role === 'admin';
    });
    const isPrivileged = computed(() => isSuperAdmin.value || isDeveloper.value);
    const formattedTime = computed(() => {
      const hoursMinutes = now.value.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
      });
      const seconds = now.value.getSeconds().toString().padStart(2, '0');
      return { hoursMinutes, seconds };
    });

    const formattedDate = computed(() =>
      now.value.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    );

    const filteredModules = computed(() => {
      const query = searchQuery.value.trim().toLowerCase();
      if (!query) return modules.value;
      return modules.value.filter((item) => item.label.toLowerCase().includes(query));
    });

    const selectedModule = computed(() =>
      modules.value.find((item) => item.id === selectedId.value) || null
    );

    const handleSelect = (item) => {
      if (item.requiresAuth && !isAuthenticated.value) {
        lockedMessage.value = 'Sign in to access ' + item.label.toLowerCase() + '.';
        return;
      }
      if (item.requiresSuperAdmin && !isPrivileged.value) {
        lockedMessage.value = 'Access restricted to privileged roles (superadmin, admin, developer, engineer).';
        return;
      }
      lockedMessage.value = '';
      if (selectedId.value === item.id) {
        router.push({ name: item.name });
      } else {
        selectedId.value = item.id;
      }
    };

    watch(
      modules,
      (list) => {
        if (!list.length) {
          selectedId.value = null;
          return;
        }
        if (selectedId.value && !list.some((item) => item.id === selectedId.value)) {
          selectedId.value = null;
        }
      },
      { immediate: true }
    );

    watch(isAuthenticated, (authed) => {
      if (authed && lockedMessage.value) {
        lockedMessage.value = '';
      }
    });

    onMounted(() => {
      timer = setInterval(() => {
        now.value = new Date();
      }, 1000);
    });

    onBeforeUnmount(() => {
      if (timer) {
        clearInterval(timer);
      }
    });

    return {
      loading,
      modules,
      formattedTime,
      formattedDate,
      selectedModule,
      selectedId,
      handleSelect,
      searchQuery,
      filteredModules,
      isAuthenticated,
      isSuperAdmin,
      lockedMessage
    };
  },
  template: `
    <main class="pt-20 pb-24">
      <section v-if="loading" class="layout-container">
        <div class="card-shell text-sm text-gray-400">Loading platform inventory…</div>
      </section>
      <section v-else class="layout-container">
        <div class="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start">
          <div class="space-y-10 self-stretch">
            <div class="space-y-2">
              <p class="text-5xl md:text-6xl lg:text-7xl font-light text-main font-mono tracking-wider">
                {{ formattedTime.hoursMinutes }}
                <span class="align-baseline text-lg font-light text-primary-200">:{{ formattedTime.seconds }}</span>
              </p>
              <p class="text-sm text-gray-400">{{ formattedDate }}</p>
            </div>
            <div class="relative">
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search modules"
                class="w-full rounded-xl border border-white/15 bg-transparent px-4 py-2 text-xs text-gray-200 placeholder:text-gray-500 focus:border-primary-400 focus:outline-none focus:ring-0"
              />
              <span class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.3em] text-gray-600">
                SCAN
              </span>
            </div>
            <div class="space-y-4">
              <p class="text-xs uppercase tracking-[0.32em] text-gray-500">daxlinks.online</p>
              <p class="text-3xl font-light text-main">
                {{ selectedModule ? selectedModule.label : 'Welcome to daxlinks.online' }}
              </p>
              <p v-if="selectedModule && selectedModule.comingSoon" class="text-sm text-primary-300">
                Coming soon
              </p>
              <p v-if="selectedModule" class="text-sm text-gray-400">
                {{ selectedModule.metric }}
              </p>
              <p v-if="!selectedModule && lockedMessage" class="text-sm text-primary-300">
                {{ lockedMessage }}
              </p>
              <p v-else-if="!selectedModule" class="text-sm text-gray-500">
                Navigate through modules to orchestrate the platform.
              </p>
              <p v-if="lockedMessage" class="text-xs text-primary-300">
                {{ lockedMessage }}
              </p>
            </div>
          </div>
          <div class="rounded-3xl border border-transparent bg-transparent p-2">
            <div class="scroll-shell max-h-[70vh] overflow-y-auto pr-2">
              <div class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <button
                  v-for="item in filteredModules"
                  :key="item.id"
                  type="button"
                  class="group relative flex aspect-square flex-col items-center justify-center gap-3 rounded-3xl border px-4 py-5 transition"
                  :class="[selectedId === item.id
                    ? 'border-primary-400/70 bg-primary-500/20'
                    : 'border-white/10 bg-transparent hover:border-primary-400/40 hover:bg-primary-500/10',
                    (item.requiresAuth && !isAuthenticated) || (item.requiresSuperAdmin && !isPrivileged) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer']"
                  :disabled="(item.requiresAuth && !isAuthenticated) || (item.requiresSuperAdmin && !isPrivileged)"
                  :aria-disabled="item.requiresAuth && !isAuthenticated"
                  @click="handleSelect(item)"
                >
                  <div class="absolute right-4 top-3 flex flex-col items-center gap-1 text-sm">
                    <span
                      :class="(item.requiresAuth && !isAuthenticated) || (item.requiresSuperAdmin && !isPrivileged) ? 'text-primary-200/80' : 'text-primary-200/40'"
                    >
                      {{ item.requiresAuth && !isAuthenticated ? '🔒' : '🔓' }}
                    </span>
                    <span
                      v-if="item.comingSoon"
                      class="mt-1 h-3 w-3 rounded-full border border-primary-200/60 border-t-transparent spin-indicator"
                    ></span>
                    <span
                      v-else-if="item.id==='databases'"
                      class="mt-1 h-3 w-3 rounded-full border border-primary-200/60 border-t-transparent spin-indicator"
                    ></span>
                  </div>
                  <div class="flex flex-col items-center gap-3 text-center">
                    <span
                      class="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl transition"
                      :class="[
                        selectedId === item.id ? 'bg-white/20 text-white active-icon-glow' : 'bg-white/10 text-white/80 group-hover:bg-white/15 group-hover:text-white'
                      ]"
                    >
                      {{ item.icon }}
                    </span>
                    <span class="text-sm font-semibold text-white/90">{{ item.label }}</span>
                    <div class="h-[2px] w-10 rounded-full transition" :class="selectedId === item.id ? 'bg-white/60' : 'bg-white/15 group-hover:bg-white/30'"></div>
                  </div>
                </button>
                <p v-if="!filteredModules.length" class="col-span-full py-12 text-center text-sm text-gray-500">
                  No modules match “{{ searchQuery }}”
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `
};
