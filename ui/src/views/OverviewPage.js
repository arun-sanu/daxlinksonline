import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import HeroSection from '../components/HeroSection.js';
import ResourceHub from '../components/ResourceHub.js';

export default {
  name: 'OverviewPage',
  components: { HeroSection, ResourceHub },
  setup() {
    const store = inject('dashboardStore');
    const docLink = inject('docLink', '#');
    const loading = computed(() => store.loading);
    return { store, docLink, loading };
  },
  template: `
    <main class="space-y-16 pb-24">
      <HeroSection
        :metrics="store.metrics"
        :webcast="store.webcast"
        :doc-link="docLink"
      />
      <section class="layout-container">
        <ResourceHub :resources="store.resources" :roadmap="store.roadmap" />
      </section>
    </main>
  `
};
