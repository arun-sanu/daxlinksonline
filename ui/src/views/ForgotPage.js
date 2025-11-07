import { inject, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'ForgotPage',
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const submitted = ref(false);

    const submitRequest = async () => {
      await actions.requestPasswordReset();
      if (!store.auth.error) {
        submitted.value = true;
      }
    };

    return { store, submitted, submitRequest };
  },
  template: `
    <main class="layout-container section-pad space-y-8">
      <section class="grid gap-6 lg:grid-cols-2">
        <form class="card-shell space-y-5" @submit.prevent="submitRequest">
          <header class="space-y-2">
            <h2 class="text-lg font-semibold text-main">Recover access</h2>
            <p class="text-sm muted-text">Enter your operator email and we’ll deliver a secure reset link.</p>
          </header>
          <label class="flex flex-col gap-2 text-sm muted-text">
            Operator email
            <input v-model="store.forms.forgot.email" type="email" placeholder="jane@desk.trading" class="field" required />
          </label>
          <button type="submit" class="btn btn-primary w-full">Send reset email</button>
          <p v-if="store.auth.error" class="text-xs text-center" style="color: var(--primary);">{{ store.auth.error }}</p>
          <p v-else-if="submitted" class="text-xs text-center" style="color: var(--primary);">If an account exists for that address, a reset link is on its way.</p>
          <p class="text-xs text-center text-gray-500">Remembered your password? <router-link :to="{ name: 'account' }" class="text-primary-200 underline">Return to sign in</router-link>.</p>
        </form>

        <article class="card-shell space-y-4">
          <header class="space-y-2">
            <h2 class="text-lg font-semibold text-main">What happens next</h2>
            <p class="text-sm muted-text">We’ll email from <span class="text-primary-200">security@daxlinks.online</span> with reset instructions and audit tracking.</p>
          </header>
          <ul class="space-y-2 text-sm muted-text">
            <li class="flex items-start gap-3"><span class="mt-1 h-2 w-2 rounded-full bg-[var(--primary)]"></span><span>Mention recent workspace activity if you reach out to fast-track verification.</span></li>
            <li class="flex items-start gap-3"><span class="mt-1 h-2 w-2 rounded-full bg-[var(--primary)]"></span><span>For security, reset links expire quickly and require 2FA when enabled.</span></li>
            <li class="flex items-start gap-3"><span class="mt-1 h-2 w-2 rounded-full bg-[var(--primary)]"></span><span>All recovery actions are logged for compliance reviews.</span></li>
          </ul>
          <p class="text-xs uppercase tracking-[0.28em] text-[rgba(255,255,255,0.6)]">SOC2-aligned recovery · manual verification · audit logged</p>
        </article>
      </section>
    </main>
  `
};
