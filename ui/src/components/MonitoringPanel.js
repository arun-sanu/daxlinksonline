export default {
  name: 'MonitoringPanel',
  inheritAttrs: false,
  props: {
    insights: {
      type: Object,
      default: () => ({})
    },
    insightsView: {
      type: String,
      default: 'rest'
    },
    currentInsight: {
      type: Object,
      default: () => ({ takeaways: [], stats: [] })
    }
  },
  emits: ['change-view'],
  template: `
    <section v-bind="$attrs" class="card-shell">
      <div class="flex flex-col gap-10 lg:flex-row lg:items-start">
        <div class="flex-1">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-2xl font-semibold text-main">Monitoring &amp; Thresholds</h2>
            <div class="inline-flex rounded-lg" style="border: 1px solid var(--border); background: rgba(255,255,255,0.03); padding: 0.3rem;">
              <button
                v-for="view in Object.keys(insights)"
                :key="view"
                @click="$emit('change-view', view)"
                class="rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition"
                :style="insightsView === view ? 'background: rgba(18,152,230,0.28); color: var(--text-main);' : 'color: var(--text-muted);'"
              >
                {{ insights[view].label }}
              </button>
            </div>
          </div>
          <p class="mt-4 text-sm muted-text">
            Compare how REST and WebSocket pipelines behave in production. Toggle views to monitor latency, retries, and usage caps.
          </p>
          <ul class="mt-6 space-y-4 text-sm muted-text">
            <li
              v-for="bullet in currentInsight.takeaways"
              :key="bullet"
              class="card-shell flex gap-3"
            >
              <span class="mt-1 h-2 w-2 rounded-full" style="background: var(--primary);"></span>
              <span>{{ bullet }}</span>
            </li>
          </ul>
        </div>
        <div class="flex-1 card-shell">
          <h3 class="text-sm font-semibold uppercase tracking-[0.3em] muted-text">{{ currentInsight.label }}</h3>
          <div class="mt-6 grid gap-4 sm:grid-cols-2">
            <div
              v-for="stat in currentInsight.stats"
              :key="stat.label"
              class="card-shell"
            >
              <p class="text-xs uppercase tracking-[0.25em] muted-text">{{ stat.label }}</p>
              <p class="mt-3 text-2xl font-semibold text-main">{{ stat.value }}</p>
              <p class="mt-1 text-xs muted-text">{{ stat.caption }}</p>
            </div>
          </div>
          <div class="mt-6 card-shell text-xs muted-text">
            {{ currentInsight.helper }}
          </div>
        </div>
      </div>
    </section>
  `
};
