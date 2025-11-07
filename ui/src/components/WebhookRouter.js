export default {
  name: 'WebhookRouter',
  inheritAttrs: false,
  props: {
    webhooks: {
      type: Array,
      default: () => []
    },
    forms: {
      type: Object,
      default: () => ({ webhook: {} })
    },
    webhookEvents: {
      type: Array,
      default: () => []
    }
  },
  emits: ['save', 'toggle'],
  template: `
    <section v-bind="$attrs" class="grid gap-12 section-pad xl:grid-cols-[1.3fr_1fr]">
      <div class="space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-2xl font-semibold text-main">Webhook Router &amp; Event Dispatch</h2>
            <p class="mt-2 text-sm muted-text">Define inbound TradingView alerts and outbound notification targets. Monitor signatures, retries, and delivery health.</p>
          </div>
          <button class="btn btn-secondary">Import from JSON</button>
        </div>
        <div class="grid gap-6 md:grid-cols-2">
          <article
            v-for="hook in webhooks"
            :key="hook.id"
            class="card-shell flex flex-col gap-4"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm uppercase tracking-[0.3em] muted-text">{{ hook.method }}</p>
                <p class="mt-1 text-lg font-semibold text-main">{{ hook.name }}</p>
              </div>
              <button
                @click="$emit('toggle', hook)"
                class="rounded-full px-3 py-1 text-xs font-semibold transition"
                :style="hook.active ? 'background: rgba(52,211,153,0.18); color:#34D399;' : 'background: rgba(250,204,21,0.18); color:#FACC15;'"
              >
                {{ hook.active ? 'Active' : 'Paused' }}
              </button>
            </div>
            <p class="break-words text-xs muted-text">{{ hook.url }}</p>
            <div class="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] muted-text">
              <span
                v-for="event in hook.events"
                :key="event"
                class="rounded-full px-3 py-1"
                style="border: 1px solid var(--border); background: rgba(255,255,255,0.04);"
              >
                {{ event }}
              </span>
            </div>
            <div class="card-shell p-4 text-xs muted-text">
              <div class="flex items-center justify-between">
                <span>Last Delivery</span>
                <span style="color: var(--primary);">{{ hook.lastDelivery }}</span>
              </div>
              <div class="mt-2 flex items-center justify-between">
                <span>Signing Secret</span>
                <span>{{ hook.secret }}</span>
              </div>
            </div>
            <div class="flex items-center justify-between text-xs muted-text">
              <span>Retries: {{ hook.retries }}</span>
              <div class="flex gap-2">
                <button class="btn btn-secondary" style="padding: 0.6rem 1.1rem;">
                  Deliver Test
                </button>
                <button
                  class="btn btn-secondary"
                  style="padding: 0.6rem 1.1rem; border-color: rgba(255,0,0,0.25); color: rgba(255,255,255,0.65);"
                >
                  Remove
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
      <form class="card-shell space-y-5">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Create Webhook</h3>
          <span class="section-label" style="color: var(--primary);">Step 2 · Routing</span>
        </div>
        <label class="flex flex-col gap-2 text-sm muted-text">
          Name
          <input
            v-model="forms.webhook.name"
            type="text"
            placeholder="TradingView Alerts"
            class="field"
          />
        </label>
        <label class="flex flex-col gap-2 text-sm muted-text">
          URL
          <input
            v-model="forms.webhook.url"
            type="url"
            placeholder="https://daxlinks.online/api/webhooks/tradingview"
            class="field"
          />
        </label>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-2 text-sm muted-text">
            HTTP Method
            <select
              v-model="forms.webhook.method"
              class="field"
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
          <label class="flex flex-col gap-2 text-sm muted-text">
            Signing Secret
            <input
              v-model="forms.webhook.secret"
              type="text"
              placeholder="Auto-generate"
              class="field"
            />
          </label>
        </div>
        <label class="flex flex-col gap-2 text-sm muted-text">
          Event Triggers
          <select
            v-model="forms.webhook.event"
            class="field"
          >
            <option v-for="evt in webhookEvents" :key="evt" :value="evt">{{ evt }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-2 text-sm muted-text">
          Delivery Notes
          <textarea
            v-model="forms.webhook.notes"
            rows="3"
            placeholder="Throttle alerts to 30/min, append exchange symbol as query param..."
            class="field"
          ></textarea>
        </label>
        <label class="flex items-center gap-3 text-xs muted-text">
          <input
            type="checkbox"
            v-model="forms.webhook.storePayload"
            class="h-4 w-4"
            style="border: 1px solid var(--border); background: transparent; accent-color: var(--primary); border-radius: 6px;"
          />
          Retain payload samples for troubleshooting (encrypted at rest).
        </label>
        <div class="flex flex-wrap items-center gap-3 text-xs muted-text">
          <button
            type="button"
            @click="$emit('save')"
            class="btn btn-primary"
          >
            Save Webhook
          </button>
          <span>Optional: attach to Discord, Slack, or PagerDuty follow-up webhooks.</span>
        </div>
      </form>
    </section>
  `
};
