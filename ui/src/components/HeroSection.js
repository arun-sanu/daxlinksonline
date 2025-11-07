export default {
  name: 'HeroSection',
  props: {
    metrics: {
      type: Object,
      default: () => ({})
    },
    webcast: {
      type: Object,
      default: () => ({ channels: [] })
    },
    docLink: {
      type: String,
      default: '#'
    }
  },
  template: `
    <section id="hero" class="relative overflow-hidden">
      <div class="absolute inset-0 pointer-events-none" style="background: radial-gradient(circle at 12% 14%, rgba(107,107,247,0.32), transparent 60%);"></div>
      <div class="layout-container hero-grid relative">
        <div class="fade-up" style="animation-delay: 80ms;">
          <span class="hero-callout">Automation Stack</span>
          <h1 class="headline mt-5">
            Build <span class="headline-accent">Trade Infrastructure</span> that never sleeps
          </h1>
          <p class="mt-5 max-w-xl text-base muted-text">
            Ship AI-driven execution, webhook orchestration, and compliance ready workflows from a single console. Guardrails, credentials, and telemetry are wired in from the start.
          </p>
          <div class="hero-cta-stack mt-10">
            <a
              :href="docLink"
              target="_blank"
              rel="noopener"
              class="btn btn-primary"
            >
              Get Started
            </a>
          </div>
          <dl class="hero-stats">
            <div class="stat-tile">
              <dt>Supported Exchanges</dt>
              <dd>{{ metrics.exchanges }}+</dd>
            </div>
            <div class="stat-tile">
              <dt>Unified Endpoints</dt>
              <dd>{{ metrics.endpoints }}</dd>
            </div>
            <div class="stat-tile">
              <dt>Signal Throughput</dt>
              <dd>250k/min</dd>
            </div>
          </dl>
        </div>
        <div class="relative fade-up" style="animation-delay: 160ms;">
          <div class="hero-panel p-7">
            <div class="flex items-center justify-between text-xs muted-text">
              <span>Live Socket Monitor</span>
              <span class="flex items-center gap-2" style="color: var(--primary);">
                <span class="h-2 w-2 animate-pulse rounded-full" style="background: #34D399;"></span>
                Connected
              </span>
            </div>
            <div class="mt-5 space-y-4">
              <div
                v-for="channel in webcast.channels"
                :key="channel.id"
                class="card-shell flex items-center justify-between p-4"
              >
                <div>
                  <div class="section-label" style="letter-spacing: 0.24em;">{{ channel.exchange }}</div>
                  <div class="mt-1 text-sm font-semibold text-main">{{ channel.channel }}</div>
                </div>
                <div class="text-xs muted-text">
                  {{ channel.updates }} updates/min
                </div>
              </div>
            </div>
            <p class="mt-5 text-xs muted-text">
              Socket resilience, auto login, and heartbeat watchdogs are wired in—extend the handlers to stream your own telemetry.
            </p>
          </div>
          <div class="float-orb"></div>
        </div>
      </div>
    </section>
  `
};
