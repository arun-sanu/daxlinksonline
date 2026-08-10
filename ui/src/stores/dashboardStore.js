import { reactive } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { DEFAULT_EXCHANGES } from '../services/exchanges.js';

export const dashboardStore = reactive({
  loading: true,
  metrics: { exchanges: 0, endpoints: '—' },
  webcast: { channels: [] },
  auth: {
    user: null,
    token: null,
    status: 'idle',
    error: null
  },
  forms: {
    register: {
      fullName: '',
      email: '',
      organization: '',
      slug: '',
      plan: 'Professional',
      teamSize: '1-5',
      useCase: 'signals',
      region: 'amer',
      acceptTerms: false
    },
    webhook: {
      name: '',
      url: '',
      method: 'POST',
      secret: '',
      event: 'signal.triggered',
      notes: '',
      storePayload: false
    },
    authRegister: {
      name: '',
      email: '',
      password: '',
      confirmPassword: ''
    },
    authLogin: {
      username: '',
      password: ''
    },
    forgot: {
      email: ''
    }
  },
  planOptions: [],
  teamSizes: [],
  accessPolicies: [],
  recentSessions: [],
  integrationProfiles: [],
  availableExchanges: [...DEFAULT_EXCHANGES],
  credentialEvents: [],
  webhooks: [],
  webhookEvents: [],
  workflowSummary: { signalsPerMinute: 0, signalThrottle: '—', orderThroughput: 0, connectedExchanges: 0 },
  dataflowNodes: [],
  selectedNodeId: '',
  insights: {},
  insightsView: 'rest',
  resources: [],
  roadmap: [],
  onboarding: []
});

export function applyInitialData(data) {
  if (!data) return;
  if (data.metrics) dashboardStore.metrics = data.metrics;
  if (data.webcastChannels) dashboardStore.webcast.channels = data.webcastChannels;
  if (data.planOptions) dashboardStore.planOptions = data.planOptions;
  if (data.teamSizes) dashboardStore.teamSizes = data.teamSizes;
  if (data.accessPolicies) dashboardStore.accessPolicies = data.accessPolicies;
  if (data.recentSessions) dashboardStore.recentSessions = data.recentSessions;
  if (data.integrationProfiles) dashboardStore.integrationProfiles = data.integrationProfiles;
  if (data.availableExchanges) dashboardStore.availableExchanges = data.availableExchanges;
  if (data.credentialEvents) dashboardStore.credentialEvents = data.credentialEvents;
  if (data.webhooks) dashboardStore.webhooks = data.webhooks;
  if (data.webhookEvents) dashboardStore.webhookEvents = data.webhookEvents;
  if (data.workflowSummary) dashboardStore.workflowSummary = data.workflowSummary;
  if (data.dataflowNodes) {
    dashboardStore.dataflowNodes = data.dataflowNodes;
    if (!dashboardStore.selectedNodeId && data.dataflowNodes.length) {
      dashboardStore.selectedNodeId = data.dataflowNodes[0].id;
    }
  }
  if (data.insights) dashboardStore.insights = data.insights;
  if (data.resources) dashboardStore.resources = data.resources;
  if (data.roadmap) dashboardStore.roadmap = data.roadmap;
  if (data.onboarding) dashboardStore.onboarding = data.onboarding;
  dashboardStore.loading = false;
}

export function resetRegisterForm() {
  dashboardStore.forms.register = {
    fullName: '',
    email: '',
    organization: '',
    slug: '',
    plan: 'Professional',
    teamSize: '1-5',
    useCase: 'signals',
    region: 'amer',
    acceptTerms: false
  };
}

export function resetWebhookForm() {
  dashboardStore.forms.webhook = {
    name: '',
    url: '',
    method: 'POST',
    secret: '',
    event: 'signal.triggered',
    notes: '',
    storePayload: false
  };
}

export function resetAuthForms() {
  dashboardStore.forms.authRegister = {
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  };
  dashboardStore.forms.authLogin = {
    username: '',
    password: ''
  };
  dashboardStore.forms.forgot = {
    email: ''
  };
}
