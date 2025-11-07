import { createRouter, createWebHashHistory } from 'https://unpkg.com/vue-router@4/dist/vue-router.esm-browser.js';

import OverviewPage from './views/OverviewPage.js?v=20251105h';
import AccountPage from './views/AccountPage.js?v=20251106b';
import AdminLoginPage from './views/AdminLoginPage.js?v=20251106a';
import SignupPage from './views/SignupPage.js?v=20251105h';
import ForgotPage from './views/ForgotPage.js?v=20251105h';
import ResetPage from './views/ResetPage.js?v=20251105h';
import PlatformPage from './views/PlatformPage.js?v=20251105h';
import IntegrationsPage from './views/IntegrationsPage.js?v=20251105h';
import ExchangeDetailPage from './views/ExchangeDetailPage.js?v=20251106a';
import ExchangeLogsPage from './views/ExchangeLogsPage.js?v=20251106a';
import WebhooksPage from './views/WebhooksPage.js?v=20251105h';
import WorkflowPage from './views/WorkflowPage.js?v=20251105h';
import MonitoringPage from './views/MonitoringPage.js?v=20251105h';
import ResourcesPage from './views/ResourcesPage.js?v=20251105h';
import TradeBotsPage from './views/TradeBotsPage.js?v=20251105h';
import BankingPage from './views/BankingPage.js?v=20251105h';
import DnsPage from './views/DnsPage.js?v=20251105h';
import DeploymentPage from './views/DeploymentPage.js?v=20251105h';
import DatabasePage from './views/DatabasePage.js?v=20251105h';
import DatabasesView from './views/DatabasesView.js?v=20251105h';
import DatabaseDetailView from './views/DatabaseDetailView.js?v=20251105h';
import VpnPage from './views/VpnPage.js?v=20251105h';
import SupportPage from './views/SupportPage.js?v=20251105h';
import IntelligentVisualizationsPage from './views/IntelligentVisualizationsPage.js?v=20251105h';
import ArPage from './views/ArPage.js?v=20251105h';
import ChartPage from './views/ChartPage.js?v=20251105h';
import AdminLayout from './admin/AdminLayout.js?v=20251105h';
import AdminHome from './admin/AdminHome.js?v=20251105h';
import UsersRoles from './admin/UsersRoles.js?v=20251105h';
import DatabasesAdmin from './admin/DatabasesAdmin.js?v=20251105h';
import WebhooksAdmin from './admin/WebhooksAdmin.js?v=20251105i';
import QueuesAdmin from './admin/QueuesAdmin.js?v=20251105h';
import FlagsAdmin from './admin/FlagsAdmin.js?v=20251105h';
import AuditLog from './admin/AuditLog.js?v=20251105h';
import SecretsAdmin from './admin/SecretsAdmin.js';
import ApiExplorer from './admin/ApiExplorer.js';
import IncidentsAdmin from './admin/IncidentsAdmin.js';

const routes = [
  { path: '/', redirect: { name: 'overview' } },
  { path: '/overview', name: 'overview', component: OverviewPage },
  { path: '/account', name: 'account', component: AccountPage },
  { path: '/admin-login', name: 'admin-login', component: AdminLoginPage },
  { path: '/signup', name: 'signup', component: SignupPage, beforeEnter: (to, from, next) => {
    try {
      const enabled = typeof window !== 'undefined' && window.__DAXLINKS_CONFIG__ && window.__DAXLINKS_CONFIG__.enableRegistration === true;
      if (!enabled) return next({ name: 'overview' });
    } catch {}
    return next();
  } },
  { path: '/forgot', name: 'forgot', component: ForgotPage },
  { path: '/reset', name: 'reset', component: ResetPage },
  { path: '/platform', name: 'platform', component: PlatformPage },
  { path: '/integrations', name: 'integrations', component: IntegrationsPage },
  { path: '/integrations/:exchangeId/logs', name: 'exchange-logs', component: ExchangeLogsPage },
  { path: '/integrations/:exchangeId', name: 'exchange-detail', component: ExchangeDetailPage },
  { path: '/webhooks', name: 'webhooks', component: WebhooksPage },
  { path: '/workflow', name: 'workflow', component: WorkflowPage },
  { path: '/monitoring', name: 'monitoring', component: MonitoringPage },
  { path: '/resources', name: 'resources', component: ResourcesPage },
  { path: '/trade-bots', name: 'trade-bots', component: TradeBotsPage },
  { path: '/banking', name: 'banking', component: BankingPage },
  { path: '/dns', name: 'dns', component: DnsPage },
  { path: '/deployment', name: 'deployment', component: DeploymentPage },
  { path: '/database', name: 'database', component: DatabasePage },
  { path: '/databases', name: 'databases', component: DatabasesView },
  { path: '/databases/:id', name: 'database-detail', component: DatabaseDetailView },
  { path: '/vpn', name: 'vpn', component: VpnPage },
  { path: '/support', name: 'support', component: SupportPage },
  { path: '/intelligent-visualizations', name: 'intelligent-visualizations', component: IntelligentVisualizationsPage },
  { path: '/ar', name: 'ar', component: ArPage },
  { path: '/chart', name: 'chart', component: ChartPage },
  {
    path: '/admin',
    component: AdminLayout,
    children: [
      { path: '', name: 'admin-home', component: AdminHome },
      { path: 'users', name: 'admin-users', component: UsersRoles },
      { path: 'databases', name: 'admin-databases', component: DatabasesAdmin },
      { path: 'webhooks', name: 'admin-webhooks', component: WebhooksAdmin },
      { path: 'queues', name: 'admin-queues', component: QueuesAdmin },
      { path: 'flags', name: 'admin-flags', component: FlagsAdmin },
      { path: 'secrets', name: 'admin-secrets', component: SecretsAdmin },
      { path: 'api-explorer', name: 'admin-api-explorer', component: ApiExplorer },
      { path: 'incidents', name: 'admin-incidents', component: IncidentsAdmin },
      { path: 'audit', name: 'admin-audit', component: AuditLog }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'overview' } }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth' };
    }
    return { top: 0 };
  }
});

// Single strict admin guard only

router.beforeEach((to, _from, next) => {
  // Enforce admin-only access for Admin app paths
  if (to.path === '/admin' || to.path.startsWith('/admin/')) {
    const u = (typeof window !== 'undefined' && window.__lastUser__) || null;
    const ok = !!u && (u.isSuperAdmin || u.role === 'admin');
    if (!ok) return next({ name: 'account' });
  }
  next();
});
