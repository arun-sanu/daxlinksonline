import { inject, reactive, watchEffect } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { useRoute, useRouter } from 'https://unpkg.com/vue-router@4/dist/vue-router.esm-browser.js';

export default {
  name: 'ResetPage',
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const route = useRoute();
    const router = useRouter();

    const state = reactive({
      token: '',
      password: '',
      confirmPassword: '',
      submitted: false
    });

    watchEffect(() => {
      const token = route.query.token;
      if (typeof token === 'string') {
        state.token = token;
      }
    });

    const submit = async () => {
      store.auth.error = null;
      if (!state.token) {
        store.auth.error = 'Reset token missing. Check the link you received.';
        return;
      }
      if (!state.password || state.password.length < 8) {
        store.auth.error = 'Password must be at least 8 characters.';
        return;
      }
      if (state.password !== state.confirmPassword) {
        store.auth.error = 'Passwords do not match.';
        return;
      }
      await actions.completePasswordReset({ token: state.token, password: state.password });
      if (!store.auth.error) {
        state.submitted = true;
        router.replace({ name: 'account' });
      }
    };

    return { store, state, submit };
  },
  template: `
    <main class="layout-container section-pad">
      <section class="mx-auto max-w-2xl space-y-6">
        <header class="space-y-2 text-center">
          <p class="text-xs uppercase tracking-[0.32em] muted-text">Set new password</p>
          <h1 class="text-3xl font-semibold text-main">Secure your DaxLinks account</h1>
          <p class="text-sm muted-text">Create a new password for continued access to your workspaces.</p>
        </header>
        <form class="card-shell space-y-5" @submit.prevent="submit">
          <label class="flex flex-col gap-2 text-sm muted-text">
            New password
            <input v-model="state.password" type="password" placeholder="••••••••" class="field" required />
          </label>
          <label class="flex flex-col gap-2 text-sm muted-text">
            Confirm password
            <input v-model="state.confirmPassword" type="password" placeholder="••••••••" class="field" required />
          </label>
          <button type="submit" class="btn btn-primary w-full">Update password</button>
          <p v-if="store.auth.error" class="text-xs text-center" style="color: var(--primary);">{{ store.auth.error }}</p>
        </form>
        <div class="text-center text-xs muted-text">
          Done? <router-link :to="{ name: 'account' }" class="text-primary-200">Return to the console</router-link>
        </div>
      </section>
    </main>
  `
};
