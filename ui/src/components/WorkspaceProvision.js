export default {
  name: 'WorkspaceProvision',
  inheritAttrs: false,
  props: {
    forms: {
      type: Object,
      default: () => ({ register: {} })
    },
    planOptions: {
      type: Array,
      default: () => []
    },
    teamSizes: {
      type: Array,
      default: () => []
    },
    accessPolicies: {
      type: Array,
      default: () => []
    },
    recentSessions: {
      type: Array,
      default: () => []
    }
  },
  emits: ['register'],
  template: `
    <section v-bind="$attrs" class="space-y-10 section-pad">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-semibold text-main">Workspace Provisioning</h2>
          <p class="mt-2 text-sm muted-text">Register operators, assign roles, and bootstrap a secure DaxLinks workspace before connecting exchanges.</p>
        </div>
        <button class="btn btn-secondary">Invite Teammate →</button>
      </div>
      <div class="grid gap-8 xl:grid-cols-[1.3fr_1fr]">
        <form class="card-shell space-y-6">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-main">Register Operator</h3>
            <span class="section-label" style="color: var(--primary);">Step 1 · Access</span>
          </div>
          <div class="grid gap-5 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-sm muted-text">
              Full Name
              <input
                v-model="forms.register.fullName"
                type="text"
                placeholder="Jane Doe"
                class="field"
              />
            </label>
            <label class="flex flex-col gap-2 text-sm muted-text">
              Email
              <input
                v-model="forms.register.email"
                type="email"
                placeholder="jane@desk.trading"
                class="field"
              />
            </label>
          </div>
          <div class="grid gap-5 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-sm muted-text">
              Organization
              <input
                v-model="forms.register.organization"
                type="text"
                placeholder="Compendium Trading Desk"
                class="field"
              />
            </label>
            <label class="flex flex-col gap-2 text-sm muted-text">
              Workspace Slug
              <div class="flex items-center overflow-hidden" style="border: 1px solid var(--border); border-radius: 16px;">
                <span class="px-3 text-xs uppercase tracking-[0.3em] muted-text">daxlinks.online/</span>
                <input
                  v-model="forms.register.slug"
                  type="text"
                  placeholder="compendium"
                  class="field"
                  style="border: none; border-radius: 0; padding: 0.85rem 1rem;"
                />
              </div>
            </label>
          </div>
          <div class="grid gap-5 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-sm muted-text">
              Plan Tier
              <select
                v-model="forms.register.plan"
                class="field"
              >
                <option v-for="option in planOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
            <label class="flex flex-col gap-2 text-sm muted-text">
              Team Size
              <select
                v-model="forms.register.teamSize"
                class="field"
              >
                <option v-for="size in teamSizes" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
          </div>
          <div class="grid gap-5 md:grid-cols-2">
            <label class="flex flex-col gap-2 text-sm muted-text">
              Primary Use Case
              <select
                v-model="forms.register.useCase"
                class="field"
              >
                <option value="signals">TradingView Signals</option>
                <option value="execution">Execution Engine</option>
                <option value="analytics">Analytics & Reporting</option>
                <option value="automation">Automation & Bots</option>
              </select>
            </label>
            <label class="flex flex-col gap-2 text-sm muted-text">
              Region
              <select
                v-model="forms.register.region"
                class="field"
              >
                <option value="amer">Americas</option>
                <option value="emea">EMEA</option>
                <option value="apac">APAC</option>
              </select>
            </label>
          </div>
          <label class="flex items-center gap-3 text-xs muted-text">
            <input
              type="checkbox"
              v-model="forms.register.acceptTerms"
              class="h-4 w-4"
              style="border: 1px solid var(--border); background: transparent; accent-color: var(--primary); border-radius: 6px;"
            />
            I confirm that our use complies with exchange API terms, rate limits, and jurisdictional policies.
          </label>
          <div class="flex flex-wrap items-center gap-4">
            <button
              type="button"
              @click="$emit('register')"
              class="btn btn-primary"
            >
              Register Workspace
            </button>
            <span class="text-xs muted-text">Next: connect exchanges & set webhook endpoints</span>
          </div>
        </form>
        <div class="space-y-6">
          <div class="card-shell">
            <h3 class="text-sm font-semibold text-main">Access Policies</h3>
            <ul class="mt-4 space-y-3 text-sm muted-text">
              <li
                v-for="policy in accessPolicies"
                :key="policy.id"
                class="card-shell"
              >
                <div class="flex items-center justify-between text-xs uppercase tracking-[0.3em] muted-text">
                  <span>{{ policy.name }}</span>
                  <span>{{ policy.updated }}</span>
                </div>
                <p class="mt-2 text-sm muted-text">{{ policy.description }}</p>
              </li>
            </ul>
          </div>
          <div class="card-shell">
            <h3 class="text-sm font-semibold text-main">Recent Admin Sessions</h3>
            <ul class="mt-4 space-y-3 text-xs muted-text">
              <li
                v-for="session in recentSessions"
                :key="session.id"
                class="card-shell flex items-start justify-between"
              >
                <div>
                  <p class="text-sm text-main">{{ session.location }}</p>
                  <p class="mt-1 text-xs muted-text">{{ session.device }}</p>
                </div>
                <div class="text-right">
                  <p>{{ session.ip }}</p>
                  <p class="mt-1" style="color: var(--primary);">{{ session.time }}</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `
};
