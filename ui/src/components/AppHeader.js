import { useRoute, RouterLink } from 'https://unpkg.com/vue-router@4/dist/vue-router.esm-browser.js';
import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'AppHeader',
  components: { RouterLink },
  props: {
    navigation: {
      type: Array,
      default: () => []
    },
    mobileMenuOpen: {
      type: Boolean,
      default: false
    },
    uiMode: {
      type: String,
      default: 'client'
    }
  },
  emits: ['toggle-mobile', 'close-mobile'],
  setup() {
    const route = useRoute();
    const store = inject('dashboardStore', null);
    const isPrivileged = computed(() => {
      const u = store?.auth?.user;
      if (!u) return false;
      if (u.isSuperAdmin) return true;
      const role = String(u.role || '').toLowerCase();
      return role === 'admin' || role === 'developer' || role === 'engineer' || role === 'superadmin';
    });
    return { route, isPrivileged };
  },
  template: `
    <header class="header-blur sticky top-0 z-30">
      <div class="layout-container flex items-center justify-between gap-4 py-4">
        <div class="flex items-center gap-3 select-none" aria-label="Brand">
          <span class="brand-cyber">D><</span>
          <span v-if="uiMode === 'admin' && isPrivileged" class="text-[10px] uppercase tracking-[0.28em] px-2 py-1 rounded-full border border-white/10 text-primary-200 bg-[rgba(255,255,255,0.06)]">Admin Console</span>
        </div>
        <nav class="hidden flex-1 flex-wrap items-center justify-center gap-2 overflow-x-auto text-[11px] font-semibold uppercase tracking-[0.22em] md:flex md:gap-3">
          <RouterLink
            v-for="item in navigation"
            :key="item.name"
            :to="{ name: item.name }"
            class="rounded-full border border-transparent px-3 py-2 transition"
            :class="route.name === item.name ? 'border-primary-500/50 bg-primary-500/15 text-primary-100 shadow-[0_0_28px_rgba(107,107,247,0.45)]' : 'text-gray-400 hover:border-primary-500/30 hover:text-primary-100'"
            @click="$emit('close-mobile')"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <div class="flex items-center gap-3">
          <button
            class="inline-flex items-center justify-center rounded-full border border-white/10 bg-black/60 p-2 text-primary-100 transition hover:border-primary-500/40 hover:text-white md:hidden"
            @click="$emit('toggle-mobile')"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-nav"
            :aria-label="mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'"
          >
            <svg
              v-if="!mobileMenuOpen"
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <transition name="fade">
        <div
          v-if="mobileMenuOpen"
          id="mobile-nav"
          class="border-t border-primary-500/10 bg-black/95 shadow-[0_-25px_60px_rgba(18,152,230,0.18)] lg:hidden"
        >
          <div class="layout-container py-4">
            <nav class="flex flex-col gap-3 text-sm font-semibold text-gray-300">
              <RouterLink
                v-for="item in navigation"
                :key="item.name"
                :to="{ name: item.name }"
                class="rounded-2xl border border-white/10 bg-gradient-to-r from-gray-900 via-gray-950 to-black/80 px-4 py-3 uppercase tracking-[0.3em] transition hover:border-primary-500/40 hover:text-white"
                :class="route.name === item.name ? 'text-primary-100 shadow-[0_0_20px_rgba(18,152,230,0.25)]' : 'text-gray-200'"
                @click="$emit('close-mobile')"
              >
                {{ item.label }}
              </RouterLink>
            </nav>
          </div>
        </div>
      </transition>
    </header>
  `
};
