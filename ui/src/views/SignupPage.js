import { inject, computed, ref, watch, onMounted, onBeforeUnmount } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'SignupPage',
  setup() {
    const store = inject('dashboardStore');
    const actions = inject('dashboardActions');
    const submitting = computed(() => store.auth.status === 'registering');
    const authMessage = computed(() => store.auth.error || '');
    const showPassword = ref(false);
    const showConfirm = ref(false);

    const strength = computed(() => {
      const v = store.forms.authRegister.password || '';
      const checks = [
        v.length >= 8,
        /[a-z]/.test(v),
        /[A-Z]/.test(v),
        /\d/.test(v),
        /[^\w\s]/.test(v)
      ];
      const score = checks.reduce((a, ok) => a + (ok ? 1 : 0), 0);
      const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Elite'];
      const colors = ['#EF4444', '#F59E0B', '#F59E0B', '#10B981', '#22D3EE', '#A78BFA'];
      return {
        score,
        label: labels[Math.min(score, labels.length - 1)],
        color: colors[Math.min(score, colors.length - 1)]
      };
    });

    // Subtle glow when ready to submit
    const canSubmit = computed(() => {
      const f = store.forms.authRegister;
      return !!(f.name && f.email && f.password && f.confirmPassword && f.password === f.confirmPassword && f.password.length >= 8);
    });

    // Field-level quick validations
    const emailValid = computed(() => /.+@.+\..+/.test(store.forms.authRegister.email || ''));
    const passwordsMatch = computed(() => (store.forms.authRegister.password || '') === (store.forms.authRegister.confirmPassword || ''));
    const nameValid = computed(() => (store.forms.authRegister.name || '').trim().length >= 2);
    const passwordValid = computed(() => (store.forms.authRegister.password || '').length >= 8);
    const confirmValid = computed(() => !!store.forms.authRegister.confirmPassword && passwordsMatch.value && passwordValid.value);

    // Warnings inferred from server messages
    const existingMsg = computed(() => (store.auth.error || ''));
    const emailExistingWarning = computed(() => /exist|already|used/i.test(existingMsg.value) && /email|account/i.test(existingMsg.value));
    const nameExistingWarning = computed(() => /exist|already|used|taken/i.test(existingMsg.value) && /name|username/i.test(existingMsg.value));

    // Map per-field status to CSS class
    function fieldClassFor(field) {
      switch (field) {
        case 'name':
          if (nameExistingWarning.value) return 'field-warning';
          if (store.forms.authRegister.name && !nameValid.value) return 'field-error';
          if (nameValid.value) return 'field-success';
          return '';
        case 'email':
          if (emailExistingWarning.value) return 'field-warning';
          if (store.forms.authRegister.email && !emailValid.value) return 'field-error';
          if (emailValid.value) return 'field-success';
          return '';
        case 'password':
          if (store.forms.authRegister.password && !passwordValid.value) return 'field-error';
          if (passwordValid.value) return 'field-success';
          return '';
        case 'confirm':
          if (store.forms.authRegister.confirmPassword && !passwordsMatch.value) return 'field-error';
          if (confirmValid.value) return 'field-success';
          return '';
        default:
          return '';
      }
    }

    // 3D tilt
    const formRef = ref(null);
    const tiltStyle = ref('');
    let tiltRAF = null;
    function handleTilt(e) {
      const el = formRef.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const px = (x / rect.width) - 0.5; // -0.5..0.5
      const py = (y / rect.height) - 0.5;
      const max = 6; // deg
      const rx = -(py * max);
      const ry = px * max;
      cancelAnimationFrame(tiltRAF);
      tiltRAF = requestAnimationFrame(() => {
        tiltStyle.value = `transform: perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      });
    }
    function resetTilt() {
      cancelAnimationFrame(tiltRAF);
      tiltStyle.value = 'transform: perspective(1000px) rotateX(0deg) rotateY(0deg)';
    }

    // Constellation background (reduced-motion aware)
    const bgCanvas = ref(null);
    let stopConstellation = null;
    function startConstellation(canvas) {
      if (!canvas) return () => {};
      const ctx = canvas.getContext('2d');
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      let w = canvas.clientWidth;
      let h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.scale(dpr, dpr);
      const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const countTarget = Math.max(24, Math.min(90, Math.floor((w * h) / 16000)));

      const stars = Array.from({ length: countTarget }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.4 + 0.3
      }));

      let rafId; let running = true;
      function draw() {
        if (!running) return;
        ctx.clearRect(0, 0, w, h);
        // update
        if (!prefersReduced) {
          for (const s of stars) {
            s.x += s.vx; s.y += s.vy;
            if (s.x < -10) s.x = w + 10; if (s.x > w + 10) s.x = -10;
            if (s.y < -10) s.y = h + 10; if (s.y > h + 10) s.y = -10;
          }
        }
        // links
        for (let i = 0; i < stars.length; i++) {
          for (let j = i + 1; j < stars.length; j++) {
            const a = stars[i], b = stars[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 90) {
              ctx.globalAlpha = (1 - dist / 90) * 0.35;
              ctx.strokeStyle = '#89d8ff';
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }
        }
        // stars
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (const s of stars) {
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        rafId = requestAnimationFrame(draw);
      }

      function resize() {
        w = canvas.clientWidth; h = canvas.clientHeight;
        canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
      }

      // Use ResizeObserver when available; fall back to window resize
      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(resize);
        ro.observe(canvas);
      } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', resize);
      }
      draw();
      return () => {
        running = false;
        cancelAnimationFrame(rafId);
        if (ro && typeof ro.disconnect === 'function') {
          ro.disconnect();
        } else if (typeof window !== 'undefined') {
          window.removeEventListener('resize', resize);
        }
      };
    }

    // Confetti overlay when auth transitions to authenticated from signup
    const celebrate = ref(false);
    const confettiCanvas = ref(null);
    function runConfetti(canvas) {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.scale(dpr, dpr);
      const colors = ['#ffffff', '#89d8ff', '#6B6BF7', '#A78BFA', '#00ff9d'];
      const N = Math.min(140, Math.floor((w * h) / 18000));
      const parts = Array.from({ length: N }, () => ({
        x: Math.random() * w,
        y: -10 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 2 + Math.random() * 2,
        size: 3 + Math.random() * 3,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2
      }));
      let raf; let life = 0; const maxLife = 1800; // ~3s
      function step(ts) {
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

    // Watch for success
    let stopConfetti = null;
    watch(() => store.auth.status, (val, prev) => {
      if (val === 'authenticated' && prev === 'registering') {
        celebrate.value = true;
        // start confetti then auto-hide
        setTimeout(() => { celebrate.value = false; }, 2600);
      }
    });

    watch(celebrate, (on) => {
      if (on) {
        // small delay to ensure canvas is in DOM
        requestAnimationFrame(() => {
          stopConfetti = runConfetti(confettiCanvas.value);
        });
      } else if (stopConfetti) {
        stopConfetti();
        stopConfetti = null;
      }
    });

    onMounted(() => {
      // constellation
      const canvas = bgCanvas.value;
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) {
        stopConstellation = startConstellation(canvas);
      }
    });

    onBeforeUnmount(() => {
      if (stopConstellation) stopConstellation();
      resetTilt();
      if (stopConfetti) stopConfetti();
    });

    return { store, actions, submitting, authMessage, showPassword, showConfirm, strength, canSubmit, emailValid, passwordsMatch, formRef, tiltStyle, handleTilt, resetTilt, bgCanvas, celebrate, confettiCanvas, runConfetti, fieldClassFor };
  },
  template: `
    <main class="layout-container section-pad">
      <section class="grid items-start gap-12 lg:grid-cols-2">
        <!-- Plain text content, no glass panels -->
        <div class="space-y-4">
          <p class="hero-callout">Operator Access</p>
          <h1 class="headline">
            Begin <span class="headline-accent">Zero‑Friction</span> Operations
          </h1>
          <p class="muted-text max-w-xl">Provision workspaces, govern credentials, and stream telemetry in minutes. The console for builders who automate at the edge.</p>
        </div>

        <!-- Simple form (text only, no glass/tilt) -->
        <form class="space-y-6" @submit.prevent="actions.registerAccount">
          <header class="space-y-2">
            <h2 class="text-lg font-semibold text-main">Create your operator account</h2>
            <p class="text-sm muted-text">One identity for all workspaces and deployments.</p>
          </header>

          <div class="space-y-4">
            <div class="fl-group">
              <input :data-has-value="!!store.forms.authRegister.name" v-model="store.forms.authRegister.name" id="reg_name" type="text" :class="['field','fl-input','pr-10', fieldClassFor('name')]" autocomplete="name" />
              <label class="fl-label" for="reg_name">Full name</label>
            </div>

            <div class="fl-group">
              <input :data-has-value="!!store.forms.authRegister.email" v-model="store.forms.authRegister.email" id="reg_email" type="email" :class="['field','fl-input','pr-10', fieldClassFor('email')]" autocomplete="email" />
              <label class="fl-label" for="reg_email">Email</label>
              <p v-if="store.forms.authRegister.email && !emailValid" class="mt-2 text-xs" style="color:#F59E0B">That email looks off—mind checking the format?</p>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="fl-group">
                <input :data-has-value="!!store.forms.authRegister.password" :type="showPassword ? 'text' : 'password'" v-model="store.forms.authRegister.password" id="reg_password" :class="['field','fl-input','pr-10', fieldClassFor('password')]" autocomplete="new-password" />
                <label class="fl-label" for="reg_password">Password</label>
                <button type="button" @click="showPassword = !showPassword" class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-[var(--primary)]">{{ showPassword ? 'Hide' : 'Show' }}</button>
              </div>
              <div class="fl-group">
                <input :data-has-value="!!store.forms.authRegister.confirmPassword" :type="showConfirm ? 'text' : 'password'" v-model="store.forms.authRegister.confirmPassword" id="reg_confirm" :class="['field','fl-input','pr-10', fieldClassFor('confirm')]" autocomplete="new-password" />
                <label class="fl-label" for="reg_confirm">Confirm</label>
                <button type="button" @click="showConfirm = !showConfirm" class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-[var(--primary)]">{{ showConfirm ? 'Hide' : 'Show' }}</button>
              </div>
            </div>
          </div>

          <!-- Strength meter (text-only style) -->
          <div class="space-y-1">
            <div class="h-2 w-full rounded-full bg-white/5 storage-animated" aria-hidden="true">
              <div class="h-2 rounded-full" :style="{ width: (strength.score/5*100)+'%', background: strength.color }"></div>
            </div>
            <p class="text-xs text-gray-400">Strength: <span :style="{ color: strength.color }">{{ strength.label }}</span></p>
            <p v-if="store.forms.authRegister.confirmPassword" class="text-xs" :style="{ color: passwordsMatch ? '#10B981' : '#EF4444' }">{{ passwordsMatch ? 'Passwords match' : 'Passwords do not match' }}</p>
          </div>

          <div class="flex items-center justify-start gap-3">
            <button type="submit" class="btn btn-white-animated" :disabled="submitting">Create account</button>
            <button type="button" class="btn btn-secondary" @click="actions.loginWithGoogle">
              <span>Sign up with Google</span>
            </button>
          </div>

          <p v-if="authMessage" class="text-xs" style="color: var(--primary);">{{ authMessage }}</p>
          <p class="text-xs text-gray-500">Already onboard? <router-link :to="{ name: 'account' }" class="text-primary-200 underline">Sign in</router-link>.</p>
        </form>
      </section>
    </main>
  `
};
