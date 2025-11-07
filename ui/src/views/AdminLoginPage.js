import { ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import * as apiClient from '../services/apiClient.js';

export default {
  name: 'AdminLoginPage',
  setup() {
    const username = ref('');
    const password = ref('');
    const error = ref('');
    const busy = ref(false);

    // Inject experimental/futuristic styles once
    try {
      if (typeof document !== 'undefined' && !document.getElementById('admin-login-css')) {
        const style = document.createElement('style');
        style.id = 'admin-login-css';
        style.textContent = `
          @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600&display=swap');
          /* Futuristic admin login visuals */
          .al-aurora {
            position: absolute; inset: -20% -10% -10% -10%; filter: blur(40px);
            background:
              radial-gradient(1200px 600px at 10% 0%, rgba(107,107,247,0.22), transparent 60%),
              radial-gradient(900px 500px at 90% 10%, rgba(18,152,230,0.20), transparent 60%),
              radial-gradient(800px 500px at 50% 90%, rgba(167,139,250,0.18), transparent 60%);
            animation: al-aurora-move 26s ease-in-out infinite alternate;
          }
          @keyframes al-aurora-move {
            0% { transform: translate3d(0,0,0) scale(1); }
            100% { transform: translate3d(0,-2%,0) scale(1.02); }
          }
          .al-grid {
            position: absolute; inset: 0; pointer-events: none; opacity: 0.25;
            background-image:
              radial-gradient(circle at 1px 1px, rgba(94,234,212,0.18) 1px, transparent 1px);
            background-size: 20px 20px;
          }
          .al-scanline {
            position: absolute; inset: 0; pointer-events: none;
            background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.06), transparent);
            animation: al-scan 5.2s linear infinite;
            mix-blend-mode: overlay;
          }
          @keyframes al-scan {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100%); }
          }
          .al-orb { position: absolute; border-radius: 9999px; filter: blur(18px); opacity: 0.6; }
          .al-orb.one { width: 240px; height: 240px; left: -40px; top: 20%; background: radial-gradient(circle, rgba(99,102,241,0.6), transparent 60%); animation: al-float 18s ease-in-out infinite; }
          .al-orb.two { width: 320px; height: 320px; right: -60px; bottom: 10%; background: radial-gradient(circle, rgba(14,165,233,0.55), transparent 60%); animation: al-float 22s ease-in-out infinite reverse; }
          @keyframes al-float { 0% { transform: translateY(0) translateX(0); } 50% { transform: translateY(-18px) translateX(6px); } 100% { transform: translateY(0) translateX(0); } }
          .al-ring {
            position: absolute; inset: auto; width: 520px; height: 520px; border-radius: 50%;
            background: conic-gradient(from 0deg, rgba(99,102,241,0.0), rgba(99,102,241,0.18), rgba(14,165,233,0.18), rgba(99,102,241,0.0));
            filter: blur(20px); opacity: 0.35; z-index: 0;
            animation: al-rotate 26s linear infinite;
            transform: translate(-50%, -50%);
            left: 50%; top: 40%;
          }
          @keyframes al-rotate { to { transform: translate(-50%, -50%) rotate(360deg); } }
          .al-card {
            background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 18px;
            box-shadow: 0 40px 120px rgba(10,12,19,0.65), inset 0 0 0 1px rgba(255,255,255,0.04);
            backdrop-filter: blur(14px) saturate(115%);
          }
          .al-card:focus-within { border-color: rgba(99,102,241,0.45); box-shadow: 0 50px 140px rgba(12,16,24,0.7), 0 0 0 1px rgba(99,102,241,0.45) inset; }
          .al-card-hz { display: grid; grid-template-columns: 1.1fr 1fr; overflow: hidden; }
          .al-pane { padding: 20px; }
          .al-pane-visual {
            position: relative;
            background:
              linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
            border-right: 1px solid rgba(255,255,255,0.06);
            padding-bottom: 54px; /* reserve space for bottom KPIs */
          }
          .al-pane-visual .al-vignette {
            position: absolute; inset: 0; pointer-events:none;
            background:
              radial-gradient(80% 50% at 20% 0%, rgba(99,102,241,0.18), transparent 60%),
              radial-gradient(80% 60% at 80% 10%, rgba(14,165,233,0.18), transparent 60%),
              radial-gradient(120% 80% at 50% 120%, rgba(167,139,250,0.12), transparent 70%);
            mix-blend-mode: screen; opacity: 0.9;
          }
          .al-kpis { display:flex; gap: 14px; align-items:center; flex-wrap: wrap; }
          .al-kpi { display:flex; gap: 8px; align-items: center; }
          .al-kpi-icon { display:inline-flex; width: 14px; height: 14px; color: rgba(172,181,255,0.85); }
          .al-kpi-num { font-weight: 600; font-size: 12px; letter-spacing: 0.08em; line-height: 1; font-family: 'Rajdhani', 'Plus Jakarta Sans', sans-serif; }
          .al-kpi-sub { font-weight: 500; font-size: 9px; color: rgba(255,255,255,0.70); letter-spacing: 0.12em; text-transform: uppercase; line-height: 1; font-family: 'Rajdhani', 'Plus Jakarta Sans', sans-serif; }
          /* Left-pane bottom KPI bar */
          .al-kpis-left { position:absolute; left:0; right:0; bottom:14px; display:flex; gap:18px; align-items:center; justify-content:flex-end; padding:0 16px; border-top: none; background: transparent; }
          @media (min-width: 420px) { .al-pane { padding: 24px; } }
          @media (min-width: 640px) { .al-pane { padding: 28px; } }
          @media (max-width: 768px) {
            .al-card-hz { grid-template-columns: 1fr; }
            .al-pane-visual { display: none; }
          }
          .al-label { letter-spacing: 0.28em; font-size: 10px; text-transform: uppercase; color: rgba(255,255,255,0.65); }
          .al-input {
            width: 100%; padding: 12px 14px; background: rgba(17,24,39,0.55);
            border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; color: #E6E6E6;
            outline: none; transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
          }
          .al-input::placeholder { color: #6b7280; }
          .al-input:focus { border-color: rgba(99,102,241,0.6); box-shadow: 0 0 0 3px rgba(99,102,241,0.2), 0 4px 24px rgba(99,102,241,0.18); background: rgba(17,24,39,0.65); }
          .al-btn {
            position: relative; width: 100%; padding: 10px 14px; border-radius: 12px; font-weight: 600;
            background: linear-gradient(90deg, #6B6BF7, #1298e6, #6B6BF7); background-size: 200% 100%;
            transition: transform 120ms ease, box-shadow 160ms ease, opacity 120ms ease;
            box-shadow: 0 10px 30px rgba(18,152,230,0.28), 0 0 0 1px rgba(255,255,255,0.06) inset; color: #fff;
            animation: al-shimmer 8s ease-in-out infinite;
          }
          .al-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(18,152,230,0.36), 0 0 0 1px rgba(255,255,255,0.08) inset; }
          .al-btn:disabled { opacity: 0.65; cursor: not-allowed; }
          @keyframes al-shimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          .al-chip { font-size: 10px; letter-spacing: .28em; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
          .al-border-ghost { position: absolute; inset: -1px; border-radius: 20px; background: radial-gradient(80% 120% at 50% 0%, rgba(99,102,241,0.25), rgba(255,255,255,0) 60%); opacity: 0; transition: opacity 200ms ease; pointer-events: none; }
          .al-card:hover .al-border-ghost { opacity: 1; }
        `;
        document.head.appendChild(style);
      }
    } catch {}

    const getApiBase = () => {
      try { return (window.__DAXLINKS_CONFIG__ && window.__DAXLINKS_CONFIG__.apiBaseUrl) || 'http://localhost:4000/api/v1'; }
      catch { return 'http://localhost:4000/api/v1'; }
    };

    const submit = async () => {
      error.value = '';
      busy.value = true;
      try {
        const res = await fetch(`${getApiBase()}/portal/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.value.trim(), password: password.value })
        });
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(`Login failed (${res.status}): ${detail}`);
        }
        const data = await res.json();
        try {
          localStorage.setItem('daxlinksToken', data.token);
          apiClient.setAuthToken?.(data.token);
        } catch {}
        try { window.__appAuthToken__ = data.token; } catch {}
        try { window.__lastUser__ = data.user; } catch {}
        // Navigate to admin home
        window.location.hash = '#/admin';
      } catch (e) {
        error.value = e?.message || 'Unable to sign in';
      } finally {
        busy.value = false;
      }
    };

    return { username, password, error, busy, submit };
  },
  template: `
    <main class="relative min-h-screen overflow-hidden flex items-center justify-center px-6 py-16">
      <!-- Background layers -->
      <div class="al-aurora"></div>
      <div class="al-grid"></div>
      <div class="al-scanline"></div>
      <div class="al-orb one"></div>
      <div class="al-orb two"></div>
      <div class="al-ring"></div>

      <!-- Content: horizontal card -->
      <div class="relative w-full max-w-4xl al-card al-card-hz">
        <div class="al-border-ghost"></div>

        <!-- Left: Visual/brand panel -->
        <section class="al-pane al-pane-visual">
          <div class="al-vignette"></div>
          <div class="relative">
            <div class="al-label">DaxLinks</div>
            <h2 class="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight">Admin Portal</h2>
            
          </div>
          <!-- KPIs anchored to bottom of left pane -->
          <div class="al-kpis-left">
            <div class="al-kpi">
              <span class="al-kpi-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s8-4 8-10V5l-8-3-8 3v5c0 6 8 10 8 10z"/></svg>
              </span>
              <div>
                <div class="al-kpi-num">SOC2 Ready</div>
                <div class="al-kpi-sub">Hardened</div>
              </div>
            </div>
            <div class="al-kpi">
              <span class="al-kpi-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09c0 .65.36 1.25.93 1.56"/></svg>
              </span>
              <div>
                <div class="al-kpi-num">2FA Enforced</div>
                <div class="al-kpi-sub">Policy</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Right: Form panel -->
        <section class="al-pane">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">Sign in</h1>
            </div>
          </div>
          <form @submit.prevent="submit" class="space-y-5">
            <div>
              <label class="block text-xs mb-2 al-label" for="username">Username</label>
              <div class="relative">
                <input id="username" v-model="username" type="text" required class="al-input pr-10" placeholder="your-username" />
                <svg class="absolute right-3 top-1/2 -translate-y-1/2 text-primary-200/80" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="3"/>
                </svg>
              </div>
            </div>
            <div>
              <label class="block text-xs mb-2 al-label" for="password">Password</label>
              <div class="relative">
                <input id="password" v-model="password" type="password" required class="al-input pr-10" placeholder="••••••••" />
                <svg class="absolute right-3 top-1/2 -translate-y-1/2 text-primary-200/80" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2" ry="2"/>
                  <path d="M7 11V8a5 5 0 0 1 10 0v3"/>
                </svg>
              </div>
            </div>
            <p v-if="error" class="text-sm text-rose-400">{{ error }}</p>
            <button type="submit" :disabled="busy" class="al-btn">{{ busy ? 'Signing in...' : 'Enter Console' }}</button>
          </form>
          
        </section>
        
      </div>
    </main>
  `
};
