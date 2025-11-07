import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import WebhookRouter from '../components/WebhookRouter.js';
import WebhookHero from '../components/WebhookHero.js';
import WebhookGuide from '../components/WebhookGuide.js';

export default {
  name: 'WebhooksPage',
  components: { WebhookRouter, WebhookHero, WebhookGuide },
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const loading = computed(() => store.loading);
    return { store, actions, loading };
  },
  template: `
    <main class="layout-container section-pad space-y-8">
      <div v-if="loading" class="flex h-64 items-center justify-center text-sm muted-text">
        Loading webhooks...
      </div>
      <WebhookHero v-else />
      <WebhookGuide v-if="!loading" />
      <WebhookRouter
        :webhooks="store.webhooks"
        :forms="store.forms"
        :webhook-events="store.webhookEvents"
        @save="actions.addWebhook"
        @toggle="actions.toggleWebhook"
      />
    </main>
  `
};
