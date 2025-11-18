import { onMounted, onUnmounted, nextTick } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: "NotificationsModal",
  props: {
    modelValue: { type: Boolean, default: false },
    items: { type: Array, default: () => [] }
  },
  emits: ["update:modelValue", "dismiss"],
  setup(props, { emit }) {
    let cleanup;
    const lockScroll = () => { document.documentElement.style.overflow = 'hidden'; };
    const unlockScroll = () => { document.documentElement.style.overflow = ''; };

    const close = () => {
      emit("update:modelValue", false);
      emit("dismiss");
      unlockScroll();
    };
    const onBackdrop = (e) => {
      if (e.target.classList.contains("notify-overlay")) close();
    };
    onMounted(async () => {
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      window.addEventListener('keydown', onKey);
      cleanup = () => window.removeEventListener('keydown', onKey);
    });
    onUnmounted(() => cleanup && cleanup());
    return { close, onBackdrop, lockScroll };
  },
  template: `
  <teleport to="body">
    <div v-if="modelValue" class="notify-overlay" @click="onBackdrop" role="dialog" aria-modal="true" aria-label="Notifications" @vue:mounted="lockScroll">
      <div class="notify-panel" role="document" tabindex="0" autofocus>
        <header class="notify-header">
          <button class="notify-back" @click="close" aria-label="Back">← Back</button>
          <h2 style="margin:0">Notifications</h2>
          <button class="notify-close" @click="close" aria-label="Close">✕</button>
        </header>
        <section class="notify-list" v-if="items && items.length">
          <article v-for="n in items" :key="n.id" class="notify-item">
            <div class="notify-item-title">{{ n.title }}</div>
            <div class="notify-item-body" v-if="n.body">{{ n.body }}</div>
            <div class="notify-item-time">{{ n.ts }}</div>
          </article>
        </section>
        <section v-else class="notify-empty">
          No notifications yet.
        </section>
      </div>
    </div>
  </teleport>
  `
};
