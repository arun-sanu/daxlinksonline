import type { LucideIcon } from 'lucide-react';
import {
  BellRing,
  BookOpen,
  Bot,
  CandlestickChart,
  Compass,
  CreditCard,
  Database,
  FileText,
  Globe,
  LifeBuoy,
  Link2,
  Megaphone,
  MessageSquare,
  Monitor,
  Network,
  Rocket,
  Settings2,
  ShieldCheck,
  Store,
  TrendingUp,
  TriangleAlert,
  Wallet,
  Workflow
} from 'lucide-react';

export type PlatformModuleId =
  | 'integrations'
  | 'alerts'
  | 'databases'
  | 'webhooks'
  | 'workflow'
  | 'monitoring'
  | 'orders'
  | 'trade-bots'
  | 'banking'
  | 'dns'
  | 'deployment'
  | 'vpn'
  | 'chat'
  | 'support';

type PlatformModuleMeta = {
  label: string;
  icon: LucideIcon;
  metric: string;
  requiresAuth?: boolean;
  comingSoon?: boolean;
  path?: string;
};

export const PLATFORM_MODULE_META: Record<PlatformModuleId, PlatformModuleMeta> = {
  integrations: { label: 'Integrations', icon: Network, metric: '11 connected exchanges', requiresAuth: true },
  alerts: { label: 'Alert Rail', icon: BellRing, metric: 'Channels + topics', requiresAuth: true },
  databases: { label: 'Databases', icon: Database, metric: '3 clusters', requiresAuth: true },
  webhooks: { label: 'Webhooks', icon: Link2, metric: '18 active routes', requiresAuth: true },
  workflow: { label: 'Workflow', icon: Workflow, metric: '5 nodes', requiresAuth: true, comingSoon: true },
  monitoring: { label: 'Monitoring', icon: Monitor, metric: 'Telemetry feed', requiresAuth: true, comingSoon: true },
  orders: { label: 'Orders', icon: CandlestickChart, metric: 'Spot fills + balances', requiresAuth: true, comingSoon: true },
  'trade-bots': { label: 'Trade Bots', icon: Bot, metric: 'Strategies ready', requiresAuth: true },
  banking: { label: 'Banking', icon: Wallet, metric: 'Settlement windows', requiresAuth: true, comingSoon: true },
  dns: { label: 'DNS', icon: Globe, metric: 'Edge profiles', requiresAuth: true },
  deployment: { label: 'Deployment', icon: Rocket, metric: '3 pipelines', requiresAuth: true },
  vpn: { label: 'VPN', icon: ShieldCheck, metric: 'Edge tunnels', requiresAuth: true, comingSoon: true },
  chat: { label: 'Chat & Channels', icon: MessageSquare, metric: 'Threads + live rooms', requiresAuth: true },
  support: { label: 'Support', icon: LifeBuoy, metric: 'Ops concierge', comingSoon: true }
};

export const PLATFORM_MODULES: Array<PlatformModuleMeta & { id: PlatformModuleId }> = [
  { id: 'integrations', ...PLATFORM_MODULE_META.integrations },
  { id: 'alerts', ...PLATFORM_MODULE_META.alerts },
  { id: 'databases', ...PLATFORM_MODULE_META.databases },
  { id: 'webhooks', ...PLATFORM_MODULE_META.webhooks },
  { id: 'workflow', ...PLATFORM_MODULE_META.workflow },
  { id: 'monitoring', ...PLATFORM_MODULE_META.monitoring },
  { id: 'orders', ...PLATFORM_MODULE_META.orders },
  { id: 'trade-bots', ...PLATFORM_MODULE_META['trade-bots'] },
  { id: 'banking', ...PLATFORM_MODULE_META.banking },
  { id: 'dns', ...PLATFORM_MODULE_META.dns },
  { id: 'deployment', ...PLATFORM_MODULE_META.deployment },
  { id: 'vpn', ...PLATFORM_MODULE_META.vpn },
  { id: 'chat', ...PLATFORM_MODULE_META.chat },
  { id: 'support', ...PLATFORM_MODULE_META.support }
];

export type TradeBotsTabKey = 'overview' | 'connectivity' | 'bots' | 'marketplace' | 'rentals' | 'logs-reports';

export const TRADE_BOT_TAB_ICONS: Record<TradeBotsTabKey, LucideIcon> = {
  overview: CandlestickChart,
  connectivity: Network,
  bots: Bot,
  marketplace: Store,
  rentals: Wallet,
  'logs-reports': FileText
};

export type ExchangeIntegrationTabKey = 'overview' | 'connectivity' | 'data' | 'settings';

export const EXCHANGE_INTEGRATION_TAB_ICONS: Record<ExchangeIntegrationTabKey, LucideIcon> = {
  overview: CandlestickChart,
  connectivity: Link2,
  data: Database,
  settings: Settings2
};

export type AlertTopicKey = 'tvSignals' | 'botTrades' | 'exchangeFills' | 'errors' | 'subscriptions' | 'promotions';

export const ALERT_TOPIC_ICONS: Record<AlertTopicKey, LucideIcon> = {
  tvSignals: TrendingUp,
  botTrades: Bot,
  exchangeFills: CandlestickChart,
  errors: TriangleAlert,
  subscriptions: CreditCard,
  promotions: Megaphone
};

export type HomeResourceKey = 'implementationGuides' | 'solutionReviews' | 'webhookPlaybooks' | 'credentialHardening';

export const HOME_RESOURCE_ICONS: Record<HomeResourceKey, LucideIcon> = {
  implementationGuides: BookOpen,
  solutionReviews: Compass,
  webhookPlaybooks: Link2,
  credentialHardening: ShieldCheck
};
