import { inject, computed, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import IntegrationManager from '../components/IntegrationManager.js';
import * as apiClient from '../services/apiClient.js?v=20251105h';

export default {
  name: 'IntegrationsPage',
  components: { IntegrationManager },
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const loading = computed(() => store.loading);
    onMounted(async () => {
      try {
        // Fetch canonical list from backend for authenticated users
        const exchanges = await apiClient.fetchAvailableExchanges();
        if (Array.isArray(exchanges) && exchanges.length) {
          store.availableExchanges = exchanges;
        }
      } catch (err) {
        // Fallback remains the UI default list
        console.warn('[IntegrationsPage] Unable to fetch exchanges; using defaults.', err?.message || err);
      }
    });
    return { store, actions, loading };
  },
  template: `
    <main class="layout-container section-pad">
      <div v-if="loading" class="flex h-64 items-center justify-center text-sm muted-text">
        Loading integrations...
      </div>
      <IntegrationManager
        v-else
        :profiles="store.integrationProfiles"
        :available-exchanges="store.availableExchanges"
        :credential-events="store.credentialEvents"
        @test-integration="actions.testIntegration"
      />
    </main>
  `
};
