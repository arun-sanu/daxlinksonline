import { inject, ref, onMounted, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { listWebhooks, toggleWebhook } from '../services/apiClient.js?v=20251105h';

export default {
  name: 'WebhooksAdmin',
  setup() {
    const store = inject('dashboardStore');
    const items = ref([]);
    const loading = ref(false);
    const error = ref('');
    const selected = ref(null);
    const deliveries = ref([]);
    const deliveriesPage = ref(1);
    const deliveriesTotal = ref(0);
    const deliveriesPageSize = ref(20);
    const loadingDeliveries = ref(false);
    const deliveryDetail = ref(null);
    const showConfirm = ref(false);
    const confirmAction = ref('');
    const confirmReason = ref('');
    const showTest = ref(false);
    const testEvent = ref('admin.test');
    const testNote = ref('Manual test dispatch');
    const sortKey = ref('createdAt');
    const sortDir = ref('desc');
    // Filters
    const filterStatus = ref(''); // '', 'sent', 'failed'
    const filterRcMin = ref('');
    const filterRcMax = ref('');
    const filterRtMin = ref('');
    const filterRtMax = ref('');
    const windowHours = ref(24);
    const filterQ = ref('');
    const onlyFailed = ref(false);

    async function load() {
      loading.value = true; error.value = '';
      try {
        const data = await listWebhooks();
        items.value = Array.isArray(data) ? data : [];
      } catch (e) {
        error.value = e?.message || String(e);
      } finally { loading.value = false; }
    }

    async function toggle(item) {
      try {
        const next = !item.active;
        item.active = next;
        await toggleWebhook(item.id, next);
      } catch (e) {
        item.active = !item.active;
        error.value = e?.message || String(e);
      }
    }

    async function bulk(action, reason = '') {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
        const res = await fetch(`${base}/admin/webhooks/${encodeURIComponent(ws)}/bulk?action=${encodeURIComponent(action)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined },
          body: JSON.stringify({ reason })
        });
        if (!res.ok) throw new Error(await res.text());
        await load();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function loadDeliveries(item) {
      selected.value = item;
      deliveryDetail.value = null;
      deliveriesPage.value = 1;
      await fetchDeliveries();
      await loadStats();
    }

    async function fetchDeliveries() {
      deliveries.value = [];
      loadingDeliveries.value = true; error.value='';
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
        const p = new URLSearchParams({ workspaceId: ws, webhookId: selected.value.id, page: String(deliveriesPage.value), pageSize: String(deliveriesPageSize.value), sortKey: sortKey.value, sortDir: sortDir.value, windowHours: String(windowHours.value) });
        if (filterStatus.value) p.set('status', filterStatus.value);
        if (filterRcMin.value) p.set('responseCodeMin', filterRcMin.value);
        if (filterRcMax.value) p.set('responseCodeMax', filterRcMax.value);
        if (filterRtMin.value) p.set('responseTimeMin', filterRtMin.value);
        if (filterRtMax.value) p.set('responseTimeMax', filterRtMax.value);
        if (filterQ.value) p.set('q', filterQ.value);
        const params = p.toString();
        const url = `${base}/admin/deliveries?${params}`;
        const res = await fetch(url, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        deliveries.value = data.rows || [];
        deliveriesTotal.value = data.total || deliveries.value.length;
        deliveriesPageSize.value = data.pageSize || deliveriesPageSize.value;
      } catch (e) { error.value = e?.message || String(e); }
      finally { loadingDeliveries.value = false; }
    }

    const stats = ref({ p95: null, p50: null, count: 0, failed: 0, series: [], histogram: {} });
    const histEntries = computed(() => {
      const h = stats.value?.histogram || {};
      return [
        { key: '2xx', count: h['2xx'] || 0, color: '#10B981' },
        { key: '3xx', count: h['3xx'] || 0, color: '#22D3EE' },
        { key: '4xx', count: h['4xx'] || 0, color: '#F59E0B' },
        { key: '5xx', count: h['5xx'] || 0, color: '#EF4444' },
        { key: 'other', count: h.other || 0, color: '#9CA3AF' }
      ];
    });
    const histMax = computed(() => Math.max(1, ...histEntries.value.map(e => e.count)));
    const maxY = computed(() => {
      const s = stats.value?.series || [];
      return Math.max(1, ...s.map(x => Math.max(x.p95 || 0, x.p50 || 0)));
    });
    function pathFor(key) {
      const s = stats.value?.series || [];
      if (!s.length) return '';
      const n = s.length - 1 || 1;
      let d = '';
      for (let i = 0; i < s.length; i++) {
        const x = (i / n) * 580 + 10;
        const y = (140 - ((s[i][key] || 0) / maxY.value) * 120) + 10;
        d += (i ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
      }
      return d;
    }
    function sparkPath() {
      const s = stats.value?.series || [];
      if (!s.length) return '';
      const n = s.length - 1 || 1;
      let d = '';
      for (let i = 0; i < s.length; i++) {
        const rate = s[i].rate == null ? 0 : s[i].rate;
        const x = (i / n) * 580 + 10;
        const y = (60 - (rate) * 50) + 10;
        d += (i ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
      }
      return d;
    }
    const lastRatePct = computed(() => {
      const s = stats.value?.series || [];
      if (!s.length || s[s.length - 1].rate == null) return null;
      return Math.round(s[s.length - 1].rate * 100);
    });
    const hoveredIndex = ref(null);
    function onChartMove(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const s = stats.value?.series || [];
      if (!s.length) { hoveredIndex.value = null; return; }
      const n = s.length - 1 || 1;
      const x = Math.min(Math.max(e.clientX - rect.left, 10), rect.width - 10);
      const idx = Math.round(((x - 10) / (rect.width - 20)) * n);
      hoveredIndex.value = Math.max(0, Math.min(n, idx));
    }
    function onChartLeave() { hoveredIndex.value = null; }
    function quickRange(hours) { windowHours.value = hours; applyFilters(); }
    function toggleOnlyFailed() { filterStatus.value = onlyFailed.value ? 'failed' : ''; applyFilters(); }
    async function loadStats() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
        const params = new URLSearchParams({ workspaceId: ws, webhookId: selected.value.id, windowHours: String(windowHours.value) }).toString();
        const url = `${base}/admin/deliveries/stats?${params}`;
        const res = await fetch(url, { headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        stats.value = data;
      } catch {}
    }

    async function replay(item) {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
        const res = await fetch(`${base}/admin/webhooks/${encodeURIComponent(ws)}/${encodeURIComponent(item.id)}/replay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined }
        });
        if (!res.ok) throw new Error(await res.text());
        const r = await res.json();
        alert(`Replay ${r.status}${r.responseCode ? ` (${r.responseCode})` : ''}`);
      } catch (e) { error.value = e?.message || String(e); }
    }

    function openConfirm(act) { confirmAction.value = act; confirmReason.value=''; showConfirm.value = true; }
    async function confirmBulk() { await bulk(confirmAction.value, confirmReason.value); showConfirm.value = false; }
    function showDelivery(d) { deliveryDetail.value = d; }
    function closeDelivery() { deliveryDetail.value = null; }
    async function sendTest() {
      try {
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
        const res = await fetch(`${base}/admin/webhooks/${encodeURIComponent(ws)}/test-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined },
          body: JSON.stringify({ event: testEvent.value, note: testNote.value })
        });
        if (!res.ok) throw new Error(await res.text());
        showTest.value = false;
        if (selected.value) await fetchDeliveries();
      } catch (e) { error.value = e?.message || String(e); }
    }

    async function retryFailedForSelected() {
      try {
        if (!selected.value) return;
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const ws = (window.__DAXLINKS_CONFIG__ || {}).workspaceId;
        const url = `${base}/admin/webhooks/${encodeURIComponent(ws)}/${encodeURIComponent(selected.value.id)}/retry-failed`;
        const res = await fetch(url, { method: 'POST', headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        await fetchDeliveries();
      } catch (e) { /* noop */ }
    }

    async function retryDeliveryById(id) {
      try {
        if (!id) return;
        const base = (window.__DAXLINKS_CONFIG__ || {}).apiBaseUrl || '';
        const url = `${base}/admin/deliveries/${encodeURIComponent(id)}/retry`;
        const res = await fetch(url, { method: 'POST', headers: { Authorization: window.__appAuthToken__ ? `Bearer ${window.__appAuthToken__}` : undefined } });
        if (!res.ok) throw new Error(await res.text());
        closeDelivery();
        await fetchDeliveries();
      } catch (e) { /* noop */ }
    }
    function copyCurl(delivery) {
      try {
        const url = selected.value?.url || '';
        const payload = JSON.stringify(delivery.payload || {}, null, 0);
        const cmd = `curl -X POST \"${url}\" -H 'Content-Type: application/json' --data-raw '${payload.replace(/'/g, "'\\''")}'`;
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd);
        alert('cURL copied to clipboard');
      } catch (e) {
        console.error('Copy failed', e);
      }
    }

    function exportDeliveriesCsv() {
      const cols = ['id','createdAt','status','responseCode','responseTimeMs','attempts','lastError'];
      const header = cols.join(',');
      const rows = deliveries.value.map(d => cols.map(c => {
        const v = d[c] == null ? '' : String(d[c]);
        return '"' + v.replaceAll('"','""') + '"';
      }).join(','));
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'deliveries.csv'; a.click();
      URL.revokeObjectURL(url);
    }

    function applyFilters() { deliveriesPage.value = 1; fetchDeliveries(); loadStats(); }

    onMounted(load);
    return { store, items, loading, error, load, toggle, replay, bulk, selected, deliveries, deliveriesPage, deliveriesPageSize, deliveriesTotal, loadingDeliveries, loadDeliveries, fetchDeliveries, deliveryDetail, showDelivery, closeDelivery, showConfirm, confirmAction, confirmReason, openConfirm, confirmBulk, showTest, testEvent, testNote, sendTest, retryFailedForSelected, retryDeliveryById, copyCurl, sortKey, sortDir, exportDeliveriesCsv, filterStatus, filterRcMin, filterRcMax, filterRtMin, filterRtMax, windowHours, filterQ, applyFilters, stats, histEntries, histMax, maxY, pathFor, sparkPath, lastRatePct, hoveredIndex, onChartMove, onChartLeave, quickRange, onlyFailed, toggleOnlyFailed };
  },
  template: `
    <section class="space-y-6">
      <article class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Webhooks</h3>
          <div class="flex items-center gap-2">
            <button class="btn btn-secondary" @click="load">Refresh</button>
            <button class="btn btn-secondary" title="Enable all" @click="openConfirm('enable')">Enable all</button>
            <button class="btn btn-secondary" title="Disable all" @click="openConfirm('disable')">Disable all</button>
            <button class="btn btn-secondary" title="Send test event" @click="showTest = true">Send test event</button>
          </div>
        </header>
        <p v-if="loading" class="text-sm muted-text mt-3">Loading...</p>
        <p v-if="error" class="text-sm text-rose-400 mt-3">{{ error }}</p>
        <table v-if="!loading" class="w-full text-sm mt-3">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">Name</th>
              <th class="py-2">URL</th>
              <th class="py-2">Active</th>
              <th class="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in items" :key="h.id" class="border-t border-white/5">
              <td class="py-2">{{ h.name }}</td>
              <td class="py-2 truncate max-w-[380px]">{{ h.url }}</td>
              <td class="py-2">{{ h.active ? 'Yes' : 'No' }}</td>
              <td class="py-2">
                <button class="btn btn-secondary" @click="toggle(h)">{{ h.active ? 'Disable' : 'Enable' }}</button>
                <button class="btn btn-secondary" @click="replay(h)">Replay</button>
                <button class="btn btn-secondary" @click="loadDeliveries(h)">View history</button>
              </td>
            </tr>
          </tbody>
        </table>
      </article>

      <article v-if="selected" class="card-shell">
        <header class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-main">Delivery History — {{ selected.name }} <span class="text-xs text-gray-400">({{ windowHours }}h p95: {{ stats.p95 ?? '—' }}ms)</span></h3>
          <button class="btn btn-secondary" @click="selected = null">Close</button>
        </header>
        <p v-if="loadingDeliveries" class="text-sm muted-text mt-3">Loading...</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <label class="text-xs text-gray-400">Sort by
            <select v-model="sortKey" class="field ml-2 w-44" @change="fetchDeliveries()">
              <option value="createdAt">Created</option>
              <option value="status">Status</option>
              <option value="responseCode">Response code</option>
              <option value="responseTimeMs">Response time</option>
            </select>
          </label>
          <label class="text-xs text-gray-400">Direction
            <select v-model="sortDir" class="field ml-2 w-28" @change="fetchDeliveries()">
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>
          <label class="text-xs text-gray-400">Window
            <select v-model.number="windowHours" class="field ml-2 w-28">
              <option :value="1">1h</option>
              <option :value="6">6h</option>
              <option :value="24">24h</option>
              <option :value="168">7d</option>
            </select>
          </label>
          <label class="text-xs text-gray-400">Status
            <select v-model="filterStatus" class="field ml-2 w-28" @change="applyFilters()">
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label class="text-xs text-gray-400 inline-flex items-center gap-2"><input type="checkbox" v-model="onlyFailed" @change="toggleOnlyFailed" /> Only failed</label>
          <label class="text-xs text-gray-400">Search
            <input v-model="filterQ" placeholder="text in error/response" class="field ml-2 w-52" />
          </label>
          <label class="text-xs text-gray-400">Code
            <input v-model="filterRcMin" placeholder="min" class="field ml-2 w-20" />
            <input v-model="filterRcMax" placeholder="max" class="field ml-1 w-20" />
          </label>
          <label class="text-xs text-gray-400">Time (ms)
            <input v-model="filterRtMin" placeholder="min" class="field ml-2 w-20" />
            <input v-model="filterRtMax" placeholder="max" class="field ml-1 w-20" />
          </label>
          <button class="btn btn-secondary" @click="applyFilters">Apply</button>
          <button class="btn btn-secondary" @click="exportDeliveriesCsv">Export CSV</button>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <button class="btn btn-secondary" title="Retry failed for this webhook" @click="retryFailedForSelected">Retry failed</button>
        </div>
        <div v-if="stats.series && stats.series.length" class="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <svg :width="600" :height="160" viewBox="0 0 600 160" class="w-full max-w-full" @mousemove="onChartMove" @mouseleave="onChartLeave">
              <g>
                <line x1="10" y1="150" x2="590" y2="150" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
                <line x1="10" y1="10" x2="10" y2="150" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
                <text x="14" y="22" font-size="10" fill="rgba(255,255,255,0.6)">ms</text>
                <text x="520" y="158" font-size="10" fill="rgba(255,255,255,0.6)">{{ windowHours }}h</text>
                <text x="20" y="12" font-size="10" fill="#89d8ff">p95</text>
                <text x="60" y="12" font-size="10" fill="#A78BFA">p50</text>
              </g>
              <path :d="pathFor('p95')" stroke="#2cb2ff" fill="none" stroke-width="1.5" />
              <path :d="pathFor('p50')" stroke="#A78BFA" fill="none" stroke-width="1.5" />
              <g v-if="hoveredIndex !== null">
                <line :x1="(hoveredIndex/(stats.series.length-1||1))*580+10" y1="10" :x2="(hoveredIndex/(stats.series.length-1||1))*580+10" y2="150" stroke="rgba(255,255,255,0.3)" stroke-dasharray="3,3" />
                <circle :cx="(hoveredIndex/(stats.series.length-1||1))*580+10" :cy="(140 - ((stats.series[hoveredIndex].p95 || 0)/maxY)*120)+10" r="2" fill="#2cb2ff" />
                <circle :cx="(hoveredIndex/(stats.series.length-1||1))*580+10" :cy="(140 - ((stats.series[hoveredIndex].p50 || 0)/maxY)*120)+10" r="2" fill="#A78BFA" />
                <rect x="14" y="26" width="170" height="40" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.2)" />
                <text x="20" y="42" font-size="10" fill="#89d8ff">p95: {{ stats.series[hoveredIndex].p95 ?? '—' }} ms</text>
                <text x="20" y="56" font-size="10" fill="#A78BFA">p50: {{ stats.series[hoveredIndex].p50 ?? '—' }} ms</text>
              </g>
            </svg>
            <div class="mt-2 flex items-center justify-between">
              <div class="text-xs text-gray-400">Success rate sparkline</div>
              <div class="text-xs" :style="{ color: (lastRatePct ?? 0) >= 95 ? '#10B981' : '#F59E0B' }">{{ lastRatePct ?? '—' }}%</div>
            </div>
            <svg :width="600" :height="80" viewBox="0 0 600 80" class="w-full max-w-full">
              <path :d="sparkPath()" stroke="#10B981" fill="none" stroke-width="1.5" />
            </svg>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-2">Response code histogram</div>
            <div class="grid gap-2">
              <div v-for="e in histEntries" :key="e.key" class="flex items-center gap-2">
                <div class="w-10 text-xs text-gray-400">{{ e.key }}</div>
                <div class="flex-1 h-2 rounded bg-white/10">
                  <div class="h-2 rounded" :style="{ width: ((e.count / (histMax||1)) * 100) + '%', background: e.color }"></div>
                </div>
                <div class="w-10 text-right text-xs">{{ e.count }}</div>
              </div>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <span class="text-xs text-gray-400">Quick range:</span>
              <button class="btn btn-secondary" @click="quickRange(1)">1h</button>
              <button class="btn btn-secondary" @click="quickRange(6)">6h</button>
              <button class="btn btn-secondary" @click="quickRange(24)">24h</button>
              <button class="btn btn-secondary" @click="quickRange(168)">7d</button>
            </div>
          </div>
        </div>
        <div v-if="stats.series && stats.series.length" class="mt-3">
          <svg :width="600" :height="160" viewBox="0 0 600 160" class="w-full max-w-full">
            <g>
              <line x1="10" y1="150" x2="590" y2="150" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
              <line x1="10" y1="10" x2="10" y2="150" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
              <text x="14" y="22" font-size="10" fill="rgba(255,255,255,0.6)">ms</text>
              <text x="520" y="158" font-size="10" fill="rgba(255,255,255,0.6)">{{ windowHours }}h</text>
              <text x="20" y="12" font-size="10" fill="#89d8ff">p95</text>
              <text x="60" y="12" font-size="10" fill="#A78BFA">p50</text>
            </g>
            <g>
              <template v-for="(d,i) in stats.series">
                <circle :cx="(i/(stats.series.length-1||1))*580+10" :cy="(140 - ((d.p95 || 0)/Math.max(...stats.series.map(x=>x.p95||0),1))*120)+10" r="1.5" fill="#2cb2ff" />
                <circle :cx="(i/(stats.series.length-1||1))*580+10" :cy="(140 - ((d.p50 || 0)/Math.max(...stats.series.map(x=>x.p50||0),1))*120)+10" r="1.5" fill="#A78BFA" />
              </template>
            </g>
          </svg>
        </div>
        <table v-if="!loadingDeliveries" class="w-full text-sm mt-3">
          <thead>
            <tr class="text-left text-[rgba(255,255,255,0.6)]">
              <th class="py-2">When</th>
              <th class="py-2">Status</th>
              <th class="py-2">Code</th>
              <th class="py-2">Time (ms)</th>
              <th class="py-2">Attempts</th>
              <th class="py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in deliveries" :key="d.id" class="border-t border-white/5 hover:bg-white/5 cursor-pointer" @click="showDelivery(d)">
              <td class="py-2">{{ d.createdAt }}</td>
              <td class="py-2">{{ d.status }}</td>
              <td class="py-2">{{ d.responseCode || '—' }}</td>
              <td class="py-2">{{ d.responseTimeMs ?? '—' }}</td>
              <td class="py-2">{{ d.attempts }}</td>
              <td class="py-2 truncate max-w-[380px]" :title="d.lastError">{{ d.lastError || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div class="mt-3 flex items-center justify-end gap-2 text-xs text-gray-400">
          <button class="btn btn-secondary" :disabled="deliveriesPage<=1" @click="deliveriesPage--; fetchDeliveries()">Prev</button>
          <span>Page {{ deliveriesPage }}</span>
          <button class="btn btn-secondary" :disabled="deliveriesPage * deliveriesPageSize >= deliveriesTotal" @click="deliveriesPage++; fetchDeliveries()">Next</button>
        </div>
      </article>

      <!-- Delivery details drawer -->
      <div v-if="deliveryDetail" class="fixed inset-0 z-50 flex">
        <div class="flex-1 bg-black/50" @click="closeDelivery"></div>
        <aside class="w-full max-w-xl bg-gray-950 border-l border-white/10 p-4 overflow-y-auto">
          <header class="flex items-center justify-between">
            <h4 class="text-main font-semibold">Delivery Details</h4>
            <button class="btn btn-secondary" @click="closeDelivery">Close</button>
          </header>
          <div class="mt-3 grid gap-3">
            <div class="card-shell">
              <h5 class="text-sm text-main">Response</h5>
              <p class="text-xs text-gray-400">Status: {{ deliveryDetail.status }} • Code: {{ deliveryDetail.responseCode || '—' }} • Time: {{ deliveryDetail.responseTimeMs ?? '—' }}ms</p>
              <pre class="mt-2 whitespace-pre-wrap text-xs">{{ deliveryDetail.responseBody || deliveryDetail.lastError || '—' }}</pre>
              <div v-if="deliveryDetail.responseHeaders" class="mt-2 text-xs text-gray-400">
                <h6 class="text-main mb-1">Headers</h6>
                <pre class="whitespace-pre-wrap">{{ JSON.stringify(deliveryDetail.responseHeaders, null, 2) }}</pre>
              </div>
            </div>
            <div class="card-shell">
              <h5 class="text-sm text-main">Payload</h5>
              <pre class="mt-2 whitespace-pre-wrap text-xs">{{ JSON.stringify(deliveryDetail.payload, null, 2) }}</pre>
              <div class="mt-3 flex items-center gap-2">
                <button class="btn btn-secondary" @click="copyCurl(deliveryDetail)">Copy as cURL</button>
                <button class="btn btn-secondary" @click="retryDeliveryById(deliveryDetail.id)">Retry this delivery</button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <!-- Confirm modal for bulk actions -->
      <div v-if="showConfirm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div class="card-shell w-full max-w-md">
          <h4 class="text-main font-semibold">Confirm bulk {{ confirmAction }}</h4>
          <p class="text-sm muted-text mt-2">This will {{ confirmAction }} all webhooks in the current workspace.</p>
          <label class="block mt-3 text-sm muted-text">Reason (optional)
            <input v-model="confirmReason" class="field mt-1" placeholder="Why?" />
          </label>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button class="btn btn-secondary" @click="showConfirm=false">Cancel</button>
            <button class="btn btn-white-animated" @click="confirmBulk">Confirm</button>
          </div>
        </div>
      </div>

      <!-- Test event modal -->
      <div v-if="showTest" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div class="card-shell w-full max-w-md">
          <h4 class="text-main font-semibold">Send test event</h4>
          <div class="mt-3 grid gap-3">
            <label class="text-sm muted-text">Event
              <input v-model="testEvent" class="field mt-1" />
            </label>
            <label class="text-sm muted-text">Note
              <input v-model="testNote" class="field mt-1" />
            </label>
          </div>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button class="btn btn-secondary" @click="showTest=false">Cancel</button>
            <button class="btn btn-white-animated" @click="sendTest">Send</button>
          </div>
        </div>
      </div>
    </section>
  `
};
