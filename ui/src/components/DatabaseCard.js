export default {
  name: 'DatabaseCard',
  props: {
    database: { type: Object, required: true }
  },
  emits: ['view', 'upgrade', 'webhooks', 'export'],
  computed: {
    statusColor() {
      const s = (this.database.status || '').toLowerCase();
      return s === 'active' ? 'from-emerald-500/20 to-emerald-500/5' : 'from-gray-500/20 to-gray-500/5';
    },
    badgeText() {
      const size = this.database.sizeGb ? `${this.database.sizeGb} GB` : '';
      return this.database.upgraded ? `${size} · Upgraded` : size;
    },
    usedPercent() {
      const used = this.database.usedGb || 0;
      const size = this.database.sizeGb || 1;
      return Math.min(100, Math.round((used / size) * 100));
    }
  },
  template: `
    <article
      class="card-shell flex flex-col justify-between bg-gradient-to-br p-5"
      :class="statusColor"
      :aria-label="'Database ' + (database.name || database.id)"
    >
      <header class="flex items-start justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">💾</div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-semibold text-main">{{ database.name || 'Untitled DB' }}</h3>
              <button class="text-xs text-gray-400 hover:text-white" title="Rename" aria-label="Rename">
                ✏️
              </button>
            </div>
            <p class="mt-1 text-xs text-gray-400">
              Created {{ new Date(database.createdAt || Date.now()).toLocaleDateString() }} · {{ (database.tradesCount || 0).toLocaleString() }} trades
            </p>
          </div>
        </div>
        <span class="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.28em] text-gray-200">
          {{ badgeText || (database.status || 'Pending') }}
        </span>
      </header>

      <div class="mt-5 space-y-3">
        <div class="flex items-center justify-between text-xs text-gray-300">
          <span>Storage</span>
          <span>{{ database.usedGb || 0 }} GB / {{ database.sizeGb || 0 }} GB</span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-emerald-400/80" :style="{ width: usedPercent + '%' }"></div>
        </div>
      </div>

      <footer class="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        <button type="button" class="btn btn-secondary text-[11px]" @click="$emit('view', database)">View Analytics</button>
        <button type="button" class="btn btn-secondary text-[11px]" @click="$emit('upgrade', database)">Upgrade</button>
        <button type="button" class="btn btn-secondary text-[11px]" @click="$emit('webhooks', database)">Webhooks</button>
        <button type="button" class="btn btn-secondary text-[11px]" @click="$emit('export', database)">Export CSV</button>
      </footer>
    </article>
  `
};

