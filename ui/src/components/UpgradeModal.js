import { inject, computed, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { getConfig } from '../services/config.js';

function daysLeft(target) {
  if (!target) return null;
  const t = target instanceof Date ? target.getTime() : new Date(target).getTime();
  if (!Number.isFinite(t)) return null;
  const d = Math.ceil((t - Date.now()) / (24 * 3600e3));
  return d;
}

export default {
  name: 'UpgradeModal',
  emits: ['close'],
  setup(_, { emit }) {
    const store = inject('dashboardStore');
    const cfg = getConfig();
    const dismissedKey = 'daxlinksUpgradeDismissed';
    const open = ref(false);
    const billingUrl = cfg.billingUrl || cfg.checkoutUrl || null;
    const days = computed(() => daysLeft(store.auth?.user?.webhook?.trialEndsAt));

    function shouldOpen() {
      if (!store.auth?.user?.webhook?.trialEndsAt) return false;
      const d = days.value;
      if (d === null) return false;
      if (d > 3) return false;
      const stamp = Number(localStorage.getItem(dismissedKey) || 0);
      return Date.now() - stamp > 24 * 3600e3; // show again after a day
    }

    function close() {
      open.value = false;
      localStorage.setItem(dismissedKey, String(Date.now()));
      emit('close');
    }

    function openIfNeeded() {
      if (shouldOpen()) open.value = true;
    }

    // expose methods
    return { open, days, billingUrl, close, openIfNeeded };
  },
  template: `
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/60" @click="close"></div>
      <div class="relative z-10 w-[92%] max-w-md rounded-2xl border border-white/10 bg-[#0D0E13] p-6 shadow-xl">
        <h3 class="text-xl font-semibold text-main">{{ days !== null && days <= 3 ? days + ' day' + (days===1?'':'s') + ' left!' : 'Trial expiring soon' }}</h3>
        <p class="mt-2 text-sm muted-text">Keep your webhook alive forever. $9 / month.</p>
        <div class="mt-5 flex items-center gap-3">
          <a v-if="billingUrl" :href="billingUrl" target="_blank" class="btn btn-primary">Upgrade now</a>
          <button v-else type="button" class="btn btn-primary" @click="close">Contact support to upgrade</button>
          <button type="button" class="btn btn-secondary" @click="close">Later</button>
        </div>
      </div>
    </div>
  `
};

