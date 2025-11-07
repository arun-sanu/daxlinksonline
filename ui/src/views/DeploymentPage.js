import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import DeploymentCta from '../components/DeploymentCta.js';

export default {
  name: 'DeploymentPage',
  components: { DeploymentCta },
  setup() {
    const store = inject('dashboardStore');
    const loading = computed(() => store.loading);
    return { store, loading };
  },
  template: `
    <main class="layout-container section-pad pb-24">
      <div v-if="loading" class="flex h-64 items-center justify-center text-sm muted-text">
        Loading deployment checklist...
      </div>
      <DeploymentCta
        v-else
        :onboarding="store.onboarding"
      />
    </main>
  `
};
