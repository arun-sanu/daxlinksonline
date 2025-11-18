import { ref, reactive, onMounted, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'AlertsPage',
  setup() {
    const loading = ref(true);
    const saving = ref(false);
    const saved = ref(false);
    const error = ref('');
    const testStatus = ref('');
    const prefs = reactive({
      tvSignals: false,
      botTrades: false,
      exchangeFills: false,
      errors: true,
      subscriptions: true,
      promotions: false
    });


    const topics = [
      { key: 'tvSignals', label: 'TradingView Signals', icon: '📈' },
      { key: 'botTrades', label: 'Bot Trades', icon: '🤖' },
      { key: 'exchangeFills', label: 'Exchange Fills', icon: '💱' },
      { key: 'errors', label: 'Errors & Crashes', icon: '⚠️' },
      { key: 'subscriptions', label: 'Subscriptions', icon: '💳' },
      { key: 'promotions', label: 'Promotions', icon: '📣' }
    ];

    const currentTab = ref('topics'); // 'topics' | 'channels'
    const isTopics = computed(() => currentTab.value === 'topics');
    const isChannels = computed(() => currentTab.value === 'channels');

    const mergePrefs = (incoming = {}) => {
      try {
        for (const k of Object.keys(prefs)) {
          prefs[k] = Boolean(incoming[k]);
        }
      } catch {}
    };

    const loadPrefs = async () => {
      loading.value = true; error.value = '';
      try {
        const res = await fetch('/api/v1/notify/preferences', { credentials: 'include' });
        const json = await res.json();
        if (!json?.ok) throw new Error('Failed to load preferences');
        mergePrefs(json.pref || {});
      } catch (e) {
        error.value = 'Failed to load preferences';
      } finally { loading.value = false; }
    };

    const save = async () => {
      saving.value = true; saved.value = false; error.value = '';
      try {
        await fetch('/api/v1/notify/preferences', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...prefs })
        });
        saved.value = true;
        setTimeout(() => { saved.value = false; }, 3000);
      } catch {
        error.value = 'Save failed';
      } finally { saving.value = false; }
    };

    const sendTest = async () => {
      testStatus.value = 'sending...';
      try {
        const res = await fetch('/api/debug/telegram-test', { credentials: 'include' });
        testStatus.value = res.ok ? 'Sent! Check Telegram' : 'Failed';
        setTimeout(() => { testStatus.value = ''; }, 4000);
      } catch { testStatus.value = 'Network error'; }
    };

    const goBack = () => {
      try { if (window && window.history && window.history.length > 0) { window.history.back(); return; } } catch {}
      try { window.location.hash = '#/overview'; } catch {}
    };

    onMounted(() => { loadPrefs(); });

    return { loading, saving, saved, error, testStatus, prefs, topics, save, sendTest, goBack, currentTab, isTopics, isChannels };
  },
  template: `
  <main class="layout-container py-10">
    <div v-if="loading">Loading…</div>
    <div v-else>
      <header class="alerts-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div>
          <h1 style="margin:0; font-weight:600;">Alerts & Channels</h1>
          <p class="muted" style="margin:4px 0 0;">Configure topics and delivery channels.</p>
        </div>
        <button class="notify-back" @click="goBack" aria-label="Back">← Back</button>
      </header>

      <nav class="tabs" role="tablist" aria-label="Alerts sections">
        <button :class="['tab-btn', isTopics ? 'is-active' : '']" role="tab" aria-selected="true" @click="currentTab='topics'">Topics</button>
        <button :class="['tab-btn', isChannels ? 'is-active' : '']" role="tab" aria-selected="false" @click="currentTab='channels'">Channels</button>
      </nav>

      <section v-if="isTopics" class="box" aria-labelledby="topics-head">
        <h3 id="topics-head" class="box-title">Alert Topics</h3>
        <div class="topic-box-grid">
          <div v-for="t in topics" :key="t.key" class="topic-box">
            <div class="topic-box__label">
              <span class="topic-box__icon">{{ t.icon }}</span>
              <span class="topic-box__text">{{ t.label }}</span>
            </div>
            <label class="toggle" :aria-label="'Toggle ' + t.label">
              <input
                type="checkbox"
                class="toggle-input"
                :checked="!!prefs[t.key]"
                @change="(e) => (prefs[t.key] = e.target.checked)"
              />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </div>
        </div>
      </section>

      <section v-if="isChannels" class="box" aria-labelledby="channels-head">
        <h3 id="channels-head" class="box-title">Active Channels</h3>
        <div class="row">
          <div class="col-label">Telegram Bot</div>
          <div class="col-action">
            <button @click="sendTest" class="btn btn-secondary btn-small">{{ testStatus || 'Send Test Alert' }}</button>
          </div>
        </div>
        <div class="row">
          <div class="col-label">Android App Push</div>
          <div class="col-action muted">Coming Q1 2026</div>
        </div>
      </section>

      <div class="actions-row">
        <button @click="save" :disabled="saving" class="btn btn-secondary">{{ saving ? 'Saving...' : (saved ? 'Saved ✓' : 'Save Configuration') }}</button>
        <span v-if="saved" class="muted" style="margin-left:8px;">Saved</span>
        <div v-if="error" class="error" style="margin-left:auto;">{{ error }}</div>
      </div>
    </div>
  </main>
  `
};
