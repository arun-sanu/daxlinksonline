export default {
  name: 'WorkflowDesigner',
  inheritAttrs: false,
  props: {
    dataflowNodes: {
      type: Array,
      default: () => []
    },
    selectedNodeId: {
      type: String,
      default: ''
    },
    selectedNode: {
      type: Object,
      default: null
    },
    workflowSummary: {
      type: Object,
      default: () => ({})
    },
    formatMetricLabel: {
      type: Function,
      default: (val) => val
    }
  },
  emits: ['select-node'],
  computed: {
    nodeMetrics() {
      return this.selectedNode ? Object.keys(this.selectedNode.metrics || {}) : [];
    }
  },
  template: `
    <section v-bind="$attrs" class="grid gap-10 section-pad xl:grid-cols-[1.5fr_1fr]">
      <div class="card-shell">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-2xl font-semibold text-main">Workflow Designer</h2>
            <p class="mt-2 text-sm muted-text">Model TradingView ingest through DaxLinks routing and into downstream exchanges. Adjust node constraints in-line.</p>
          </div>
          <button class="btn btn-secondary">Export Blueprint</button>
        </div>
        <div class="mt-8 space-y-8">
          <div class="flex flex-wrap items-center gap-6">
            <template v-for="(node, index) in dataflowNodes" :key="node.id">
              <button
                type="button"
                @click="$emit('select-node', node.id)"
                class="card-shell flex min-w-[220px] flex-1 flex-col gap-3 text-left transition"
                :style="selectedNodeId === node.id ? 'box-shadow: 0 0 30px var(--glow); border-color: rgba(18,152,230,0.55);' : ''"
              >
                <div class="flex items-center justify-between text-xs uppercase tracking-[0.3em]">
                  <span class="muted-text">{{ node.role }}</span>
                  <span class="muted-text">{{ node.environment }}</span>
                </div>
                <p class="text-lg font-semibold text-main">{{ node.label }}</p>
                <div class="grid gap-2 text-xs muted-text">
                  <div class="flex items-center justify-between">
                    <span>Bandwidth</span>
                    <span style="color: var(--primary);">{{ node.metrics.bandwidth }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span>Rate Limit</span>
                    <span style="color: var(--primary);">{{ node.metrics.rateLimit }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span>Latency</span>
                    <span style="color: var(--primary);">{{ node.metrics.latency }}</span>
                  </div>
                </div>
              </button>
              <div
                v-if="index < dataflowNodes.length - 1"
                class="hidden xl:block"
                style="height: 1px; flex: 1; min-width: 60px; background: linear-gradient(90deg, rgba(18,152,230,0.36), rgba(18,152,230,0.12), transparent);"
              ></div>
            </template>
          </div>
          <div class="grid gap-6 md:grid-cols-2">
            <div class="card-shell text-sm muted-text">
              <p class="section-label">Inbound Signals</p>
              <p class="mt-2 text-lg text-main">{{ workflowSummary.signalsPerMinute }} alerts/min</p>
              <p class="mt-2 text-xs muted-text">Configured to accept TradingView JSON payloads with signature verification &amp; throttle of {{ workflowSummary.signalThrottle }}.</p>
            </div>
            <div class="card-shell text-sm muted-text">
              <p class="section-label">Outbound Orders</p>
              <p class="mt-2 text-lg text-main">{{ workflowSummary.orderThroughput }} orders/min</p>
              <p class="mt-2 text-xs muted-text">Adaptive fan-out across {{ workflowSummary.connectedExchanges }} exchanges with failover path ready.</p>
            </div>
          </div>
        </div>
      </div>
      <div class="card-shell">
        <div v-if="selectedNode" class="space-y-5">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] muted-text">{{ selectedNode.role }}</p>
            <h3 class="mt-1 text-xl font-semibold text-main">{{ selectedNode.label }}</h3>
            <p class="mt-2 text-xs muted-text">{{ selectedNode.description }}</p>
          </div>
          <div class="space-y-3">
            <label
              v-for="metricKey in nodeMetrics"
              :key="metricKey"
              class="flex flex-col gap-2 text-xs muted-text"
            >
              {{ formatMetricLabel(metricKey) }}
              <input
                v-model="selectedNode.metrics[metricKey]"
                type="text"
                class="field"
              />
            </label>
          </div>
          <div class="card-shell text-xs muted-text">
            <p class="text-main">Connected To</p>
            <ul class="mt-2 space-y-1">
              <li v-for="target in selectedNode.connections" :key="target" style="color: var(--primary);">→ {{ target }}</li>
            </ul>
          </div>
          <label class="flex items-center gap-3 text-xs muted-text">
            <input
              type="checkbox"
              v-model="selectedNode.alerting"
              class="h-4 w-4"
              style="border: 1px solid var(--border); background: transparent; accent-color: var(--primary); border-radius: 6px;"
            />
            Enable anomaly alerts when latency exceeds tolerance.
          </label>
          <div class="flex flex-wrap items-center gap-3 text-xs muted-text">
            <button
              type="button"
              class="btn btn-primary"
              style="padding: 0.7rem 1.4rem;"
            >
              Persist Changes
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              style="padding: 0.7rem 1.4rem; border-color: rgba(255,0,0,0.25); color: rgba(255,255,255,0.7);"
            >
              Reset Node
            </button>
          </div>
        </div>
        <div v-else class="flex h-full flex-col items-center justify-center text-center text-sm muted-text">
          Select a node to adjust metrics.
        </div>
      </div>
    </section>
  `
};
