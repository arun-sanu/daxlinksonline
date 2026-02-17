// Lightweight interface stubs for Phase 1

export interface ExchangeAccount {
  id: string;
  workspaceId: string;
  name: string;
  venue: string;
  isSandbox: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface Webhook {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  method: WebhookMethod | string;
  events: string[];
  active: boolean;
  signingSecretRef?: string | null;
  lastDeliveryAt?: string | null;
  lastResponseCode?: number | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookProfile {
  url: string;
  secret: string | null;
}

export interface WebhookDelivery {
  id: string;
  event?: string | null;
  status: string;
  responseCode?: number | null;
  lastError?: string | null;
  createdAt: string;
}

export interface Bot {
  id: string;
  workspaceId: string;
  name: string;
  kind: string; // webhook | code | rule
  description?: string | null;
  latestVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
  guardrailAlert?: boolean;
}

export interface BotVersion {
  id: string;
  botId: string;
  imageRef?: string | null;
  signedDigest?: string | null;
  sbomRef?: string | null;
  sdkVersion?: string | null;
  status: string; // draft|built|scanned|approved|published|rejected
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotInstance {
  id: string;
  botId: string;
  botVersionId: string;
  workspaceId: string;
  exchangeAccountId: string;
  exchangeAccount?: {
    id: string;
    name: string;
    venue: string;
    isSandbox: boolean;
  } | null;
  symbol: string;
  direction: string; // long|short|both
  leverage: number;
  maxDailyLossPct: number;
  takeProfitPct: number;
  slAtrMult: number;
  useLimitEntries: boolean;
  minNotional: number;
  status: string; // running|stopped|paused|error
  webhookToken: string;
  lastError?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  lifecycle?: {
    allowedActions?: string[];
    canStart?: boolean;
    canPause?: boolean;
    canStop?: boolean;
    canRestart?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  workspaceId: string;
  name: string;
  cpuMilli: number;
  memMiB: number;
  priceMonthly: number;
  active: boolean;
}

export interface MarketBotSummary {
  id: string;
  name: string;
  description?: string | null;
  workspace: { id: string; name: string };
  publishedAt?: string | null;
  updatedAt?: string | null;
  versionId?: string | null;
  plans: Plan[];
}

export interface Rental {
  id: string;
  botId: string;
  renterWorkspaceId: string;
  planId: string;
  exchangeAccountId: string;
  botInstanceId?: string | null;
  status: string;
  revenueShareBps: number;
  createdAt: string;
  expiresAt: string;
  bot?: Bot;
  plan?: Plan;
  exchangeAccount?: ExchangeAccount;
  instance?: BotInstance;
}

export interface BotRun {
  id: string;
  botInstanceId: string;
  startedAt: string;
  finishedAt?: string | null;
  status: string; // running|success|failed|canceled
  error?: string | null;
  metricsJson?: unknown;
  logsJson?: unknown;
}

export interface Signal {
  id: string;
  botInstanceId: string;
  source: string; // webhook|cron|manual
  externalId?: string | null;
  receivedAt: string;
  payload: unknown;
  processed: boolean;
  processedAt?: string | null;
}

export interface Order {
  id: string;
  botInstanceId: string;
  venue: string;
  symbol: string;
  side: string; // BUY|SELL
  type: string; // LIMIT|MARKET|STOP
  price?: string | null; // Decimal as string
  qty: string; // Decimal as string
  quoteSpend?: string | null;
  qtyRaw?: string | null;
  qtyFinal?: string | null;
  refPrice?: string | null;
  minNotional?: string | null;
  stepSize?: string | null;
  riskMode?: string | null;
  riskValue?: string | null;
  slPrice?: string | null;
  tpPrice?: string | null;
  sizingStatus?: string | null;
  sizingRejectReason?: string | null;
  status: string;
  venueOrderId?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  botInstanceId: string;
  symbol: string;
  side: string; // LONG|SHORT
  entryPrice: string; // Decimal string
  qty: string; // Decimal string
  pnl: string; // Decimal string
  openedAt: string;
  closedAt?: string | null;
}

export interface InstanceLogEntry {
  ts: string;
  level: string;
  msg: string;
}

export interface MetricPoint {
  ts: string;
  value: number;
}

export interface InstanceMetrics {
  cpu: MetricPoint[];
  memMiB: MetricPoint[];
}

export interface InstanceSecurity {
  rateLimit: { lastTriggeredAt?: string | null; detail?: string | null };
  signature: { lastCheckAt?: string | null; lastFailureAt?: string | null };
  guardrail: { lastTriggeredAt?: string | null; detail?: string | null };
}

export interface DnsRecord {
  id: string;
  name: string;
  ip: string;
  status: 'active' | 'pending' | 'error' | string;
  cloudflareId?: string | null;
  createdAt: string;
}
