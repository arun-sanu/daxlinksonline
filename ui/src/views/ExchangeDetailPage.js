import { inject, computed, onMounted, reactive } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import * as apiClient from '../services/apiClient.js?v=20251106a';
import { applyInitialData } from '../stores/dashboardStore.js';

export default {
  name: 'ExchangeDetailPage',
  setup(_, { attrs }) {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const route = (typeof window !== 'undefined' && window.__appRouter__?.currentRoute?.value) || { params: {} };
    const exchangeId = computed(() => route.params.exchangeId || attrs?.exchangeId || '');

    const exchange = computed(() =>
      store.availableExchanges.find((e) => e.id === exchangeId.value) || null
    );

    const integrations = computed(() =>
      store.integrationProfiles.filter((p) => p.exchange === exchangeId.value)
    );

    const localForm = reactive({
      environment: 'paper',
      label: '',
      description: '',
      apiKey: '',
      apiSecret: '',
      passphrase: '',
      rateLimit: 5,
      bandwidth: '1.0 Mbps'
    });

    function resetForm() {
      localForm.environment = 'paper';
      localForm.label = '';
      localForm.description = '';
      localForm.apiKey = '';
      localForm.apiSecret = '';
      localForm.passphrase = '';
      localForm.rateLimit = 5;
      localForm.bandwidth = '1.0 Mbps';
    }

    async function refreshIntegrations() {
      try {
        await apiClient.fetchIntegrations();
        const data = await apiClient.fetchInitialData();
        if (data) applyInitialData(data);
      } catch {}
    }

    async function connect() {
      if (!exchange.value) return;
      if (!localForm.apiKey || !localForm.apiSecret) return;
      const payload = {
        exchange: exchange.value.id,
        environment: localForm.environment,
        label: localForm.label || undefined,
        description: localForm.description || undefined,
        apiKey: localForm.apiKey,
        apiSecret: localForm.apiSecret,
        passphrase: localForm.passphrase || undefined,
        rateLimit: localForm.rateLimit,
        bandwidth: localForm.bandwidth
      };
      try {
        await apiClient.createIntegration(payload);
        resetForm();
        await refreshIntegrations();
      } catch (err) {
        console.error('[ExchangeDetail] Failed to connect', err);
      }
    }

    async function rename(integration, nextLabel) {
      if (!integration?.id) return;
      try {
        await apiClient.updateIntegration(integration.id, { label: nextLabel });
        await refreshIntegrations();
      } catch (err) {
        console.error('[ExchangeDetail] Failed to rename integration', err);
      }
    }

    function addAnotherKey() {
      resetForm();
      try {
        const el = document.getElementById('connect-form');
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch {}
    }

    async function updateDescription(integration, nextDesc) {
      if (!integration?.id) return;
      try {
        await apiClient.updateIntegration(integration.id, { description: nextDesc });
        await refreshIntegrations();
      } catch (err) {
        console.error('[ExchangeDetail] Failed to update description', err);
      }
    }

    function goLogs() {
      const id = (exchangeId && exchangeId.value) || exchangeId;
      if (typeof window !== 'undefined' && window.__appRouter__) {
        window.__appRouter__.push({ name: 'exchange-logs', params: { exchangeId: id } });
      }
    }

    onMounted(async () => {
      // Ensure exchanges list available
      try {
        const exchanges = await apiClient.fetchAvailableExchanges();
        if (Array.isArray(exchanges) && exchanges.length) {
          store.availableExchanges = exchanges;
        }
      } catch {}
    });

      return {
        store,
        exchangeId,
        exchange,
        integrations,
        localForm,
        resetForm,
        connect,
        rename,
        updateDescription,
        addAnotherKey,
        goLogs
      };
    },
    template: `
      <main class="layout-container section-pad space-y-8">
        <div class="flex items-center justify-between relative">
          <div>
            <p class="text-xs uppercase tracking-[0.28em] muted-text">Exchange</p>
            <h2 class="text-2xl font-semibold text-main">{{ exchange?.name || exchangeId }}</h2>
            <p class="mt-1 text-sm muted-text">{{ exchange?.tagline }}</p>
          </div>
          <button
            type="button"
            class="rounded-md border border-white/10 bg-white/10 px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] hover:border-primary-500/30 hover:text-primary-100 shadow-sm"
            @click="goLogs"
          >
            Logs
          </button>
        </div>

      <section class="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <form
          id="connect-form"
          class="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-6"
          @submit.prevent="connect"
          autocomplete="off"
          spellcheck="false"
          novalidate
        >
          <!-- Autofill decoys to prevent browsers from injecting email/password -->
          <input type="text" style="display:none" tabindex="-1" aria-hidden="true" autocomplete="off" />
          <input type="password" style="display:none" tabindex="-1" aria-hidden="true" autocomplete="new-password" />
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.28em] muted-text">Connect</p>
              <h4 class="text-lg font-semibold text-main">{{ exchange?.name || exchangeId }}</h4>
            </div>
            <span class="text-xs muted-text">Typical latency • {{ exchange?.latency || '—' }}</span>
          </div>

          <div class="flex flex-wrap gap-3">
            <button
              v-for="env in ['paper', 'live']"
              :key="env"
              type="button"
              class="rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] transition"
              :aria-pressed="localForm.environment === env"
              :class="localForm.environment === env
                ? 'border-primary-500/50 bg-primary-500/15 text-primary-100 shadow-[0_0_12px_rgba(107,107,247,0.25)]'
                : 'border-white/10 text-gray-400 hover:border-primary-500/30 hover:text-primary-100'"
              @click="localForm.environment = env"
            >
              {{ env }}
            </button>
          </div>

          <label class="flex flex-col gap-2 text-xs muted-text">
            Name (optional)
            <input v-model="localForm.label" type="text" placeholder="Key name (e.g. Trading Bot #1)" class="field" />
          </label>
          <label class="flex flex-col gap-2 text-xs muted-text">
            Description (optional)
            <textarea v-model="localForm.description" rows="2" placeholder="Notes about this key (scope, purpose, owner)" class="field"></textarea>
          </label>

          <label class="flex flex-col gap-2 text-xs muted-text">
            API Key
            <input
              v-model="localForm.apiKey"
              type="password"
              placeholder="•••••••••••"
              class="field"
              inputmode="text"
              autocomplete="new-password"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              aria-label="API key"
            />
          </label>
          <label class="flex flex-col gap-2 text-xs muted-text">
            Secret
            <input
              v-model="localForm.apiSecret"
              type="password"
              placeholder="•••••••••••"
              class="field"
              inputmode="text"
              autocomplete="new-password"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              aria-label="API secret"
            />
          </label>
          <label v-if="exchange?.requiresPassphrase" class="flex flex-col gap-2 text-xs muted-text">
            Passphrase
            <input
              v-model="localForm.passphrase"
              type="password"
              placeholder="Exchange passphrase"
              class="field"
              inputmode="text"
              autocomplete="new-password"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              aria-label="Exchange passphrase"
            />
          </label>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-xs muted-text">
              Rate Limit (req/s)
              <input v-model.number="localForm.rateLimit" type="number" min="1" class="field" />
            </label>
            <label class="flex flex-col gap-2 text-xs muted-text">
              Bandwidth Allocation
              <input v-model="localForm.bandwidth" type="text" placeholder="1.0 Mbps" class="field" />
            </label>
          </div>
          <button type="submit" class="btn btn-primary text-xs tracking-[0.22em]">Connect Exchange</button>
        </form>

        <aside class="space-y-6">
          <div class="card-shell space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-main">Connected keys</h3>
              <button
                type="button"
                class="rounded-full border border-white/10 px-3 py-1 text-[11px] muted-text hover:border-primary-500/30 hover:text-primary-100"
                @click="addAnotherKey"
              >
                Add another key
              </button>
            </div>
            <ul class="space-y-3 text-xs muted-text">
              <li v-if="integrations.length === 0" class="rounded-xl border border-white/5 bg-white/5 px-4 py-6 text-center text-xs">
                No API keys linked yet for this exchange.
              </li>
              <li v-for="i in integrations" :key="i.id" class="rounded-xl border border-white/5 bg-white/5 px-4 py-3 space-y-3">
                <div class="flex items-center justify-between">
                  <input
                    :value="i.label || i.name"
                    @change="rename(i, $event.target.value)"
                    class="field !py-1 !px-2 !text-xs !h-7"
                  />
                  <button type="button" class="btn btn-secondary text-[11px]" @click="window.__appRouter__?.push({ name: 'integrations' })">Manage</button>
                </div>
                <label class="flex flex-col gap-1 text-[11px] muted-text">
                  Description
                  <input :value="i.description || ''" @change="updateDescription(i, $event.target.value)" class="field !py-1 !px-2 !text-[11px] !h-7" placeholder="Optional notes" />
                </label>
                <div class="flex items-center justify-between text-[11px]">
                  <span>Env: {{ i.environment }}</span>
                  <span :style="i.connected ? 'color:#34D399' : 'color:#FACC15'">{{ i.connected ? 'Active' : 'Pending' }}</span>
                </div>
              </li>
            </ul>
          </div>
        </aside>
      </section>
    </main>
  `
};
