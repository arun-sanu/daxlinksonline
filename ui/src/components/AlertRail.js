import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'AlertRail',
  setup() {
    const actions = inject('dashboardActions', {});
    const store = inject('dashboardStore', null);
    const isAuthenticated = computed(() => Boolean(store?.auth?.user));
    const logout = () => {
      if (typeof actions.logoutAccount === 'function') actions.logoutAccount();
    };
    return { isAuthenticated, logout };
  },
  template: `
    <aside class="alert-tab" aria-label="Notifications panel">
      <button type="button" class="alert-tab__button" aria-label="View notifications">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      </button>
      <button type="button" class="alert-tab__button alert-tab__button--accent" aria-label="View alerts">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3m0 3h.01m-.01-12a9 9 0 100 18 9 9 0 000-18z" />
        </svg>
      </button>
      <button
        v-if="isAuthenticated"
        type="button"
        class="alert-tab__button"
        aria-label="Log out"
        title="Log out"
        @click="logout"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12H3m12 0l-4-4m4 4l-4 4M21 5v14a2 2 0 01-2 2h-6" />
        </svg>
      </button>
    </aside>
  `
};
