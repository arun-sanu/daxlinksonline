import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'WebhookGuide',
  setup() {
    const store = inject('dashboardStore');
    const webhook = computed(() => store.auth?.user?.webhook || store.auth?.webhook || null);
    const url = computed(() => webhook.value?.url || '');
    const secret = computed(() => webhook.value?.secret || '');
    const example = computed(() => {
      const payload = {
        symbol: '{{ticker}}',
        side: '{{strategy.order.action}}',
        secret: '{{close}}'
      };
      return JSON.stringify(payload, null, 2);
    });

    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); } catch {}
    }

    return { url, secret, example, copyText };
  },
  template: `
    <section class="card-shell p-6 space-y-6">
      <h3 class="text-lg font-semibold text-main">TradingView Setup (3 steps)</h3>
      <div class="grid gap-6 md:grid-cols-3">
        <div class="space-y-3">
          <p class="text-sm font-semibold text-main">1) Alert → Webhook URL</p>
          <p class="text-xs muted-text">Create an alert and paste this URL:</p>
          <div class="hero-input">
            <input :value="url" readonly />
          </div>
          <button class="btn btn-secondary btn-xs" @click="copyText(url)">Copy URL</button>
        </div>
        <div class="space-y-3">
          <p class="text-sm font-semibold text-main">2) Message → JSON</p>
          <p class="text-xs muted-text">Use this payload in the alert message:</p>
          <pre class="text-xs p-3 rounded-xl" style="background: rgba(255,255,255,0.04); border:1px solid var(--border);"><code>{{ example }}</code></pre>
          <button class="btn btn-secondary btn-xs" @click="copyText(example)">Copy JSON</button>
        </div>
        <div class="space-y-3">
          <p class="text-sm font-semibold text-main">3) Enable → Test</p>
          <p class="text-xs muted-text">Turn on the alert and send a test. You should see a confirmation in your dashboard.</p>
          <ul class="text-xs muted-text list-disc pl-4">
            <li>Passphrase is dynamic (e.g., close price)</li>
            <li>We retry on transient errors</li>
            <li>Check queue stats in Admin → Queues</li>
          </ul>
        </div>
      </div>
    </section>
  `
};

