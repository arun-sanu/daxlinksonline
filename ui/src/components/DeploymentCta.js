export default {
  name: 'DeploymentCta',
  inheritAttrs: false,
  props: {
    onboarding: {
      type: Array,
      default: () => []
    }
  },
  template: `
    <section v-bind="$attrs">
      <div class="card-shell" style="display: flex; flex-direction: column; gap: 2rem; padding: 2.5rem;">
        <div class="flex-1">
          <h2 class="text-2xl font-semibold text-main">Ready to Start Building?</h2>
          <p class="mt-3 text-sm muted-text">
            Install the SDK, configure your exchange keys, and plug into high-frequency trading flows with ease. Join the community to influence our roadmap.
          </p>
          <div class="mt-6 flex flex-wrap gap-3 text-xs" style="color: var(--primary);">
            <span class="rounded-full" style="border: 1px solid var(--border); padding: 0.5rem 1rem; background: rgba(18,152,230,0.12);">npm install @daxlinks/sdk</span>
            <span class="rounded-full" style="border: 1px solid var(--border); padding: 0.5rem 1rem; background: rgba(18,152,230,0.12);">Socket resilience</span>
            <span class="rounded-full" style="border: 1px solid var(--border); padding: 0.5rem 1rem; background: rgba(18,152,230,0.12);">REST normalization</span>
          </div>
        </div>
        <div class="flex flex-1 flex-col gap-4 text-sm muted-text">
          <div class="card-shell">
            <h3 class="text-sm font-semibold text-main">Getting Started</h3>
            <ul class="mt-3 space-y-2 muted-text">
              <li v-for="step in onboarding" :key="step.step" class="flex items-center gap-3">
                <span class="flex h-6 w-6 items-center justify-center rounded-full" style="background: rgba(18,152,230,0.3); color: var(--text-main);">{{ step.step }}</span>
                <span>{{ step.label }}</span>
              </li>
            </ul>
          </div>
          <div class="card-shell">
            <h3 class="text-sm font-semibold text-main">Community</h3>
            <p class="mt-2 muted-text">
              Slack, Discord, Twitter, and Telegram spaces are available. Share feature requests and collaborate with builders shipping on DaxLinks.
            </p>
          </div>
        </div>
      </div>
    </section>
  `
};
