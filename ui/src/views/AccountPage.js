import { inject, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'AccountPage',
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const loading = computed(() => store.loading);
    const isAuthenticated = computed(() => Boolean(store.auth.user));
    const user = computed(() => store.auth.user || {});
    const role = computed(() => String(user.value.role || '').toLowerCase());
    const isSuperAdmin = computed(() => Boolean(user.value.isSuperAdmin));
    const isDeveloper = computed(() => ['admin','developer','engineer'].includes(role.value));
    const isPrivileged = computed(() => isSuperAdmin.value || isDeveloper.value);
    const subscription = computed(() => {
      const u = user.value || {};
      const plan = u.plan || u.planTier || store.forms?.register?.plan || 'Professional';
      const status = u.subscriptionStatus || 'Active';
      const renewal = u.renewsAt || u.renewalDate || null;
      return { plan, status, renewal };
    });
    const authMessage = computed(() => {
      if (store.auth.error) return store.auth.error;
      if (store.auth.status === 'mock') {
        return 'Authentication is unavailable while viewing mock data.';
      }
       if (store.auth.status === 'reset-requested') {
         return 'If your email is on file, a reset link has been sent.';
       }
      return '';
    });
    const openAdminPortal = () => {
      try {
        const inUiFolder = typeof window !== 'undefined' && window.location.pathname.includes('/ui/');
        const target = inUiFolder ? 'portal.html' : '/ui/portal.html';
        window.location.href = target;
      } catch {}
    };
    return { store, actions, loading, isAuthenticated, authMessage, user, subscription, openAdminPortal, role, isSuperAdmin, isDeveloper, isPrivileged };
  },
  template: `
    <main class="min-h-screen">
      <div v-if="loading" class="flex h-screen items-center justify-center text-sm text-gray-400">
        Loading authentication...
      </div>
      <template v-else>
        <section v-if="!isAuthenticated" class="relative flex min-h-screen flex-col overflow-hidden">
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(107,107,247,0.15),transparent_55%),radial-gradient(circle_at_bottom,rgba(18,152,230,0.12),transparent_55%),#0D0E13]"></div>
          <div class="relative flex flex-1 flex-col lg:grid lg:grid-cols-2">
            <div class="flex flex-col justify-center px-8 py-16 text-left sm:px-16">
              <p class="text-xs uppercase tracking-[0.4em] text-primary-200">daxlinks.online Control Plane</p>
              <h1 class="mt-6 text-4xl font-light text-white sm:text-5xl">Access your operator console</h1>
              <p class="mt-4 max-w-xl text-sm text-gray-400">Sign in to continue orchestrating workspaces, integrations, and security policies. Two-factor is required for all operator access.</p>
              <ul class="mt-6 space-y-2 text-sm text-gray-400">
                <li>• Install Google Authenticator on a trusted device and scan the QR delivered after your first sign-in.</li>
                <li>• Store the generated backup codes in your vault — we issue eight single-use codes for recovery.</li>
                <li>• On every login you’ll enter your password, then confirm the 6-digit code from Google Authenticator.</li>
              </ul>
              <p class="mt-6 text-xs uppercase tracking-[0.28em] text-[rgba(255,255,255,0.6)]">Zero shared passwords · hardware-friendly · enforced by policy</p>
            </div>
            <div class="flex items-center justify-center px-8 py-16 sm:px-16">
              <form class="w-full max-w-md space-y-6" @submit.prevent="actions.loginAccount">
                <label class="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-gray-500">
                  Username
                  <input v-model="store.forms.authLogin.username" type="text" placeholder="username or email" class="rounded-none border-b border-white/30 bg-transparent px-0 py-3 text-sm text-white placeholder:text-gray-600 focus:border-white focus:outline-none" required />
                </label>
                <label class="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-gray-500">
                  Password
                  <input v-model="store.forms.authLogin.password" type="password" placeholder="••••••••" class="rounded-none border-b border-white/30 bg-transparent px-0 py-3 text-sm text-white placeholder:text-gray-600 focus:border-white focus:outline-none" required />
                </label>
                <button type="submit" class="w-full rounded-full border border-white/30 bg-white/10 px-6 py-3 text-xs uppercase tracking-[0.3em] text-white transition hover:bg-white/20">Sign In</button>
                <p v-if="authMessage" class="text-xs text-primary-300">{{ authMessage }}</p>
                <p class="text-xs text-gray-500">Need an account? <router-link :to="{ name: 'signup' }" class="text-primary-200 underline">Request access</router-link>.</p>
                <p class="text-xs text-gray-500">Forgot your password or email? <router-link :to="{ name: 'forgot' }" class="text-primary-200 underline">Start recovery</router-link>.</p>
              </form>
            </div>
          </div>
          <footer class="px-8 pb-12 text-xs uppercase tracking-[0.24em] text-gray-600 sm:px-16 flex items-center justify-between relative z-10">
            <span>Secured by daxlinks.online · 2FA enforced · SOC2 aligned</span>
            <button type="button" @click="openAdminPortal" title="Admin Portal" class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] tracking-[0.2em] text-white hover:bg-white/10 transition cursor-pointer">
              <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-600/80">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5 text-white">
                  <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                  <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                </svg>
              </span>
              <span>ADMIN</span>
            </button>
          </footer>
        </section>

        <section v-else class="relative flex min-h-screen flex-col overflow-hidden">
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(107,107,247,0.2),transparent_55%),radial-gradient(circle_at_bottom,rgba(18,152,230,0.18),transparent_55%),#0D0E13]"></div>
          <div class="relative flex-1 px-8 py-16 sm:px-16">
            <div class="grid gap-10 lg:grid-cols-2">
              <!-- Left: Account summary (text only) -->
              <div class="space-y-6">
                <header>
                  <p class="text-xs uppercase tracking-[0.4em] text-primary-200">daxlinks.online Control Plane</p>
                  <h1 class="mt-6 text-4xl font-light text-white sm:text-5xl">You’re signed in</h1>
                </header>
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-gray-500">Operator</p>
                  <h2 class="mt-2 text-2xl font-light text-white">{{ user.name }}</h2>
                  <p class="text-sm text-gray-400">{{ user.email }}</p>
                </div>
                <div class="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <h3 class="mb-4 text-sm font-semibold text-white/90">Logged in as</h3>
                  <div class="text-sm text-gray-300 space-y-2">
                    <div><span class="text-gray-500">Name:</span> {{ user.name || '—' }}</div>
                    <div><span class="text-gray-500">User ID:</span> {{ user.id || '—' }}</div>
                    <div><span class="text-gray-500">Role:</span> {{ user.role || (isSuperAdmin ? 'superadmin' : 'operator') }}</div>
                    <div>
                      <span class="text-gray-500">Access rights:</span>
                      <span>
                        Platform — Full access; Admin Console —
                        <template v-if="isPrivileged">Available</template>
                        <template v-else>Restricted</template>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="text-sm text-gray-400">
                  <p>Recent activity is reflected across your workspaces and integrations. Two-factor is enforced for all operator access.</p>
                </div>
                <div class="flex gap-3">
                  <button type="button" class="btn btn-white-animated" @click="$router.push({ name: 'platform' })">Open Platform</button>
                  <button type="button" class="btn btn-secondary" @click="actions.logoutAccount">Log out</button>
                </div>
              </div>

              <!-- Right: Subscriptions on animated white glass pane -->
              <div class="flex items-center justify-center">
                <aside class="glass-subscription p-6 rounded-2xl w-full max-w-md h-[32rem] mt-12 md:mt-20 space-y-6">
                  <div v-if="isPrivileged" class="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <h3 class="mb-3 text-sm font-semibold text-white/90">Admin Console</h3>
                    <p class="text-sm text-gray-300 mb-4">Access the admin console to manage users, webhooks, queues, flags, and incidents.</p>
                    <router-link :to="{ name: 'admin-home' }" class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-2 text-xs tracking-[0.2em] text-white hover:bg-white/10 transition">
                      Open Admin Console
                    </router-link>
                  </div>
                  <header class="flex items-center justify-between">
                    <h2 class="text-3xl sm:text-4xl font-extrabold text-main tracking-tight">Subscriptions</h2>
                    <span class="text-xs uppercase tracking-[0.28em] text-gray-400">{{ subscription.status }}</span>
                  </header>
                  <div class="mt-4 space-y-4 text-sm text-gray-200">
                    <div class="flex items-center justify-between">
                      <span class="text-gray-400">Current plan</span>
                      <span class="font-semibold">{{ subscription.plan }}</span>
                    </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">Next renewal</span>
                    <span>{{ subscription.renewal ? new Date(subscription.renewal).toLocaleDateString() : '—' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">Exchanges linked</span>
                    <span>{{ store.metrics?.exchanges ?? 0 }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">API endpoints</span>
                    <span>{{ store.metrics?.endpoints ?? '—' }}</span>
                  </div>
                  <div class="mt-6">
                    <button type="button" class="btn btn-white-animated btn-small">Manage billing</button>
                  </div>
                </aside>
              </div>
            </div>
          </div>
          <footer class="px-8 pb-12 text-xs uppercase tracking-[0.24em] text-gray-600 sm:px-16 flex items-center justify-between relative z-10">
            <span>Secured by daxlinks.online · 2FA enforced · SOC2 aligned</span>
            <router-link :to="{ name: 'admin-login' }" title="Admin Portal" class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] tracking-[0.2em] text-white hover:bg-white/10 transition cursor-pointer">
              <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-600/80">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5 text-white">
                  <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                  <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                </svg>
              </span>
              <span>ADMIN</span>
            </router-link>
          </footer>
        </section>
      </template>
    </main>
  `
};
