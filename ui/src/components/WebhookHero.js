import { inject, computed, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

function formatCountdown(target) {
  if (!target) return '—';
  const now = Date.now();
  const t = target instanceof Date ? target.getTime() : new Date(target).getTime();
  const diff = Math.max(0, t - now);
  const days = Math.floor(diff / (24 * 3600e3));
  const hours = Math.floor((diff % (24 * 3600e3)) / 3600e3);
  return `${days}d ${hours}h`;
}

export default {
  name: 'WebhookHero',
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const copied = ref({ url: false, secret: false });
    const testing = ref(false);
    const testMsg = ref('');

    const webhook = computed(() => store.auth?.user?.webhook || store.auth?.webhook || null);
    const url = computed(() => webhook.value?.url || '');
    const secret = computed(() => webhook.value?.secret || '');
    const countdown = computed(() => formatCountdown(webhook.value?.trialEndsAt));
    const expiringSoon = computed(() => {
      const t = webhook.value?.trialEndsAt ? new Date(webhook.value.trialEndsAt).getTime() : 0;
      return t > 0 && t - Date.now() <= 3 * 24 * 3600e3;
    });
    const billingUrl = computed(() => (window.__DAXLINKS_CONFIG__?.billingUrl || window.__DAXLINKS_CONFIG__?.checkoutUrl || null));

    async function copy(text, key) {
      try {
        await navigator.clipboard.writeText(text);
        copied.value[key] = true;
        setTimeout(() => (copied.value[key] = false), 1200);
      } catch {}
    }

    async function testAlert() {
      testMsg.value = '';
      testing.value = true;
      try {
        const resp = await fetch(`${(window.__DAXLINKS_CONFIG__?.apiBaseUrl || '')}/webhook/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.auth.token}` },
          body: JSON.stringify({ symbol: 'BTCUSDT', side: 'buy', secret: secret.value })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        testMsg.value = '✅ Test alert queued';
        setTimeout(() => (testMsg.value = ''), 2000);
      } catch (e) {
        testMsg.value = `⚠️ Test failed: ${e?.message || e}`;
      } finally {
        testing.value = false;
      }
    }

    return { webhook, url, secret, countdown, expiringSoon, copied, copy, testing, testMsg, store, billingUrl };
  },
  template: `
    <section v-if="webhook" class="card-shell p-6 space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-xl" style="background: linear-gradient(135deg,#00D4AA,#2EE6C9);"></div>
          <div>
            <p class="text-sm font-semibold text-main">Your 28‑day FREE webhook is READY!</p>
            <p class="text-xs muted-text">Expires in <span :style="expiringSoon ? 'color:#F59E0B' : 'color:#00D4AA'">{{ countdown }}</span></p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-xs uppercase tracking-[0.3em] muted-text">Passphrase</p>
          <p class="text-sm font-mono text-main">{{ secret || '—' }}</p>
        </div>
      </div>
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <div class="hero-input flex-1">
          <input :value="url" readonly />
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary text-xs" @click="copy(url,'url')">{{ copied.url ? 'Copied!' : 'Copy URL' }}</button>
          <button class="btn btn-secondary text-xs" @click="copy(secret,'secret')">{{ copied.secret ? 'Copied!' : 'Copy Secret' }}</button>
          <button class="btn btn-primary text-xs" @click="testAlert" :disabled="testing">{{ testing ? 'Testing…' : 'Test Alert' }}</button>
          <a v-if="expiringSoon && billingUrl" :href="billingUrl" target="_blank" class="btn btn-primary text-xs">Upgrade</a>
        </div>
      </div>
      <p v-if="testMsg" class="text-xs" :style="testMsg.startsWith('✅') ? 'color:#00D4AA' : 'color:#F59E0B'">{{ testMsg }}</p>
    </section>
  `
};
