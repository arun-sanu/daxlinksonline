import { ref, computed, onMounted, onBeforeUnmount } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { getConfig } from '../services/config.js';

const STATUS_OPTIONS = ['received', 'validated', 'executed', 'failed', 'rejected'];
const WEBHOOK_POLL_MS = 10000;
const CONNECTIVITY_POLL_MS = 15000;

function resolveBaseUrl() {
  const cfg = getConfig();
  const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
  return base || '';
}

function resolveWorkspaceId(cfg = getConfig()) {
  if (cfg.workspaceId) return String(cfg.workspaceId);
  try {
    const runtime = typeof window !== 'undefined' ? (window.__DAXLINKS_CONFIG__ || {}).workspaceId : null;
    if (runtime) return String(runtime);
    const stored = typeof window !== 'undefined' ? window.localStorage?.getItem('workspaceId') : null;
    if (stored) return String(stored);
  } catch {}
  throw new Error('Workspace ID missing. Please sign in again.');
}

function authHeaders() {
  const token = (typeof window !== 'undefined' && (window.__appAuthToken__ || window.localStorage?.getItem('daxlinksToken') || window.localStorage?.getItem('authToken'))) || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeAlert(row = {}) {
  const payload = row.sanitizedPayload || row.payload || row.rawPayload || row.body || null;
  const parsedPayload = (() => {
    if (!payload) return null;
    if (typeof payload === 'string') {
      try { return JSON.parse(payload); } catch { return payload; }
    }
    return payload;
  })();
  return {
    id: row.id || `${row.receivedAt || row.createdAt || row.ts || Date.now()}-${row.userId || row.symbol || ''}`,
    receivedAt: row.receivedAt || row.createdAt || row.ts || row.timestamp || null,
    status: row.status || 'received',
    strategyName: row.strategyName || row.strategy || row.ruleName || '',
    symbol: row.symbol || row.ticker || '',
    side: row.side || row.direction || '',
    orderType: row.orderType || row.type || '',
    quantity: row.quantity ?? row.qty ?? '',
    takeProfit: row.takeProfit ?? row.tp ?? '',
    stopLoss: row.stopLoss ?? row.sl ?? '',
    errorMessage: row.errorMessage || row.error || '',
    userId: row.userId || row.user || '',
    webhookSubdomain: row.webhookSubdomain || row.subdomain || '',
    clientIp: row.clientIp || row.ip || '',
    payload: parsedPayload
  };
}

function normalizeWebhook(row = {}) {
  return {
    id: row.id || row.webhookId || row._id || '',
    name: row.name || row.label || row.description || row.url || 'Webhook',
    url: row.url || '',
    events: row.events || row.event || [],
    active: row.active ?? row.enabled ?? true,
    createdAt: row.createdAt || row.ts || null
  };
}

export default {
  name: 'MonitoringPage',
  setup() {
    const alerts = ref([]);
    const loading = ref(false);
    const error = ref('');
    const status = ref('');
    const q = ref('');
    const userId = ref('');
    const page = ref(1);
    const pageSize = ref(20);
    const total = ref(0);
    const selectedAlert = ref(null);
    const webhooks = ref([]);
    const webhooksLoading = ref(false);
    const webhooksError = ref('');
    const webhookDeliveries = ref([]);
    const webhookDeliveriesLoading = ref(false);
    const webhookDeliveriesError = ref('');
    const metrics = ref(null);
    const metricsLoading = ref(false);
    const metricsError = ref('');
    const connectivity = ref(null);
    const connectivityLoading = ref(false);
    const connectivityError = ref('');
    const connectivityUpdatedAt = ref(null);

    const config = getConfig();
    const baseUrl = resolveBaseUrl();
    const apiPrefix = baseUrl || '/api/v1';
    let workspaceId = '';
    let workspaceError = '';
    try {
      workspaceId = resolveWorkspaceId(config);
    } catch (err) {
      workspaceError = err?.message || 'Workspace ID missing.';
    }
    const alertsEndpoint = `${apiPrefix}/users/alerts`;
    const webhooksEndpoint = workspaceId ? `${apiPrefix}/webhooks/${encodeURIComponent(workspaceId)}` : '';
    const deliveriesEndpoint = `${apiPrefix}/admin/deliveries`;
    const metricsEndpoint = `${apiPrefix}/metrics/monitoring`;
    const connectivityEndpoint = `${apiPrefix}/metrics/connectivity?windowMinutes=15`;

    const statusPalette = {
      ok: '#34d399',
      degraded: '#fbbf24',
      down: '#f87171',
      unknown: '#9ca3af'
    };

    async function loadAlerts() {
      loading.value = true;
      error.value = '';
      try {
        const params = new URLSearchParams({ limit: String(pageSize.value) });
        if (status.value) params.set('status', status.value);
        if (q.value.trim()) params.set('q', q.value.trim());
        if (userId.value.trim()) params.set('userId', userId.value.trim());
        const res = await fetch(`${alertsEndpoint}?${params.toString()}`, {
          headers: { ...authHeaders() },
          credentials: 'include'
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        const rows = Array.isArray(data?.items) ? data.items.map(normalizeAlert) : [];
        alerts.value = rows;
        total.value = data?.total || rows.length || 0;
        if (data?.page) page.value = data.page;
        if (data?.pageSize) pageSize.value = data.pageSize;
      } catch (e) {
        error.value = e?.message || 'Failed to load alerts.';
        alerts.value = [];
      } finally {
        loading.value = false;
      }
    }

    async function loadWebhooks() {
      webhooksLoading.value = true;
      webhooksError.value = '';
      try {
        if (!webhooksEndpoint) {
          throw new Error(workspaceError || 'Workspace ID missing.');
        }
        const res = await fetch(webhooksEndpoint, {
          headers: { ...authHeaders() },
          credentials: 'include'
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        webhooks.value = Array.isArray(data) ? data.map(normalizeWebhook) : [];
      } catch (e) {
        webhooksError.value = e?.message || 'Failed to load webhooks.';
        webhooks.value = [];
      } finally {
        webhooksLoading.value = false;
      }
    }

    async function loadWebhookDeliveries() {
      webhookDeliveriesLoading.value = true;
      webhookDeliveriesError.value = '';
      try {
        if (!workspaceId) {
          throw new Error(workspaceError || 'Workspace ID missing.');
        }
        const params = new URLSearchParams({ page: '1', pageSize: '50', sortKey: 'createdAt', sortDir: 'desc' });
        if (workspaceId) params.set('workspaceId', workspaceId);
        const res = await fetch(`${deliveriesEndpoint}?${params.toString()}`, {
          headers: { ...authHeaders() },
          credentials: 'include'
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        webhookDeliveries.value = Array.isArray(data?.rows) ? data.rows : [];
      } catch (e) {
        webhookDeliveriesError.value = e?.message || 'Failed to load webhook deliveries.';
        webhookDeliveries.value = [];
      } finally {
        webhookDeliveriesLoading.value = false;
      }
    }

    async function refreshWebhooks() {
      await Promise.all([loadWebhooks(), loadWebhookDeliveries()]);
    }

    async function loadMetrics() {
      metricsLoading.value = true;
      metricsError.value = '';
      try {
        const res = await fetch(metricsEndpoint, {
          headers: { ...authHeaders() },
          credentials: 'include'
        });
        if (!res.ok) throw new Error(await res.text());
        metrics.value = await res.json();
      } catch (e) {
        metricsError.value = e?.message || 'Failed to load monitoring metrics.';
        metrics.value = null;
      } finally {
        metricsLoading.value = false;
      }
    }

    async function loadConnectivity() {
      connectivityLoading.value = true;
      connectivityError.value = '';
      try {
        const res = await fetch(connectivityEndpoint, {
          headers: { ...authHeaders() },
          credentials: 'include'
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!data?.ok) throw new Error('Connectivity unavailable');
        connectivity.value = data;
        connectivityUpdatedAt.value = new Date();
      } catch (e) {
        connectivityError.value = e?.message || 'Connectivity unavailable.';
        connectivity.value = null;
      } finally {
        connectivityLoading.value = false;
      }
    }

    function applyFilters() {
      page.value = 1;
      loadAlerts();
    }

    function nextPage() {
      if (page.value * pageSize.value >= total.value) return;
      page.value += 1;
      loadAlerts();
    }

    function prevPage() {
      if (page.value <= 1) return;
      page.value -= 1;
      loadAlerts();
    }

    function statusColor(s) {
      const key = String(s || '').toLowerCase();
      if (key === 'failed' || key === 'rejected') return '#f87171';
      if (key === 'executed') return '#34d399';
      if (key === 'validated') return '#60a5fa';
      return '#fbbf24';
    }

    function formatTime(ts) {
      if (!ts) return '—';
      try {
        return new Date(ts).toLocaleString();
      } catch {
        return ts;
      }
    }

    function statusBadgeColor(statusValue) {
      const key = String(statusValue || '').toLowerCase();
      if (key === 'failed' || key === 'rejected' || key === 'error') return '#f87171';
      if (key === 'executed' || key === 'sent' || key === 'success') return '#34d399';
      if (key === 'validated') return '#60a5fa';
      return '#fbbf24';
    }

    function connectivityTone(statusValue) {
      const key = String(statusValue || 'unknown').toLowerCase();
      return statusPalette[key] || statusPalette.unknown;
    }

    const nodeLayout = computed(() => {
      const nodes = connectivity.value?.nodes || [];
      const cols = 4;
      const gapX = 220;
      const gapY = 120;
      const startX = 80;
      const startY = 80;
      const mapped = nodes.map((node, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return {
          ...node,
          x: startX + col * gapX,
          y: startY + row * gapY
        };
      });
      const map = new Map(mapped.map((node) => [node.id, node]));
      return { nodes: mapped, map };
    });

    const linkLayout = computed(() => {
      const links = connectivity.value?.links || [];
      const { map } = nodeLayout.value;
      return links
        .map((link) => {
          const from = map.get(link.from);
          const to = map.get(link.to);
          if (!from || !to) return null;
          const path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
          return {
            ...link,
            from,
            to,
            path,
            tone: connectivityTone(link.status)
          };
        })
        .filter(Boolean);
    });

    const pageStart = computed(() => {
      if (!total.value) return 0;
      return (page.value - 1) * pageSize.value + 1;
    });
    const pageEnd = computed(() => Math.min(page.value * pageSize.value, total.value || alerts.value.length));

    const selectedPayload = computed(() => {
      if (!selectedAlert.value) return null;
      const p = selectedAlert.value.payload;
      if (!p) return null;
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p, null, 2);
      } catch {
        return String(p);
      }
    });

    function openAlert(alert) {
      if (!alert?.payload) return;
      selectedAlert.value = alert;
    }
    function closeModal() {
      selectedAlert.value = null;
    }

    const latestDeliveryByWebhook = computed(() => {
      const map = {};
      for (const d of webhookDeliveries.value) {
        const id = d.webhookId || d.webhook_id || d.id || d.webhook?.id;
        if (!id) continue;
        if (!map[id]) map[id] = d;
      }
      return map;
    });

    let pollHandle = { main: null, connectivity: null };

    async function refreshAll() {
      await Promise.all([loadAlerts(), refreshWebhooks(), loadMetrics()]);
    }

    onMounted(() => {
      refreshAll();
      pollHandle.main = setInterval(refreshAll, WEBHOOK_POLL_MS);
      loadConnectivity();
      pollHandle.connectivity = setInterval(loadConnectivity, CONNECTIVITY_POLL_MS);
    });
    onBeforeUnmount(() => {
      if (pollHandle.main) clearInterval(pollHandle.main);
      if (pollHandle.connectivity) clearInterval(pollHandle.connectivity);
    });

    const pollIntervalMs = WEBHOOK_POLL_MS;

    return {
      alerts,
      loading,
      error,
      status,
      q,
      userId,
      page,
      pageSize,
      total,
      STATUS_OPTIONS,
      applyFilters,
      nextPage,
      prevPage,
      formatTime,
      statusColor,
      pageStart,
      pageEnd,
      loadAlerts,
      loadWebhooks,
      loadMetrics,
      loadConnectivity,
      openAlert,
      closeModal,
      selectedAlert,
      selectedPayload,
      webhooks,
      webhooksLoading,
      webhooksError,
      webhookDeliveries,
      webhookDeliveriesLoading,
      webhookDeliveriesError,
      latestDeliveryByWebhook,
      refreshWebhooks,
      statusBadgeColor,
      pollIntervalMs,
      metrics,
      metricsLoading,
      metricsError,
      connectivity,
      connectivityLoading,
      connectivityError,
      connectivityUpdatedAt,
      nodeLayout,
      linkLayout,
      connectivityTone
    };
  },
  template: `
    <main class="layout-container section-pad space-y-8">
      <div class="card-shell space-y-3 text-center">
        <p class="text-xs uppercase tracking-[0.32em] text-primary-200">Monitoring</p>
        <h1 class="text-3xl font-light text-main">Telemetry + TradingView alert intake</h1>
        <p class="text-sm text-gray-400">Credential events, webhook analytics, and alert routing surface here with live TradingView signal visibility.</p>
      </div>

      <section class="card-shell space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Ingress URLs</p>
            <p class="text-sm muted-text">Active webhook endpoints configured for this workspace.</p>
          </div>
          <button class="btn btn-secondary btn-small" type="button" :disabled="webhooksLoading" @click="loadWebhooks">
            {{ webhooksLoading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <p v-if="webhooksError" class="text-sm text-rose-400">{{ webhooksError }}</p>
        <div class="space-y-2">
          <div
            v-for="wh in webhooks"
            :key="wh.id"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div class="min-w-0">
              <p class="text-xs uppercase tracking-[0.24em] text-gray-400">{{ wh.name || 'Webhook' }}</p>
              <p class="text-sm text-main break-all">{{ wh.url || '—' }}</p>
            </div>
            <span
              class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]"
              :style="{ color: wh.active ? '#34d399' : '#f87171', background: (wh.active ? '#34d399' : '#f87171') + '20' }"
            >
              <span class="h-2 w-2 rounded-full" :style="{ background: wh.active ? '#34d399' : '#f87171' }"></span>
              {{ wh.active ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div v-if="!webhooksLoading && webhooks.length === 0" class="text-sm text-gray-400">No ingress URLs configured yet.</div>
        </div>
      </section>

      <section class="card-shell space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Webhook Traffic</p>
            <p class="text-sm muted-text">Live throughput and delivery volume.</p>
          </div>
          <button class="btn btn-secondary btn-small" type="button" :disabled="metricsLoading" @click="loadMetrics">
            {{ metricsLoading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <p v-if="metricsError" class="text-sm text-rose-400">{{ metricsError }}</p>
        <div class="grid gap-4 md:grid-cols-3">
          <div class="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.24em] text-gray-400">Alerts / hour</p>
            <p class="text-2xl text-main">{{ metrics ? Math.round((metrics.throughputPerMin || 0) * 60) : '—' }}</p>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.24em] text-gray-400">Webhook deliveries</p>
            <p class="text-2xl text-main">{{ webhookDeliveries.length }}</p>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p class="text-xs uppercase tracking-[0.24em] text-gray-400">Queue depth</p>
            <p class="text-2xl text-main">{{ metrics ? metrics.queueDepth : '—' }}</p>
          </div>
        </div>
      </section>

      <section class="card-shell space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Connectivity Map</p>
            <p class="text-sm muted-text">Live metro view of signal flow and link health.</p>
          </div>
          <button class="btn btn-secondary btn-small" type="button" :disabled="connectivityLoading" @click="loadConnectivity">
            {{ connectivityLoading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <p v-if="connectivityError" class="text-sm text-rose-400">{{ connectivityError }}</p>
        <div v-if="!connectivity && !connectivityLoading" class="text-sm text-gray-400">Connectivity unavailable.</div>
        <div v-else class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
          <div class="connectivity-shell">
            <svg v-if="connectivity" class="connectivity-svg" viewBox="0 0 900 520" aria-label="Connectivity diagram">
              <g v-for="(link, idx) in linkLayout" :key="link.id || idx">
                <path
                  class="connectivity-link"
                  :d="link.path"
                  :stroke="link.tone"
                  stroke-width="5"
                  fill="none"
                />
                <circle class="connectivity-pulse" r="6" :fill="link.tone">
                  <animateMotion :dur="'2.4s'" :begin="(idx * 0.4) + 's'" repeatCount="indefinite" :path="link.path" />
                </circle>
              </g>
              <g v-for="node in nodeLayout.nodes" :key="node.id">
                <circle
                  class="connectivity-node"
                  :cx="node.x"
                  :cy="node.y"
                  r="16"
                  :fill="connectivityTone(node.status)"
                />
                <text class="connectivity-label" :x="node.x + 26" :y="node.y + 4">{{ node.label || node.id }}</text>
              </g>
            </svg>
          </div>
          <aside class="connectivity-panel">
            <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Link details</p>
            <p class="text-xs text-gray-400">Last update: {{ connectivityUpdatedAt ? connectivityUpdatedAt.toLocaleTimeString() : '—' }}</p>
            <div class="mt-3 space-y-3">
              <div
                v-for="(link, idx) in linkLayout"
                :key="'panel-' + (link.id || idx)"
                class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200"
              >
                <div class="flex items-center justify-between gap-2">
                  <span>{{ link.from?.label || link.from?.id }} → {{ link.to?.label || link.to?.id }}</span>
                  <span class="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]" :style="{ color: link.tone }">
                    <span class="h-2 w-2 rounded-full" :style="{ background: link.tone }"></span>
                    {{ link.status || 'unknown' }}
                  </span>
                </div>
                <p v-if="link.alertsLastWindow != null" class="text-xs text-gray-400">Alerts (window): {{ link.alertsLastWindow }}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section class="card-shell space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Recent Alerts</p>
            <p class="text-sm muted-text">Incoming webhook alerts with validation, routing outcomes, and execution feedback.</p>
          </div>
          <div class="flex items-center gap-3 text-xs text-gray-400">
            <span v-if="!loading && total">Showing {{ pageStart }}–{{ pageEnd }} of {{ total }}</span>
            <button class="btn btn-secondary btn-small" type="button" :disabled="loading" @click="loadAlerts">
              {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
          </div>
        </div>

        <div class="grid gap-2 md:grid-cols-4">
          <select v-model="status" class="field">
            <option value="">All statuses</option>
            <option v-for="opt in STATUS_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
          </select>
          <input v-model="q" class="field md:col-span-2" placeholder="Search strategy, symbol, side, or error" />
          <input v-model="userId" class="field" placeholder="User ID (optional)" />
          <div class="md:col-span-4 flex items-center justify-end gap-2">
            <button class="btn btn-secondary btn-small" type="button" :disabled="loading" @click="applyFilters">Apply filters</button>
          </div>
        </div>

        <p v-if="error" class="text-sm text-rose-400">{{ error }}</p>

        <div class="overflow-x-auto rounded-xl border border-white/10">
          <table class="min-w-full text-sm">
            <thead class="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th class="px-3 py-2 text-left">Time</th>
                <th class="px-3 py-2 text-left">User</th>
                <th class="px-3 py-2 text-left">Strategy</th>
                <th class="px-3 py-2 text-left">Symbol</th>
                <th class="px-3 py-2 text-left">Side</th>
                <th class="px-3 py-2 text-left">Type</th>
                <th class="px-3 py-2 text-left">Qty</th>
                <th class="px-3 py-2 text-left">TP</th>
                <th class="px-3 py-2 text-left">SL</th>
                <th class="px-3 py-2 text-left">Status</th>
                <th class="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="alert in alerts"
                :key="alert.id"
                class="border-t border-white/5 transition"
                :class="alert.payload ? 'hover:bg-white/5 cursor-pointer' : ''"
                @click="openAlert(alert)"
              >
                <td class="px-3 py-2 whitespace-nowrap text-xs text-gray-300">{{ formatTime(alert.receivedAt) }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ alert.userId || '—' }}</td>
                <td class="px-3 py-2 text-xs text-main">{{ alert.strategyName || '—' }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ alert.symbol || '—' }}</td>
                <td class="px-3 py-2 text-xs uppercase text-gray-200">{{ alert.side || '—' }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ alert.orderType || '—' }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ alert.quantity !== undefined && alert.quantity !== null && alert.quantity !== '' ? alert.quantity : '—' }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ alert.takeProfit !== undefined && alert.takeProfit !== null && alert.takeProfit !== '' ? alert.takeProfit : '—' }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ alert.stopLoss !== undefined && alert.stopLoss !== null && alert.stopLoss !== '' ? alert.stopLoss : '—' }}</td>
                <td class="px-3 py-2 text-xs">
                  <span class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-main" :style="{ background: statusColor(alert.status) + '20' }">
                    <span class="h-2 w-2 rounded-full" :style="{ background: statusColor(alert.status) }"></span>
                    {{ alert.status }}
                  </span>
                </td>
                <td class="px-3 py-2 text-xs text-rose-200">{{ alert.errorMessage || '—' }}</td>
              </tr>
              <tr v-if="loading">
                <td colspan="11" class="px-3 py-6 text-center text-sm text-gray-400">Loading alerts…</td>
              </tr>
              <tr v-else-if="alerts.length === 0">
                <td colspan="11" class="px-3 py-6 text-center text-sm text-gray-400">No alerts yet.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <span>Page {{ page }} · Page size {{ pageSize }} · Total {{ total }}</span>
          <div class="flex items-center gap-2">
            <button class="btn btn-secondary btn-small" type="button" :disabled="page<=1 || loading" @click="prevPage">Prev</button>
            <button class="btn btn-secondary btn-small" type="button" :disabled="page*pageSize>=total || loading" @click="nextPage">Next</button>
          </div>
        </div>
      </section>

      <section class="card-shell space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Webhook Connectivity</p>
            <p class="text-sm muted-text">Active webhook endpoints with latest delivery health and response codes.</p>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <span>Auto-refresh every {{ pollIntervalMs / 1000 }}s</span>
            <button class="btn btn-secondary btn-small" type="button" :disabled="webhooksLoading || webhookDeliveriesLoading" @click="refreshWebhooks">
              {{ webhooksLoading || webhookDeliveriesLoading ? 'Refreshing…' : 'Refresh now' }}
            </button>
          </div>
        </div>

        <p v-if="webhooksError" class="text-sm text-rose-400">{{ webhooksError }}</p>

        <div class="overflow-x-auto rounded-xl border border-white/10">
          <table class="min-w-full text-sm">
            <thead class="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th class="px-3 py-2 text-left">Webhook</th>
                <th class="px-3 py-2 text-left">Status</th>
                <th class="px-3 py-2 text-left">Events</th>
                <th class="px-3 py-2 text-left">Last code</th>
                <th class="px-3 py-2 text-left">Latency</th>
                <th class="px-3 py-2 text-left">Last attempt</th>
                <th class="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="webhooksLoading">
                <td colspan="7" class="px-3 py-4 text-center text-sm text-gray-400">Loading webhooks…</td>
              </tr>
              <tr v-else-if="webhooks.length === 0">
                <td colspan="7" class="px-3 py-4 text-center text-sm text-gray-400">No webhooks configured.</td>
              </tr>
              <tr v-for="wh in webhooks" :key="wh.id" class="border-t border-white/5">
                <td class="px-3 py-2">
                  <p class="text-sm text-main">{{ wh.name }}</p>
                  <p class="text-[11px] text-gray-400 break-all">{{ wh.url }}</p>
                </td>
                <td class="px-3 py-2 text-xs">
                  <span class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-main" :style="{ background: statusBadgeColor(wh.active ? 'executed' : 'rejected') + '20' }">
                    <span class="h-2 w-2 rounded-full" :style="{ background: statusBadgeColor(wh.active ? 'executed' : 'rejected') }"></span>
                    {{ wh.active ? 'Active' : 'Paused' }}
                  </span>
                </td>
                <td class="px-3 py-2 text-xs text-gray-200">{{ Array.isArray(wh.events) && wh.events.length ? wh.events.join(', ') : '—' }}</td>
                <td class="px-3 py-2 text-xs text-gray-200">
                  <template v-if="latestDeliveryByWebhook[wh.id]">
                    {{ latestDeliveryByWebhook[wh.id].responseCode || '—' }}
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="px-3 py-2 text-xs text-gray-200">
                  <template v-if="latestDeliveryByWebhook[wh.id]">
                    {{ latestDeliveryByWebhook[wh.id].responseTimeMs ?? '—' }} ms
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="px-3 py-2 text-xs text-gray-200">
                  <template v-if="latestDeliveryByWebhook[wh.id]">
                    {{ formatTime(latestDeliveryByWebhook[wh.id].createdAt) }}
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="px-3 py-2 text-xs text-rose-200 truncate max-w-[260px]" :title="latestDeliveryByWebhook[wh.id]?.lastError">
                  <template v-if="latestDeliveryByWebhook[wh.id]">
                    {{ latestDeliveryByWebhook[wh.id].lastError || '—' }}
                  </template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="space-y-2">
          <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Recent Deliveries</p>
          <p v-if="webhookDeliveriesError" class="text-sm text-rose-400">{{ webhookDeliveriesError }}</p>
          <div class="overflow-x-auto rounded-xl border border-white/10">
            <table class="min-w-full text-sm">
              <thead class="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
                <tr>
                  <th class="px-3 py-2 text-left">When</th>
                  <th class="px-3 py-2 text-left">Webhook</th>
                  <th class="px-3 py-2 text-left">Status</th>
                  <th class="px-3 py-2 text-left">Code</th>
                  <th class="px-3 py-2 text-left">Time (ms)</th>
                  <th class="px-3 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="webhookDeliveriesLoading">
                  <td colspan="6" class="px-3 py-4 text-center text-sm text-gray-400">Loading deliveries…</td>
                </tr>
                <tr v-else-if="webhookDeliveries.length === 0">
                  <td colspan="6" class="px-3 py-4 text-center text-sm text-gray-400">No webhook deliveries yet.</td>
                </tr>
                <tr v-for="d in webhookDeliveries" :key="d.id" class="border-t border-white/5">
                  <td class="px-3 py-2 text-xs text-gray-200 whitespace-nowrap">{{ formatTime(d.createdAt) }}</td>
                  <td class="px-3 py-2 text-xs text-gray-200">{{ d.webhookName || d.webhook?.name || d.webhookId || 'Webhook' }}</td>
                  <td class="px-3 py-2 text-xs">
                    <span class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-main" :style="{ background: statusBadgeColor(d.status) + '20' }">
                      <span class="h-2 w-2 rounded-full" :style="{ background: statusBadgeColor(d.status) }"></span>
                      {{ d.status }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-xs text-gray-200">{{ d.responseCode || '—' }}</td>
                  <td class="px-3 py-2 text-xs text-gray-200">{{ d.responseTimeMs ?? '—' }}</td>
                  <td class="px-3 py-2 text-xs text-rose-200 truncate max-w-[320px]" :title="d.lastError">{{ d.lastError || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div
        v-if="selectedAlert"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b1022] p-4 shadow-xl">
          <header class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.28em] text-gray-500">Payload</p>
              <p class="text-sm text-main">TradingView alert · {{ selectedAlert.strategyName || selectedAlert.symbol || 'Signal' }}</p>
            </div>
            <button class="btn btn-secondary btn-small" type="button" @click="closeModal">Close</button>
          </header>
          <div class="mt-3 rounded-xl bg-black/40 p-3 text-left text-xs text-gray-100 overflow-auto max-h-[60vh]">
            <pre class="whitespace-pre-wrap leading-relaxed">{{ selectedPayload || 'No payload available.' }}</pre>
          </div>
        </div>
      </div>
    </main>
  `
};
