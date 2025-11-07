export default {
  name: 'ResourceHub',
  inheritAttrs: false,
  props: {
    resources: {
      type: Array,
      default: () => []
    },
    roadmap: {
      type: Array,
      default: () => []
    }
  },
  template: `
    <section v-bind="$attrs" class="grid gap-10 section-pad lg:grid-cols-[1.35fr_1fr] lg:items-start">
      <div class="card-shell">
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-semibold text-main">Resource Hub</h2>
          <a href="https://daxlinks.online/docs" class="text-sm font-semibold" style="color: var(--primary);" target="_blank" rel="noopener">
            Browse Docs →
          </a>
        </div>
        <p class="mt-3 text-sm muted-text">
          A curated set of guides, templates, and support channels to accelerate development for your team.
        </p>
        <div class="mt-8 grid gap-6 md:grid-cols-2">
          <article
            v-for="resource in resources"
            :key="resource.title"
            class="card-shell flex flex-col"
          >
            <div class="flex h-12 w-12 items-center justify-center rounded-full" style="background: rgba(107,107,247,0.22); color: var(--primary);">
              <span class="text-xl">{{ resource.icon }}</span>
            </div>
            <h3 class="mt-4 text-lg font-semibold text-main">{{ resource.title }}</h3>
            <p class="mt-2 flex-1 text-sm muted-text">{{ resource.description }}</p>
            <a :href="resource.href" target="_blank" rel="noopener" class="mt-6 inline-flex items-center text-sm font-semibold" style="color: var(--primary);">
              {{ resource.linkLabel }}
              <svg xmlns="http://www.w3.org/2000/svg" class="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </article>
        </div>
      </div>
      <div class="card-shell">
        <h3 class="text-lg font-semibold text-main">Roadmap Highlights</h3>
        <p class="mt-3 text-sm muted-text">
          Upcoming milestones informed by community feedback. Vote on priorities in our Discord or email the team.
        </p>
        <div class="mt-6 space-y-5">
          <div
            v-for="item in roadmap"
            :key="item.quarter"
            class="card-shell"
          >
            <p class="text-xs uppercase tracking-[0.3em]" style="color: var(--primary);">{{ item.quarter }}</p>
            <ul class="mt-3 space-y-2 text-sm muted-text">
              <li
                v-for="plan in item.items"
                :key="plan"
                class="flex gap-3"
              >
                <span class="mt-1 h-1.5 w-1.5 rounded-full" style="background: var(--primary);"></span>
                <span>{{ plan }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `
};
