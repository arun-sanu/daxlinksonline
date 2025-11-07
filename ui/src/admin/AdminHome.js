import { inject } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'AdminHome',
  setup() {
    const store = inject('dashboardStore');
    return { store };
  },
  template: `
    <div class="grid gap-6 md:grid-cols-2">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">System Health</h3>
          <span class="hero-callout">Live</span>
        </header>
        <ul class="mt-4 space-y-2 text-sm muted-text">
          <li>API Status: <span class="text-green-400">OK</span></li>
          <li>Recent Sessions: {{ store.recentSessions.length || 0 }}</li>
          <li>Connected Exchanges: {{ store.workflowSummary.connectedExchanges || 0 }}</li>
        </ul>
      </article>
      <article class="card-shell">
        <h3 class="text-lg font-semibold text-main">Quick Actions</h3>
        <div class="mt-4 flex flex-wrap gap-3">
          <router-link class="btn btn-secondary" :to="{ name: 'admin-users' }">Manage Users</router-link>
          <router-link class="btn btn-secondary" :to="{ name: 'admin-databases' }">Databases</router-link>
          <router-link class="btn btn-secondary" :to="{ name: 'admin-audit' }">Audit Log</router-link>
        </div>
      </article>
    </div>
  `
};

