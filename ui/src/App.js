import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  provide
} from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

import AppHeader from './components/AppHeader.js?v=20251105j';
import AppFooter from './components/AppFooter.js';
import UpgradeModal from './components/UpgradeModal.js';
import AlertRail from './components/AlertRail.js';
import { getConfig } from './services/config.js';
import * as apiClient from './services/apiClient.js?v=20251106c';
import { dashboardStore, applyInitialData, resetWebhookForm, resetAuthForms } from './stores/dashboardStore.js';

const DOC_LINK = 'https://daxlinks.online/docs';

function formatTimestamp(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function normalizeIntegration(profile) {
  if (!profile) return profile;
  if (profile.name && Object.prototype.hasOwnProperty.call(profile, 'connected')) {
    return profile;
  }
  const exchange = profile.exchange || profile.id || 'integration';
  const uppercase = typeof exchange === 'string' ? exchange.toUpperCase() : 'INTEGRATION';
  return {
    id: profile.id || exchange,
    exchange,
    name: profile.label || profile.name || uppercase,
    description: profile.description || '',
    type: profile.type || `${uppercase} Adapter`,
    environment: profile.environment || 'paper',
    apiKey: profile.apiKeyMasked || profile.apiKey || '••••••••',
    apiSecret: profile.apiSecretMasked || profile.apiSecret || '••••••••',
    passphrase: profile.passphraseMasked || profile.passphrase || '',
    requiresPassphrase: Boolean(profile.passphraseMasked || profile.requiresPassphrase),
    rateLimit: profile.rateLimit ?? 5,
    bandwidth: profile.bandwidth ?? '1.0 Mbps',
    connected: profile.status ? profile.status === 'active' : profile.connected ?? false,
    lastRotated: profile.lastRotated || formatTimestamp(profile.lastTestedAt)
  };
}

function normalizeCredentialEvent(event) {
  if (!event) return event;
  if (event.title && event.detail) {
    return event;
  }
  return {
    id: event.id,
    integrationId: event.integrationId || null,
    title: event.eventType || 'Credential Event',
    detail: event.detail || '',
    time: formatTimestamp(event.createdAt)
  };
}

function normalizeWebhook(webhook) {
  if (!webhook) return webhook;
  if (webhook.lastDelivery !== undefined && webhook.retries !== undefined) {
    return webhook;
  }
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    method: webhook.method || 'POST',
    events: webhook.events || [],
    active: webhook.active ?? true,
    lastDelivery: webhook.lastDeliveryAt ? formatTimestamp(webhook.lastDeliveryAt) : 'Pending',
    retries: webhook.retries ?? 0
  };
}

function normalizeDashboardData(data = {}) {
  const normalized = { ...data };
  if (Array.isArray(normalized.integrationProfiles)) {
    normalized.integrationProfiles = normalized.integrationProfiles.map(normalizeIntegration);
  }
  if (Array.isArray(normalized.credentialEvents)) {
    normalized.credentialEvents = normalized.credentialEvents.map(normalizeCredentialEvent);
  }
  if (Array.isArray(normalized.webhooks)) {
    normalized.webhooks = normalized.webhooks.map(normalizeWebhook);
  }
  if (Array.isArray(normalized.recentSessions)) {
    normalized.recentSessions = normalized.recentSessions.map((session) => {
      if (session.time) {
        return session;
      }
      return {
        ...session,
        time: formatTimestamp(session.createdAt)
      };
    });
  }
  return normalized;
}

export default {
  name: 'App',
  components: {
    AppHeader,
    AppFooter,
    AlertRail,
    UpgradeModal
  },
  setup() {
    const configuration = getConfig();
    const store = dashboardStore;
    const isLoggedIn = computed(() => Boolean(store?.auth?.user));
    const navigation = computed(() => {
      return [
        { label: 'Overview', name: 'overview' },
        { label: 'Account', name: 'account' },
        { label: 'Platform', name: 'platform' }
      ];
    });

    const mobileMenuOpen = ref(false);
    const toggleMobileMenu = () => {
      mobileMenuOpen.value = !mobileMenuOpen.value;
    };
    const closeMobileMenu = () => {
      mobileMenuOpen.value = false;
    };

    let channelTimer = null;
    const loading = computed(() => store.loading);
    const activeApi = ref(apiClient);

    const authStorageKey = 'daxlinksToken';

    const setAuthState = (token, user, webhook) => {
      store.auth.token = token;
      store.auth.user = user;
      if (webhook) {
        // attach webhook summary onto user for easy access
        store.auth.user.webhook = webhook;
        store.auth.webhook = webhook;
      }
      store.auth.status = 'authenticated';
      store.auth.error = null;
      apiClient.setAuthToken(token);
      if (typeof window !== 'undefined') {
        window.__appAuthToken__ = token;
        window.__lastUser__ = user;
      }
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem(authStorageKey, token);
      }
    };

    const clearAuthState = () => {
      store.auth.token = null;
      store.auth.user = null;
      store.auth.status = 'logged-out';
      store.auth.error = null;
      apiClient.clearAuthToken?.();
      apiClient.setAuthToken(null);
      if (typeof window !== 'undefined') {
        window.localStorage?.removeItem(authStorageKey);
        window.__appAuthToken__ = null;
        window.__lastUser__ = null;
      }
    };

    const initializeAuth = async () => {
      const storedToken = typeof window !== 'undefined' ? window.localStorage?.getItem(authStorageKey) : null;
      if (!storedToken) {
        clearAuthState();
        return;
      }
      apiClient.setAuthToken(storedToken);
      store.auth.token = storedToken;
      try {
        const profile = await apiClient.fetchCurrentUser();
        // profile may include webhook
        store.auth.user = profile;
        store.auth.status = 'authenticated';
        if (typeof window !== 'undefined') {
          window.__appAuthToken__ = storedToken;
          window.__lastUser__ = profile;
        }
      } catch (error) {
        console.warn('[Auth] Failed to restore session', error);
        clearAuthState();
      }
    };

    const loadDashboard = async () => {
      const apiUsed = activeApi.value;
      try {
        // Skip bootstrap until authenticated to avoid 401 noise
        if (!store.auth?.token) {
          return;
        }
        store.loading = true;
        const data = await apiUsed.fetchInitialData();
        applyInitialData(normalizeDashboardData(data));
      } catch (error) {
        console.error('[App] Failed to load dashboard data', error);
        // Do not throw — some views (e.g., DNS) don't require workspace bootstrap
      } finally {
        store.loading = false;
      }
    };

    const refreshDashboard = async () => {
      try {
        const data = await activeApi.value.fetchInitialData();
        applyInitialData(normalizeDashboardData(data));
      } catch (error) {
        console.error('[App] Unable to refresh dashboard data', error);
      }
    };

    const upgradeModalRef = ref(null);

    onMounted(async () => {
      try {
        await initializeAuth();
        // Load workspace bootstrap only when workspaceId is configured
        try {
          const cfg = getConfig();
          if (cfg.workspaceId) {
            await loadDashboard();
          } else {
            // No workspace bootstrap needed; ensure UI unblocks
            store.loading = false;
          }
        } catch {
          store.loading = false;
        }
      } catch (error) {
        console.error('[App] Initialization failed', error);
      }

      // Open upgrade modal if close to expiry
      try { upgradeModalRef.value?.openIfNeeded?.(); } catch {}

      // Live mode: no synthetic metric jittering
    });

    onBeforeUnmount(() => {
      if (channelTimer) {
        clearInterval(channelTimer);
      }
    });

    const submitRegistration = async () => {
      if (!store.auth.user) {
        store.auth.error = 'Please sign in before creating a workspace.';
        console.warn('[App] Workspace provisioning requires authentication.');
        return;
      }
      if (!store.forms.register.fullName || !store.forms.register.email || !store.forms.register.acceptTerms) {
        console.warn('Registration requires name, email, and terms acceptance.');
        return;
      }
      const payload = JSON.parse(JSON.stringify(store.forms.register));
      try {
        const api = activeApi.value;
        const result = await api.submitRegistration(payload);
        console.log('[App] Registered workspace', result);
        await refreshDashboard();
      } catch (error) {
        console.error('[App] Workspace registration failed', error);
      }
    };

    const testIntegration = async (profile) => {
      try {
        const response = await activeApi.value.triggerIntegrationTest(profile.id);
        profile.connected = response?.status === 'connected';
        profile.lastRotated = response?.rotatedAt ?? profile.lastRotated;
        console.log('[App] Tested integration', profile.id, response);
      } catch (error) {
        console.error('[App] Integration test failed', profile.id, error);
      }
    };

    const addWebhook = async () => {
      if (!store.forms.webhook.name || !store.forms.webhook.url) {
        console.warn('Webhook requires name and URL.');
        return;
      }
      const payload = {
        name: store.forms.webhook.name,
        method: store.forms.webhook.method,
        url: store.forms.webhook.url,
        events: [store.forms.webhook.event],
        secret: store.forms.webhook.secret,
        notes: store.forms.webhook.notes,
        storePayload: store.forms.webhook.storePayload
      };
      try {
        const api = activeApi.value;
        const created = await api.createWebhook(payload);
        store.webhooks.unshift(normalizeWebhook(created));
        await refreshDashboard();
      } catch (error) {
        console.error('[App] Failed to create webhook', error);
        return;
      }
      resetWebhookForm();
    };

    const toggleWebhook = (hook) => {
      const nextState = !hook.active;
      hook.active = nextState;
      if (typeof activeApi.value.toggleWebhook === 'function' && hook.id) {
        activeApi.value.toggleWebhook(hook.id, nextState).catch((error) => {
          console.error('[App] Failed to toggle webhook', error);
          hook.active = !nextState;
        });
      }
    };

    const selectNode = (id) => {
      store.selectedNodeId = id;
    };

    const formatMetricLabel = (key) =>
      key
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .trim();

    const setInsightsView = (view) => {
      store.insightsView = view;
    };

    const connectIntegration = async (payload) => {
      try {
        const api = activeApi.value;
        const created = await api.createIntegration(payload);
        store.integrationProfiles.unshift(normalizeIntegration(created));
        await refreshDashboard();
      } catch (error) {
        console.error('[App] Failed to create integration', error);
      }
    };

    const registerAccount = async () => {
      const form = store.forms.authRegister;
      store.auth.error = null;
      if (!form.name || !form.email || !form.password) {
        store.auth.error = 'Name, email, and password are required.';
        return;
      }
      if (form.password.length < 8) {
        store.auth.error = 'Password must be at least 8 characters.';
        return;
      }
      if (form.password !== form.confirmPassword) {
        store.auth.error = 'Passwords do not match.';
        return;
      }
      try {
        store.auth.status = 'registering';
        const result = await apiClient.registerAccount({
          name: form.name,
          email: form.email,
          password: form.password
        });
        setAuthState(result.token, result.user, result.webhook);
        resetAuthForms();
        await refreshDashboard();
        console.log('[Auth] Registration successful');
      } catch (error) {
        console.error('[Auth] Registration failed', error);
        store.auth.status = 'error';
        store.auth.error = error?.message || 'Registration failed.';
      }
    };

    const loginAccount = async () => {
      const form = store.forms.authLogin;
      store.auth.error = null;
      if (!form.username || !form.password) {
        store.auth.error = 'Username and password are required.';
        return;
      }
      try {
        store.auth.status = 'logging-in';
        const result = await apiClient.portalLogin({
          username: form.username,
          password: form.password
        });
        setAuthState(result.token, result.user);
        resetAuthForms();
        await refreshDashboard();
        console.log('[Auth] Login successful');
        try {
          const u = result.user || {};
          const isAdmin = !!u.isSuperAdmin || String(u.role||'').toLowerCase() === 'admin';
          if (isAdmin) {
            if (typeof window !== 'undefined') window.location.hash = '#/admin';
            return;
          }
        } catch {}
      } catch (error) {
        console.error('[Auth] Login failed', error);
        store.auth.status = 'error';
        store.auth.error = error?.message || 'Login failed.';
      }
    };

    const requestPasswordReset = async () => {
      const form = store.forms.forgot;
      store.auth.error = null;
      if (!form.email) {
        store.auth.error = 'Enter the email associated with your account.';
        return;
      }
      try {
        store.auth.status = 'resetting';
        const api = activeApi.value;
        if (typeof api.requestPasswordReset === 'function') {
          await api.requestPasswordReset({ email: form.email });
        }
        store.auth.status = 'reset-requested';
        form.email = '';
        console.log('[Auth] Password reset requested');
      } catch (error) {
        console.error('[Auth] Password reset request failed', error);
        store.auth.status = 'error';
        store.auth.error = error?.message || 'Unable to process reset request.';
      }
    };

    const completePasswordReset = async ({ token: resetToken, password: resetPasswordValue }) => {
      store.auth.error = null;
      if (!resetToken || !resetPasswordValue) {
        store.auth.error = 'Reset token and new password are required.';
        return;
      }
      try {
        store.auth.status = 'resetting';
        const api = activeApi.value;
        if (typeof api.resetPassword === 'function') {
          const result = await api.resetPassword({ token: resetToken, password: resetPasswordValue });
          if (result?.token && result?.user) {
            setAuthState(result.token, result.user);
            await refreshDashboard();
          }
        }
        store.auth.status = 'authenticated';
        console.log('[Auth] Password reset complete');
      } catch (error) {
        console.error('[Auth] Password reset failed', error);
        store.auth.status = 'error';
        store.auth.error = error?.message || 'Unable to reset password.';
      }
    };

    const loginWithGoogle = async () => {
      store.auth.error = null;
      try {
        const callbackUrl = typeof window !== 'undefined' ? window.location.href : configuration.apiBaseUrl;
        const result = await apiClient.initiateGoogleSignIn({ callbackUrl });
        if (result?.redirect && result.url) {
          window.location.href = result.url;
          return;
        }
        if (result?.user && result?.token) {
          setAuthState(result.token, result.user);
          resetAuthForms();
        await refreshDashboard();
          console.log('[Auth] Google sign-in successful');
          return;
        }
        store.auth.error = 'Waiting for Google to respond. If nothing happens, refresh and try again.';
      } catch (error) {
        console.error('[Auth] Google sign-in failed', error);
        store.auth.error = error?.message || 'Google sign-in failed.';
      }
    };

    const logoutAccount = () => {
      clearAuthState();
      resetAuthForms();
    };

    provide('docLink', DOC_LINK);
    // Expose UI mode so headers/components can label Client vs Admin
    const uiMode = configuration.uiMode || 'client';
    provide('dashboardStore', store);
    provide('dashboardActions', {
      submitRegistration,
      testIntegration,
      addWebhook,
      toggleWebhook,
      selectNode,
      setInsightsView,
      formatMetricLabel,
      connectIntegration,
      registerAccount,
      loginAccount,
      requestPasswordReset,
      completePasswordReset,
      loginWithGoogle,
      logoutAccount
    });

    return {
      docLink: DOC_LINK,
      navigation,
      mobileMenuOpen,
      toggleMobileMenu,
      closeMobileMenu,
      loading,
      uiMode,
      upgradeModalRef,
      isLoggedIn
    };
  },
  template: `
    <div class="app-shell">
      <AppHeader
        :navigation="navigation"
        :mobile-menu-open="mobileMenuOpen"
        :ui-mode="uiMode"
        @toggle-mobile="toggleMobileMenu"
        @close-mobile="closeMobileMenu"
      />
      <AlertRail v-if="isLoggedIn" />
      <router-view />
      <UpgradeModal ref="upgradeModalRef" />
      <AppFooter />
    </div>
  `
};
