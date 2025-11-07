import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import ResourceHub from '../components/ResourceHub.js';

export default {
  name: 'ResourcesPage',
  components: { ResourceHub },
  setup() {
    const store = inject('dashboardStore');
    const loading = computed(() => store.loading);
    return { store, loading };
  },
  template: `
    <main class="layout-container section-pad">
      <div v-if="loading" class="flex h-64 items-center justify-center text-sm muted-text">
        Loading resources...
      </div>
      <ResourceHub
        v-else
        :resources="store.resources"
        :roadmap="store.roadmap"
      />
    </main>
  `
};
