export default {
  name: 'DatabaseMiniCard',
  props: {
    database: { type: Object, required: true },
    selected: { type: Boolean, default: false }
  },
  emits: ['select', 'tables', 'view'],
  computed: {
    usedPercent() {
      const used = this.database.usedGb || 0;
      const size = this.database.sizeGb || 1;
      return Math.min(100, Math.round((used / size) * 100));
    }
  },
  template: `
    <button
      type="button"
      class="w-full rounded-2xl border px-4 py-3 text-left transition"
      :class="selected ? 'border-primary-500/60 bg-primary-500/15 text-primary-100' : 'border-white/10 bg-black/20 text-gray-300 hover:border-primary-500/30 hover:text-white'"
      @click="$emit('select', database)"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-main">{{ database.name || 'Untitled DB' }}</p>
          <p class="mt-0.5 text-[11px] text-gray-400">{{ database.usedGb || 0 }} GB / {{ database.sizeGb || 0 }} GB</p>
        </div>
        <span class="h-2 w-2 shrink-0 rounded-full" :class="(database.status||'').toLowerCase()==='active' ? 'bg-emerald-400' : 'bg-gray-500'"></span>
      </div>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div class="h-full rounded-full bg-emerald-400/80" :style="{ width: usedPercent + '%' }"></div>
      </div>
      <div class="mt-3 flex items-center gap-2 text-[11px]">
        <span class="rounded-full border border-white/10 px-2 py-0.5 text-gray-300" @click.stop="$emit('view', database)">View</span>
        <span class="rounded-full border border-white/10 px-2 py-0.5 text-gray-300" @click.stop="$emit('tables', database)">Tables</span>
      </div>
    </button>
  `
};

