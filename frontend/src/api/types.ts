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
