import { ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'CustomDns',
  setup() {
    const subdomain = ref('');
    const ip = ref('');
    const availability = ref(null);
    const checking = ref(false);
    const registering = ref(false);
    const resultUrl = ref('');
    const error = ref('');
    const myRecords = ref([]);
    const loadingMine = ref(false);
    const deleting = ref({});
    const showConfetti = ref(false);
    const confettiCanvas = ref(null);

    const baseDomain = () => (window.__DAXLINKS_CONFIG__?.baseDomain || 'daxlinksonline.link');

    function runConfetti(canvas) {
      if (!canvas) return () => {};
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.scale(dpr, dpr);
      const colors = ['#ffffff', '#89d8ff', '#6B6BF7', '#A78BFA', '#00ff9d'];
      const N = Math.min(120, Math.floor((w * h) / 20000));
      const parts = Array.from({ length: N }, () => ({
        x: Math.random() * w,
        y: -10 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 2.0,
        vy: 2 + Math.random() * 2.2,
        size: 3 + Math.random() * 3,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2
      }));
      let raf; let life = 0; const maxLife = 1800; // ~3s
      function step() {
        ctx.clearRect(0, 0, w, h);
        for (const p of parts) {
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          if (p.y > h + 20) { p.y = -10; p.x = Math.random() * w; }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color; ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.restore();
        }
        life += 16;
        if (life < maxLife) raf = requestAnimationFrame(step);
      }
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }

    async function checkAvailability() {
      error.value = '';
      availability.value = null;
      const name = (subdomain.value || '').trim().toLowerCase();
      if (!name) return;
      checking.value = true;
      try {
        const { dnsCheckAvailable } = await import('../services/apiClient.js');
        const res = await dnsCheckAvailable(name);
        availability.value = res;
      } catch (e) {
        error.value = e?.message || String(e);
      } finally {
        checking.value = false;
      }
    }

    async function registerDns() {
      error.value = '';
      resultUrl.value = '';
      registering.value = true;
      try {
        // Require auth for register
        const token = (typeof window !== 'undefined' && (window.__appAuthToken__ || window.localStorage?.getItem('daxlinksToken'))) || null;
        if (!token) {
          throw new Error('Please sign in to add a custom DNS record.');
        }
        const { dnsRegister } = await import('../services/apiClient.js');
        const res = await dnsRegister({ subdomain: subdomain.value.trim().toLowerCase(), ip: ip.value.trim() });
        resultUrl.value = res?.url || '';
        // confetti overlay for success
        showConfetti.value = true;
        setTimeout(() => {
          const stop = runConfetti(confettiCanvas.value);
          setTimeout(() => { stop(); showConfetti.value = false; }, 2200);
        });
      } catch (e) {
        error.value = e?.message || String(e);
      } finally {
        registering.value = false;
        fetchMine();
      }
    }

    async function fetchMine() {
      loadingMine.value = true;
      error.value = '';
      try {
        // Skip if not authenticated
        const token = (typeof window !== 'undefined' && (window.__appAuthToken__ || window.localStorage?.getItem('daxlinksToken'))) || null;
        if (!token) {
          myRecords.value = [];
          return;
        }
        const { dnsListMine } = await import('../services/apiClient.js');
        const res = await dnsListMine();
        myRecords.value = Array.isArray(res?.items) ? res.items : [];
      } catch (e) {
        // If unauthorized, keep silent and show empty state
        const msg = e?.message || String(e);
        if (!/401|Unauthorized/i.test(msg)) error.value = msg;
      } finally {
        loadingMine.value = false;
      }
    }

    async function deleteRec(rec) {
      if (!rec?.id) return;
      deleting.value[rec.id] = true;
      try {
        const { dnsDelete } = await import('../services/apiClient.js');
        await dnsDelete(rec.id);
        myRecords.value = myRecords.value.filter((r) => r.id !== rec.id);
      } catch (e) {
        error.value = e?.message || String(e);
      } finally {
        deleting.value[rec.id] = false;
      }
    }

    // initial
    try { fetchMine(); } catch {}

    const isAuthenticated = () => {
      return Boolean((typeof window !== 'undefined' && (window.__appAuthToken__ || window.localStorage?.getItem('daxlinksToken'))) || null);
    };

    return { subdomain, ip, availability, checking, registering, resultUrl, error, myRecords, loadingMine, deleting, baseDomain, checkAvailability, registerDns, fetchMine, deleteRec, showConfetti, confettiCanvas, isAuthenticated };
  },
  template: `
    <section class="relative card-shell space-y-4">
      <div v-if="showConfetti" class="pointer-events-none absolute inset-0 z-10">
        <canvas ref="confettiCanvas" class="h-full w-full"></canvas>
      </div>
      <h2 class="text-lg font-semibold text-main">Custom Domain → Point to YOUR server</h2>
      <p class="text-sm muted-text">Create an A record under {{ baseDomain() }} to your public IP. Unproxied for direct control.</p>
      <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div>
          <label class="text-xs uppercase tracking-[0.3em] muted-text">Subdomain</label>
          <div class="hero-input mt-1 flex items-center">
            <input v-model.trim="subdomain" @input="checkAvailability" :placeholder="'mybot'" />
            <span class="text-xs text-gray-500">.{{ baseDomain() }}</span>
          </div>
          <p class="text-xs mt-1" :style="availability?.available ? 'color: #00D4AA' : 'color:#ef4444'">
            <span v-if="checking" class="opacity-80">Checking…</span>
            <span v-else-if="availability && availability.available">Available</span>
            <span v-else-if="availability && !availability.available">Taken</span>
            <span v-else>&nbsp;</span>
          </p>
        </div>
        <div>
          <label class="text-xs uppercase tracking-[0.3em] muted-text">Public IP</label>
          <div class="hero-input mt-1">
            <input v-model.trim="ip" placeholder="167.99.12.45" />
          </div>
        </div>
        <div class="flex md:justify-end">
          <button type="button" class="btn btn-primary text-xs tracking-[0.2em] w-full md:w-auto" :disabled="!(availability?.available && subdomain && ip) || registering" @click="registerDns">
            {{ registering ? 'Adding…' : 'Add' }}
          </button>
        </div>
      </div>
      <p v-if="resultUrl" class="text-sm" style="color:#00D4AA;">Success — Use <a :href="resultUrl" target="_blank" class="underline">{{ resultUrl }}</a></p>
      <p v-if="error" class="text-sm" style="color:#ef4444;">{{ error }}</p>
      <p class="text-xs muted-text">Real-time availability checks and instant Cloudflare A record creation.</p>

      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-main">Your Custom Subdomains</h3>
        <p v-if="loadingMine" class="text-sm muted-text">Loading…</p>
        <p v-else-if="!isAuthenticated()" class="text-sm muted-text">Sign in to view your records.</p>
        <table v-else-if="myRecords.length" class="w-full text-xs muted-text">
          <thead class="text-left text-[11px] uppercase tracking-[0.3em] muted-text">
            <tr>
              <th class="pb-2">Hostname</th>
              <th class="pb-2">Target IP</th>
              <th class="pb-2">Cloudflare ID</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rec in myRecords" :key="rec.id" class="border-t border-white/5">
              <td class="py-3">
                <a :href="rec.url" target="_blank" class="underline">{{ rec.host }}</a>
              </td>
              <td class="py-3">{{ rec.ip || '—' }}</td>
              <td class="py-3">
                <div class="flex items-center gap-2">
                  <span class="truncate">{{ rec.cloudflareId }}</span>
                  <button type="button" class="btn btn-danger btn-xs" @click="deleteRec(rec)" :disabled="deleting[rec.id]">
                    {{ deleting[rec.id] ? 'Deleting…' : 'Delete' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="text-sm muted-text">No custom subdomains yet.</p>
      </div>
    </section>
  `
};
