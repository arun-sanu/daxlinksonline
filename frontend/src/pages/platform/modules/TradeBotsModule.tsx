import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Link2 as Link2Icon, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Search, Square, Trash2, Unlink2, X } from 'lucide-react';
import {
  deleteBot,
  getTradeBotRuntimeConfig,
  listBots,
  listExchangeAccounts,
  listInstances,
  listRentals,
  pauseBot,
  pauseInstance,
  restartBot,
  restartInstance,
  resumeBot,
  saveTradeBotRuntimeConfig,
  stopBot,
  startInstance,
  stopInstance
} from '../../../api/tradeBots';
import { assignWebhook, getMyWebhook, type MyWebhookResponse } from '../../../api/webhooks';
import {
  fetchIntegrationDetail,
  listIntegrations,
  pauseIntegration,
  restartIntegration,
  resumeIntegration,
  testIntegration,
  type Integration
} from '../../../api/integrations';
import { fetchMexcSpotSnapshot, type OrderCheckSnapshot } from '../../../api/orders';
import type { Bot, BotInstance, ExchangeAccount, Rental } from '../../../api/types';
import { TRADE_BOT_TAB_ICONS, type TradeBotsTabKey } from '../../../icons/platformIcons';

type TradeBotRow = Bot & {
  latestVersion?: { id?: string | null; status?: string | null; language?: string | null } | null;
  counts?: { versions?: number; instances?: number; rentals?: number; orders?: number };
};

type TabKey = TradeBotsTabKey;
type BotPopupSection = 'integrations' | 'parameters' | 'algo' | 'arn-pine' | 'exchange' | 'trade-history';
type BotInstanceLifecycleAction = 'start' | 'pause' | 'stop' | 'restart';
type BotLifecycleAction = 'pause' | 'resume' | 'stop' | 'restart' | 'delete';
type IntegrationLifecycleAction = 'pause' | 'resume' | 'restart' | 'delete' | 'unlink';
const TRADE_BOT_TAB_ROUTE_KEYS: TabKey[] = ['overview', 'connectivity', 'bots', 'marketplace', 'rentals', 'logs-reports'];

function isTradeBotTabKey(value: string | null | undefined): value is TabKey {
  if (!value) return false;
  return TRADE_BOT_TAB_ROUTE_KEYS.includes(value as TabKey);
}

function normalizePopupSectionFromQuery(value: string | null): BotPopupSection | null {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'integrations') return 'integrations';
  if (normalized === 'parameters') return 'parameters';
  if (normalized === 'algo') return 'algo';
  if (normalized === 'arn-pine') return 'arn-pine';
  if (normalized === 'exchange') return 'exchange';
  if (normalized === 'trade-history') return 'trade-history';
  if (normalized === 'connectivity') return 'integrations';
  if (normalized === 'pine-script') return 'parameters';
  return null;
}

const BOT_LINKS_STORAGE_KEY = 'dax_trade_bot_links_v1';
const BOT_RULES_STORAGE_KEY = 'dax_trade_bot_rules_v1';
const BOT_CANONICAL_NAME = 'moneyplantbot1-robot';
const ARN_PINE_BOT_SLUGS = new Set([
  'arn-s-shcs-orginal',
  'arn-s-shcs-original',
  'arn-pine-faithful',
  'arn-bot-service-pine-faithful'
]);
const ARN_PINE_PARAMETER_KEYS = [
  'symbol',
  'leverage',
  'tp_percent',
  'sl_atr_multiplier',
  'investment_percentage',
  'daily_loss_limit',
  'cooldown_candles',
  'rsi_length',
  'bb_length',
  'bb_mult',
  'volatility_threshold',
  'action',
  'direction',
  'volatility_spike',
  'timezone'
] as const;

type ExecutionFunction = 'live_trading' | 'paper_trading' | 'signal_only';
type SizingMode = 'balance_pct' | 'fixed_quote' | 'risk_per_trade_pct' | 'volatility_adjusted';
type CompoundingMode = 'full_balance' | 'profit_only';
type StopType = 'none' | 'percent' | 'fixed_price' | 'rr' | 'atr_multiplier';
type PreviewSide = 'buy' | 'sell';
type ReferencePriceSource = 'last' | 'mark' | 'mid';
type SignalSource = 'tradingview' | 'internal' | 'api';
type BotCodeParameterType = 'number' | 'string' | 'boolean';
type BotCodeParameterValue = string | number | boolean | null;

type PineInputSetting = {
  key: string;
  type: string;
  title: string | null;
  defaultValue: string | number | boolean | null;
  raw: string;
};

type PineScriptAnalysis = {
  scriptType: 'strategy' | 'indicator' | 'unknown';
  name: string | null;
  interval: string | null;
  indicators: string[];
  functions: string[];
  actions: string[];
  indicatorSettings: PineInputSetting[];
  notes: string[];
  sourceDigest: string;
  generatedAt: string;
};

type BotCodeParameter = {
  key: string;
  label: string;
  type: BotCodeParameterType;
  defaultValue: string | number | boolean;
  source: string | null;
  description: string | null;
  line: number | null;
};

type BotTradingRules = {
  symbol: string;
  executionFunction: ExecutionFunction;
  signalTimeframe: string;
  signalSource: SignalSource;
  signalDedupEnabled: boolean;
  signalDedupWindowSec: number;
  orderType: 'market' | 'limit';
  limitPrice: number | null;
  sizingMode: SizingMode;
  allocationValue: number;
  reinvestmentPct: number;
  compoundingEnabled: boolean;
  compoundingMode: CompoundingMode;
  compoundingPct: number;
  compoundingBaseQuote: number | null;
  targetSpendPct: number | null;
  sellCompoundingEnabled: boolean;
  sellCompoundingMode: CompoundingMode;
  sellCompoundingPct: number;
  sellCompoundingBaseQuote: number | null;
  sellTargetSpendPct: number | null;
  sellLadderEnabled: boolean;
  sellLadderStrengthPct: number;
  sellLadderMinFactor: number;
  sellLadderMaxFactor: number;
  minQuoteSpend: number;
  maxQuoteSpend: number;
  referencePriceSource: ReferencePriceSource;
  slType: StopType;
  slValue: number | null;
  slAtrLength: number;
  slAtrMultiplier: number | null;
  tpType: StopType;
  tpValue: number | null;
  previewSide: PreviewSide;
  maxPositionExposurePct: number;
  maxOpenPositionsPerSymbol: number;
  cooldownSeconds: number;
  maxOpenOrdersPerSymbol: number;
  slippageTolerancePct: number;
  cancelIfNotFilledSec: number;
  dailyLossCapEnabled: boolean;
  dailyLossLimitPct: number;
  dailyResetTimeUtc: string;
  pineAnalysis: PineScriptAnalysis | null;
  codeSource: string | null;
  codeParameterSchema: BotCodeParameter[];
  codeParameters: Record<string, BotCodeParameterValue>;
  codeParametersUpdatedAt: string | null;
};

const DEFAULT_TRADING_RULES: BotTradingRules = {
  symbol: 'BTCUSDC',
  executionFunction: 'live_trading',
  signalTimeframe: '5m',
  signalSource: 'tradingview',
  signalDedupEnabled: true,
  signalDedupWindowSec: 120,
  orderType: 'market',
  limitPrice: null,
  sizingMode: 'balance_pct',
  allocationValue: 90,
  reinvestmentPct: 90,
  compoundingEnabled: false,
  compoundingMode: 'full_balance',
  compoundingPct: 100,
  compoundingBaseQuote: null,
  targetSpendPct: null,
  sellCompoundingEnabled: false,
  sellCompoundingMode: 'full_balance',
  sellCompoundingPct: 100,
  sellCompoundingBaseQuote: null,
  sellTargetSpendPct: 91.05,
  sellLadderEnabled: false,
  sellLadderStrengthPct: 100,
  sellLadderMinFactor: 0.1,
  sellLadderMaxFactor: 2,
  minQuoteSpend: 1.05,
  maxQuoteSpend: 50,
  referencePriceSource: 'last',
  slType: 'atr_multiplier',
  slValue: null,
  slAtrLength: 14,
  slAtrMultiplier: 1.5,
  tpType: 'percent',
  tpValue: 1,
  previewSide: 'buy',
  maxPositionExposurePct: 100,
  maxOpenPositionsPerSymbol: 1,
  cooldownSeconds: 30,
  maxOpenOrdersPerSymbol: 5,
  slippageTolerancePct: 0.5,
  cancelIfNotFilledSec: 20,
  dailyLossCapEnabled: false,
  dailyLossLimitPct: 5,
  dailyResetTimeUtc: '00:00',
  pineAnalysis: null,
  codeSource: null,
  codeParameterSchema: [],
  codeParameters: {},
  codeParametersUpdatedAt: null
};

function getWorkspaceId() {
  try {
    return localStorage.getItem('workspaceId') || '';
  } catch {
    return '';
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatDecimal(value: unknown, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function normalizeInstanceState(value?: string | null) {
  const normalized = String(value || 'stopped')
    .trim()
    .toLowerCase();
  if (['running', 'paused', 'stopped', 'error'].includes(normalized)) return normalized;
  return 'stopped';
}

function canRunInstanceAction(instance: BotInstance, action: BotInstanceLifecycleAction) {
  const lifecycle = (instance as any)?.lifecycle;
  const allowedActions = Array.isArray(lifecycle?.allowedActions)
    ? lifecycle.allowedActions.map((value: unknown) => String(value).toLowerCase())
    : null;
  if (allowedActions && allowedActions.length > 0) {
    return allowedActions.includes(action);
  }

  const status = normalizeInstanceState(instance.status);
  if (action === 'start') return status !== 'running';
  if (action === 'pause') return status === 'running';
  if (action === 'stop') return status !== 'stopped';
  return true;
}

function instanceStatusBadgeClass(statusValue?: string | null) {
  const status = normalizeInstanceState(statusValue);
  if (status === 'running') return 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100';
  if (status === 'paused') return 'border-amber-300/45 bg-amber-500/15 text-amber-100';
  if (status === 'error') return 'border-rose-300/45 bg-rose-500/15 text-rose-100';
  return 'border-white/25 bg-white/10 text-gray-200';
}

function normalizeSymbol(value?: string | null) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\//g, '');
}

function normalizeTimeframe(value?: string | null) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '5m';
  if (/^\d+[mhd]$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `${raw}m`;
  const aliases: Record<string, string> = {
    '1min': '1m',
    '5min': '5m',
    '15min': '15m',
    '30min': '30m',
    '1hour': '1h',
    '1hr': '1h',
    '4hour': '4h',
    '1day': '1d',
    daily: '1d'
  };
  return aliases[raw] || '5m';
}

function timeframeToInterval(value?: string | null) {
  const tf = normalizeTimeframe(value);
  if (tf.endsWith('h')) {
    const n = Number(tf.slice(0, -1));
    if (n === 1) return '60m';
    if (n === 4) return '4h';
    return '60m';
  }
  if (tf.endsWith('d')) return '1d';
  const n = Number(tf.slice(0, -1));
  if ([1, 5, 15, 30].includes(n)) return `${n}m`;
  if (n === 60) return '60m';
  return '5m';
}

function resolveSymbolAssets(symbol: string, fallbackBase?: string | null, fallbackQuote?: string | null) {
  if (fallbackBase && fallbackQuote) {
    return { baseAsset: fallbackBase.toUpperCase(), quoteAsset: fallbackQuote.toUpperCase() };
  }
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return { baseAsset: null, quoteAsset: null };
  }
  const knownQuotes = ['USDC', 'USDT', 'BUSD', 'USD', 'BTC', 'ETH', 'EUR', 'TRY'];
  const quote = knownQuotes.find((candidate) => normalized.endsWith(candidate));
  if (quote) {
    const base = normalized.slice(0, normalized.length - quote.length) || null;
    return { baseAsset: base, quoteAsset: quote };
  }
  return { baseAsset: null, quoteAsset: null };
}

type IntegrationDetail = Awaited<ReturnType<typeof fetchIntegrationDetail>>;

function versionText(bot: TradeBotRow) {
  if (bot.latestVersion?.id) return bot.latestVersion.id;
  if (bot.latestVersionId) return bot.latestVersionId;
  return 'No version';
}

type BotConnectivityLink = {
  webhookUrl?: string | null;
  integrationId?: string | null;
  exchangeAccountId?: string | null;
  updatedAt?: string | null;
};

function readBotLinks(): Record<string, BotConnectivityLink> {
  try {
    const raw = localStorage.getItem(BOT_LINKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeBotLinks(next: Record<string, BotConnectivityLink>) {
  try {
    localStorage.setItem(BOT_LINKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

function createDefaultTradingRules(symbol = 'BTCUSDC'): BotTradingRules {
  return {
    ...DEFAULT_TRADING_RULES,
    symbol: normalizeSymbol(symbol) || DEFAULT_TRADING_RULES.symbol
  };
}

function createDefaultTradingRulesForBot(bot: TradeBotRow | null | undefined): BotTradingRules {
  if (isArnPineFaithfulBot(bot || null, null, [])) {
    return createDefaultTradingRules('BTCUSDT');
  }
  return createDefaultTradingRules(DEFAULT_TRADING_RULES.symbol);
}

function normalizeNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTargetSpendPct(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const normalized = n <= 1 ? n * 100 : n;
  if (normalized <= 0) return null;
  return Math.min(100, normalized);
}

function deriveCompoundingBaseQuoteForTargetSpend({
  baseQuoteSpend,
  freeQuote,
  compoundingEnabled = false,
  compoundingMode = 'full_balance',
  compoundingPct = 100,
  targetSpendPct = null
}: {
  baseQuoteSpend: number;
  freeQuote: number;
  compoundingEnabled?: boolean;
  compoundingMode?: CompoundingMode;
  compoundingPct?: number;
  targetSpendPct?: number | null;
}) {
  const baseSpend = Number(baseQuoteSpend);
  const freeQuoteNum = Number(freeQuote);
  const normalizedTargetPct = normalizeTargetSpendPct(targetSpendPct);
  const targetRatio = normalizedTargetPct ? normalizedTargetPct / 100 : null;
  const strength = Math.max(0, Math.min(3, Number(compoundingPct || 0) / 100));

  if (!compoundingEnabled || compoundingMode !== 'full_balance') return null;
  if (!Number.isFinite(baseSpend) || baseSpend <= 0) return null;
  if (!Number.isFinite(freeQuoteNum) || freeQuoteNum <= 0) return null;
  if (!targetRatio || targetRatio <= 0) return null;
  if (strength <= 0) return null;

  const targetSpend = freeQuoteNum * targetRatio;
  const requiredFactor = targetSpend / baseSpend;
  const denominator = requiredFactor - 1 + strength;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  const baseQuote = (strength * freeQuoteNum) / denominator;
  if (!Number.isFinite(baseQuote) || baseQuote <= 0) return null;
  return baseQuote;
}

function applyCompoundingToQuoteSpendMath({
  baseQuoteSpend,
  freeQuote,
  compoundingEnabled = false,
  compoundingMode = 'full_balance',
  compoundingBaseQuote = null,
  compoundingPct = 100,
  targetSpendPct = null
}: {
  baseQuoteSpend: number;
  freeQuote: number;
  compoundingEnabled?: boolean;
  compoundingMode?: CompoundingMode;
  compoundingBaseQuote?: number | null;
  compoundingPct?: number;
  targetSpendPct?: number | null;
}) {
  const baseSpend = Number(baseQuoteSpend);
  const freeQuoteNum = Number(freeQuote) || 0;
  const strength = Math.max(0, Math.min(3, Number(compoundingPct || 0) / 100));
  const configuredBaseQuote = Number(compoundingBaseQuote || 0);
  const manualBaseQuote =
    Number.isFinite(configuredBaseQuote) && configuredBaseQuote > 0
      ? configuredBaseQuote
      : null;
  const normalizedTargetPct = normalizeTargetSpendPct(targetSpendPct);
  const targetRatio = normalizedTargetPct ? normalizedTargetPct / 100 : null;

  if (!Number.isFinite(baseSpend) || baseSpend <= 0) {
    return {
      quoteSpend: 0,
      baseQuoteSpend: 0,
      compoundingFactor: 1,
      compoundingProfitQuote: 0,
      compoundingBaseQuoteUsed: manualBaseQuote || 0,
      compoundingBaseQuoteConfigured: manualBaseQuote,
      compoundingBaseQuoteAuto: null as number | null,
      targetSpendPct: normalizedTargetPct,
      targetSpendRatio: targetRatio,
      targetSpendApplied: false
    };
  }

  const inferredBaseQuote =
    compoundingMode === 'full_balance'
      ? (freeQuoteNum > 0 ? freeQuoteNum : baseSpend)
      : baseSpend;
  const autoBaseQuote = deriveCompoundingBaseQuoteForTargetSpend({
    baseQuoteSpend: baseSpend,
    freeQuote: freeQuoteNum,
    compoundingEnabled,
    compoundingMode,
    compoundingPct,
    targetSpendPct: normalizedTargetPct
  });
  const compoundingBaseQuoteUsed = autoBaseQuote ?? manualBaseQuote ?? inferredBaseQuote;
  const compoundingProfitQuote = Math.max(0, freeQuoteNum - compoundingBaseQuoteUsed);

  if (!compoundingEnabled || strength <= 0 || compoundingBaseQuoteUsed <= 0) {
    return {
      quoteSpend: baseSpend,
      baseQuoteSpend: baseSpend,
      compoundingFactor: 1,
      compoundingProfitQuote,
      compoundingBaseQuoteUsed,
      compoundingBaseQuoteConfigured: manualBaseQuote,
      compoundingBaseQuoteAuto: autoBaseQuote,
      targetSpendPct: normalizedTargetPct,
      targetSpendRatio: targetRatio,
      targetSpendApplied: false
    };
  }

  let compoundingFactor = 1;
  if (compoundingMode === 'profit_only') {
    compoundingFactor = 1 + (compoundingProfitQuote / compoundingBaseQuoteUsed) * strength;
  } else {
    const balanceRatio = Math.max(0, freeQuoteNum / compoundingBaseQuoteUsed);
    compoundingFactor = Math.max(0, 1 + (balanceRatio - 1) * strength);
  }

  return {
    quoteSpend: baseSpend * compoundingFactor,
    baseQuoteSpend: baseSpend,
    compoundingFactor,
    compoundingProfitQuote,
    compoundingBaseQuoteUsed,
    compoundingBaseQuoteConfigured: manualBaseQuote,
    compoundingBaseQuoteAuto: autoBaseQuote,
    targetSpendPct: normalizedTargetPct,
    targetSpendRatio: targetRatio,
    targetSpendApplied: autoBaseQuote !== null
  };
}

function applySellLadderToSellQuantityMath({
  qtyRaw,
  freeBase,
  marketSellPrice,
  referenceBuyPrice,
  sellLadderEnabled = false,
  sellLadderStrengthPct = 100,
  sellLadderMinFactor = 0.1,
  sellLadderMaxFactor = 2
}: {
  qtyRaw: number;
  freeBase: number;
  marketSellPrice: number;
  referenceBuyPrice: number | null;
  sellLadderEnabled?: boolean;
  sellLadderStrengthPct?: number;
  sellLadderMinFactor?: number;
  sellLadderMaxFactor?: number;
}) {
  const baseQty = Number(qtyRaw);
  const freeBaseNum = Number(freeBase) || 0;
  const marketPrice = Number(marketSellPrice);
  const referenceBuy = Number(referenceBuyPrice);
  const strength = Math.max(0, Math.min(5, Number(sellLadderStrengthPct || 0) / 100));
  const minFactor = Math.max(0.01, Math.min(1, Number(sellLadderMinFactor || 0.1)));
  const maxFactor = Math.max(minFactor, Math.max(1, Math.min(10, Number(sellLadderMaxFactor || 2))));

  if (!Number.isFinite(baseQty) || baseQty <= 0) {
    return { qtyRaw: 0, factor: 1, edgeRatio: null as number | null, applied: false };
  }
  if (
    !sellLadderEnabled ||
    !Number.isFinite(marketPrice) ||
    marketPrice <= 0 ||
    !Number.isFinite(referenceBuy) ||
    referenceBuy <= 0 ||
    strength <= 0
  ) {
    return { qtyRaw: baseQty, factor: 1, edgeRatio: null as number | null, applied: false };
  }

  const edgeRatio = (marketPrice - referenceBuy) / referenceBuy;
  const lossSlopeMultiplier = 6;
  const slope = edgeRatio >= 0 ? strength : strength * lossSlopeMultiplier;
  const rawFactor = 1 + edgeRatio * slope;
  const factor = Math.max(minFactor, Math.min(maxFactor, rawFactor));
  const scaledQty = Math.max(0, Math.min(freeBaseNum, baseQty * factor));
  return { qtyRaw: scaledQty, factor, edgeRatio, applied: true };
}

function sanitizePineInputSettings(value: unknown): PineInputSetting[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const key = String((row as any).key || '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 120);
      if (!key) return null;
      const type = String((row as any).type || 'unknown').trim().slice(0, 60);
      const titleRaw = (row as any).title;
      const title = titleRaw === null || titleRaw === undefined ? null : String(titleRaw).trim().slice(0, 180);
      const defaultValueRaw = (row as any).defaultValue;
      const defaultValue =
        typeof defaultValueRaw === 'number' || typeof defaultValueRaw === 'boolean' || typeof defaultValueRaw === 'string'
          ? defaultValueRaw
          : null;
      const raw = String((row as any).raw || '').slice(0, 240);
      return {
        key,
        type,
        title,
        defaultValue,
        raw
      };
    })
    .filter(Boolean) as PineInputSetting[];
}

function sanitizePineAnalysis(value: unknown): PineScriptAnalysis | null {
  if (!value || typeof value !== 'object') return null;
  const scriptTypeRaw = String((value as any).scriptType || 'unknown').trim().toLowerCase();
  const scriptType: PineScriptAnalysis['scriptType'] =
    scriptTypeRaw === 'strategy' || scriptTypeRaw === 'indicator' ? (scriptTypeRaw as PineScriptAnalysis['scriptType']) : 'unknown';
  const nameRaw = (value as any).name;
  const name = nameRaw === null || nameRaw === undefined ? null : String(nameRaw).trim().slice(0, 180);
  const intervalRaw = (value as any).interval;
  const interval = intervalRaw === null || intervalRaw === undefined ? null : normalizeTimeframe(String(intervalRaw));
  const indicators = Array.isArray((value as any).indicators)
    ? Array.from(
        new Set(
          (value as any).indicators
            .map((entry: unknown) => String(entry || '').trim().toLowerCase())
            .filter(Boolean)
        )
      ).slice(0, 80)
    : [];
  const functions = Array.isArray((value as any).functions)
    ? Array.from(
        new Set(
          (value as any).functions
            .map((entry: unknown) => String(entry || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 80)
    : [];
  const actions = Array.isArray((value as any).actions)
    ? Array.from(
        new Set(
          (value as any).actions
            .map((entry: unknown) => String(entry || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 80)
    : [];
  const notes = Array.isArray((value as any).notes)
    ? (value as any).notes
        .map((entry: unknown) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 40)
    : [];
  const sourceDigest = String((value as any).sourceDigest || '').trim().slice(0, 64);
  const generatedAtRaw = String((value as any).generatedAt || '').trim();
  const generatedAt = generatedAtRaw && !Number.isNaN(new Date(generatedAtRaw).getTime()) ? generatedAtRaw : new Date().toISOString();

  return {
    scriptType,
    name,
    interval,
    indicators,
    functions,
    actions,
    indicatorSettings: sanitizePineInputSettings((value as any).indicatorSettings),
    notes,
    sourceDigest: sourceDigest || hashSignalKey(`${scriptType}:${name || ''}:${interval || ''}`).slice(4),
    generatedAt
  };
}

function sanitizeCodeParameterType(value: unknown): BotCodeParameterType | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'number' || normalized === 'string' || normalized === 'boolean') {
    return normalized as BotCodeParameterType;
  }
  return null;
}

function sanitizeCodeParameterSchema(value: unknown): BotCodeParameter[] {
  if (!Array.isArray(value)) return [];
  const out: BotCodeParameter[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const key = String((item as any).key || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || seen.has(key)) continue;
    const type = sanitizeCodeParameterType((item as any).type);
    if (!type) continue;

    const defaultValueRaw = (item as any).defaultValue;
    let defaultValue: string | number | boolean;
    if (type === 'number') {
      const n = Number(defaultValueRaw);
      if (!Number.isFinite(n)) continue;
      defaultValue = n;
    } else if (type === 'boolean') {
      defaultValue = Boolean(defaultValueRaw);
    } else {
      defaultValue = String(defaultValueRaw ?? '');
    }

    seen.add(key);
    out.push({
      key,
      label: String((item as any).label || key),
      type,
      defaultValue,
      source: (item as any).source ? String((item as any).source) : null,
      description: (item as any).description ? String((item as any).description) : null,
      line: Number.isFinite(Number((item as any).line)) ? Number((item as any).line) : null
    });
    if (out.length >= 300) break;
  }

  return out;
}

function coerceCodeParameterValue(
  value: unknown,
  type: BotCodeParameterType,
  fallback: string | number | boolean
): BotCodeParameterValue {
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : (fallback as number);
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value ?? '')
      .trim()
      .toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    return Boolean(fallback);
  }
  if (value === null || value === undefined) return String(fallback);
  return String(value);
}

function sanitizeCodeParameterValues(
  value: unknown,
  schema: BotCodeParameter[]
): Record<string, BotCodeParameterValue> {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: Record<string, BotCodeParameterValue> = {};

  if (!schema.length) {
    for (const [key, entry] of Object.entries(raw)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (
        entry === null ||
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean'
      ) {
        out[key] = entry as BotCodeParameterValue;
      }
    }
    return out;
  }

  for (const item of schema) {
    out[item.key] = coerceCodeParameterValue(raw[item.key], item.type, item.defaultValue);
  }
  return out;
}

function sanitizeTradingRules(rules: Partial<BotTradingRules> | null | undefined): BotTradingRules {
  const merged = {
    ...DEFAULT_TRADING_RULES,
    ...(rules || {})
  };
  const minQuoteSpend = Math.max(0, normalizeNumber(merged.minQuoteSpend, DEFAULT_TRADING_RULES.minQuoteSpend));
  const maxQuoteSpendRaw = Math.max(0, normalizeNumber(merged.maxQuoteSpend, DEFAULT_TRADING_RULES.maxQuoteSpend));
  const maxQuoteSpend = Math.max(maxQuoteSpendRaw, minQuoteSpend);
  const orderType = merged.orderType === 'limit' ? 'limit' : 'market';
  const limitPrice = orderType === 'limit' ? Math.max(0, normalizeNumber(merged.limitPrice, 0)) || null : null;
  const stopTypes: StopType[] = ['none', 'percent', 'fixed_price', 'rr', 'atr_multiplier'];
  const slType: StopType = stopTypes.includes(merged.slType as StopType) ? (merged.slType as StopType) : 'none';
  const tpType: StopType = stopTypes.includes(merged.tpType as StopType) ? (merged.tpType as StopType) : 'none';
  const sizingModes: SizingMode[] = ['balance_pct', 'fixed_quote', 'risk_per_trade_pct', 'volatility_adjusted'];
  const sizingMode: SizingMode = sizingModes.includes(merged.sizingMode as SizingMode) ? (merged.sizingMode as SizingMode) : 'balance_pct';
  const compoundingModes: CompoundingMode[] = ['full_balance', 'profit_only'];
  const compoundingMode: CompoundingMode = compoundingModes.includes(merged.compoundingMode as CompoundingMode)
    ? (merged.compoundingMode as CompoundingMode)
    : DEFAULT_TRADING_RULES.compoundingMode;
  const compoundingBaseQuoteRaw = normalizeNumber(merged.compoundingBaseQuote, 0);
  const compoundingBaseQuote = compoundingBaseQuoteRaw > 0 ? compoundingBaseQuoteRaw : null;
  const targetSpendPct = normalizeTargetSpendPct((merged as any).targetSpendPct);
  const sellCompoundingModes: CompoundingMode[] = ['full_balance', 'profit_only'];
  const sellCompoundingMode: CompoundingMode = sellCompoundingModes.includes((merged as any).sellCompoundingMode as CompoundingMode)
    ? ((merged as any).sellCompoundingMode as CompoundingMode)
    : DEFAULT_TRADING_RULES.sellCompoundingMode;
  const sellCompoundingBaseQuoteRaw = normalizeNumber((merged as any).sellCompoundingBaseQuote, 0);
  const sellCompoundingBaseQuote = sellCompoundingBaseQuoteRaw > 0 ? sellCompoundingBaseQuoteRaw : null;
  const sellTargetSpendPct = normalizeTargetSpendPct((merged as any).sellTargetSpendPct);
  const sellLadderMinFactor = Math.max(
    0.01,
    Math.min(1, normalizeNumber((merged as any).sellLadderMinFactor, DEFAULT_TRADING_RULES.sellLadderMinFactor))
  );
  const sellLadderMaxFactor = Math.max(
    Math.max(1, sellLadderMinFactor),
    Math.min(10, normalizeNumber((merged as any).sellLadderMaxFactor, DEFAULT_TRADING_RULES.sellLadderMaxFactor))
  );
  const referencePriceSource: ReferencePriceSource = ['last', 'mark', 'mid'].includes(String(merged.referencePriceSource))
    ? (merged.referencePriceSource as ReferencePriceSource)
    : 'last';
  const signalSource: SignalSource = ['tradingview', 'internal', 'api'].includes(String(merged.signalSource))
    ? (merged.signalSource as SignalSource)
    : 'tradingview';
  const executionFunction: ExecutionFunction =
    merged.executionFunction === 'paper_trading' || merged.executionFunction === 'signal_only'
      ? merged.executionFunction
      : 'live_trading';
  const previewSide: PreviewSide = merged.previewSide === 'sell' ? 'sell' : 'buy';
  const codeParameterSchema = sanitizeCodeParameterSchema((merged as any).codeParameterSchema);
  const codeParameters = sanitizeCodeParameterValues((merged as any).codeParameters, codeParameterSchema);
  const codeSourceRaw = (merged as any).codeSource;
  const codeSource = typeof codeSourceRaw === 'string' ? codeSourceRaw.slice(0, 250000) : null;
  const codeParametersUpdatedAtRaw = String((merged as any).codeParametersUpdatedAt || '').trim();
  const codeParametersUpdatedAt =
    codeParametersUpdatedAtRaw && !Number.isNaN(new Date(codeParametersUpdatedAtRaw).getTime())
      ? codeParametersUpdatedAtRaw
      : null;

  return {
    symbol: normalizeSymbol(merged.symbol) || DEFAULT_TRADING_RULES.symbol,
    signalTimeframe: normalizeTimeframe(merged.signalTimeframe),
    signalSource,
    signalDedupEnabled: Boolean(merged.signalDedupEnabled),
    signalDedupWindowSec: Math.max(0, Math.floor(normalizeNumber(merged.signalDedupWindowSec, DEFAULT_TRADING_RULES.signalDedupWindowSec))),
    executionFunction,
    orderType,
    limitPrice,
    sizingMode,
    allocationValue: Math.max(0, normalizeNumber(merged.allocationValue, DEFAULT_TRADING_RULES.allocationValue)),
    reinvestmentPct: Math.max(0, Math.min(100, normalizeNumber(merged.reinvestmentPct, DEFAULT_TRADING_RULES.reinvestmentPct))),
    compoundingEnabled: Boolean(merged.compoundingEnabled),
    compoundingMode,
    compoundingPct: Math.max(0, Math.min(300, normalizeNumber(merged.compoundingPct, DEFAULT_TRADING_RULES.compoundingPct))),
    compoundingBaseQuote,
    targetSpendPct,
    sellCompoundingEnabled: Boolean((merged as any).sellCompoundingEnabled),
    sellCompoundingMode,
    sellCompoundingPct: Math.max(
      0,
      Math.min(300, normalizeNumber((merged as any).sellCompoundingPct, DEFAULT_TRADING_RULES.sellCompoundingPct))
    ),
    sellCompoundingBaseQuote,
    sellTargetSpendPct,
    sellLadderEnabled: Boolean((merged as any).sellLadderEnabled),
    sellLadderStrengthPct: Math.max(
      0,
      Math.min(500, normalizeNumber((merged as any).sellLadderStrengthPct, DEFAULT_TRADING_RULES.sellLadderStrengthPct))
    ),
    sellLadderMinFactor,
    sellLadderMaxFactor,
    minQuoteSpend,
    maxQuoteSpend,
    referencePriceSource,
    slType,
    slValue: slType === 'none' || slType === 'atr_multiplier' ? null : Math.max(0, normalizeNumber(merged.slValue, 0)) || null,
    slAtrLength: Math.max(2, Math.floor(normalizeNumber(merged.slAtrLength, DEFAULT_TRADING_RULES.slAtrLength))),
    slAtrMultiplier: Math.max(0, normalizeNumber(merged.slAtrMultiplier, DEFAULT_TRADING_RULES.slAtrMultiplier || 1.5)) || null,
    tpType,
    tpValue: tpType === 'none' ? null : Math.max(0, normalizeNumber(merged.tpValue, 0)) || null,
    previewSide,
    maxPositionExposurePct: Math.max(0, Math.min(100, normalizeNumber(merged.maxPositionExposurePct, DEFAULT_TRADING_RULES.maxPositionExposurePct))),
    maxOpenPositionsPerSymbol: Math.max(1, Math.floor(normalizeNumber(merged.maxOpenPositionsPerSymbol, DEFAULT_TRADING_RULES.maxOpenPositionsPerSymbol))),
    cooldownSeconds: Math.max(0, Math.floor(normalizeNumber(merged.cooldownSeconds, DEFAULT_TRADING_RULES.cooldownSeconds))),
    maxOpenOrdersPerSymbol: Math.max(0, Math.floor(normalizeNumber(merged.maxOpenOrdersPerSymbol, DEFAULT_TRADING_RULES.maxOpenOrdersPerSymbol))),
    slippageTolerancePct: Math.max(0, normalizeNumber(merged.slippageTolerancePct, DEFAULT_TRADING_RULES.slippageTolerancePct)),
    cancelIfNotFilledSec: Math.max(0, Math.floor(normalizeNumber(merged.cancelIfNotFilledSec, DEFAULT_TRADING_RULES.cancelIfNotFilledSec))),
    dailyLossCapEnabled: Boolean(merged.dailyLossCapEnabled),
    dailyLossLimitPct: Math.max(0, normalizeNumber(merged.dailyLossLimitPct, DEFAULT_TRADING_RULES.dailyLossLimitPct)),
    dailyResetTimeUtc:
      /^\d{2}:\d{2}$/.test(String(merged.dailyResetTimeUtc || '').trim())
        ? String(merged.dailyResetTimeUtc).trim()
        : DEFAULT_TRADING_RULES.dailyResetTimeUtc,
    pineAnalysis: sanitizePineAnalysis(merged.pineAnalysis),
    codeSource,
    codeParameterSchema,
    codeParameters,
    codeParametersUpdatedAt
  };
}

function readBotTradingRulesMap(): Record<string, BotTradingRules> {
  try {
    const raw = localStorage.getItem(BOT_RULES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, BotTradingRules> = {};
    for (const [botId, value] of Object.entries(parsed)) {
      out[botId] = sanitizeTradingRules(value as Partial<BotTradingRules>);
    }
    return out;
  } catch {
    return {};
  }
}

function writeBotTradingRulesMap(next: Record<string, BotTradingRules>) {
  try {
    const compact: Record<string, BotTradingRules> = {};
    for (const [botId, rules] of Object.entries(next)) {
      compact[botId] = {
        ...rules,
        // Keep browser storage compact; full source remains in backend runtime config.
        codeSource: null
      };
    }
    localStorage.setItem(BOT_RULES_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // ignore storage failures
  }
}

function normalizeBotName(name: string) {
  if (String(name || '').trim().toLowerCase() === 'trade-exec-bot') {
    return BOT_CANONICAL_NAME;
  }
  return name;
}

function normalizeTextSlug(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isArnPineFaithfulBot(
  bot: TradeBotRow | null,
  rules: BotTradingRules | null,
  codeParameterSchema: BotCodeParameter[] = []
) {
  const slug = normalizeTextSlug(bot?.name || '');
  if (ARN_PINE_BOT_SLUGS.has(slug)) return true;
  const strategy = String((rules as any)?.strategy || '').trim().toUpperCase();
  if (strategy === 'ARN_PINE_FAITHFUL') return true;
  const keys = new Set(codeParameterSchema.map((item) => String(item.key || '').trim().toLowerCase()));
  return (
    keys.has('daily_loss_limit') &&
    keys.has('cooldown_candles') &&
    keys.has('sl_atr_multiplier') &&
    keys.has('volatility_spike')
  );
}

function collectWebhookUrls(profile: MyWebhookResponse | null): string[] {
  if (!profile) return [];
  const values = new Set<string>();
  if (profile.url) values.add(String(profile.url));
  for (const record of profile.dnsRecords || []) {
    if (record?.url) values.add(String(record.url));
  }
  return Array.from(values);
}

function normalizeConnectionText(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function integrationIsHealthy(status?: string | null) {
  const text = normalizeConnectionText(status);
  if (!text) return false;
  if (['failed', 'error', 'disabled', 'disconnected', 'revoked', 'invalid'].some((token) => text.includes(token))) {
    return false;
  }
  return ['ok', 'connected', 'active', 'enabled', 'healthy', 'ready', 'success'].some((token) => text.includes(token));
}

function connectivityBadgeClass(connected: boolean) {
  return connected ? 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100' : 'border-amber-300/30 bg-amber-500/15 text-amber-100';
}

const FUTURE_ACTION_PRIMARY =
  'rounded-xl border border-cyan-300/45 bg-cyan-500/14 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-50 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-400/20 hover:shadow-[0_0_24px_rgba(34,211,238,0.25)] disabled:cursor-not-allowed disabled:opacity-40';
const FUTURE_ACTION_SUCCESS =
  'rounded-xl border border-emerald-300/45 bg-emerald-500/14 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-50 transition-all duration-200 hover:border-emerald-200/80 hover:bg-emerald-400/20 hover:shadow-[0_0_24px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-40';
const FUTURE_ACTION_WARNING =
  'rounded-xl border border-amber-300/45 bg-amber-500/14 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-50 transition-all duration-200 hover:border-amber-200/80 hover:bg-amber-400/20 hover:shadow-[0_0_24px_rgba(251,191,36,0.25)] disabled:cursor-not-allowed disabled:opacity-40';
const FUTURE_ACTION_STOP =
  'rounded-xl border border-slate-300/35 bg-slate-500/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-100 transition-all duration-200 hover:border-slate-200/70 hover:bg-slate-400/20 hover:shadow-[0_0_24px_rgba(148,163,184,0.22)] disabled:cursor-not-allowed disabled:opacity-40';
const FUTURE_ACTION_INFO =
  'rounded-xl border border-sky-300/45 bg-sky-500/14 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-50 transition-all duration-200 hover:border-sky-200/80 hover:bg-sky-400/20 hover:shadow-[0_0_24px_rgba(56,189,248,0.25)] disabled:cursor-not-allowed disabled:opacity-40';
const FUTURE_ACTION_DANGER =
  'rounded-xl border border-rose-300/45 bg-rose-500/14 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-50 transition-all duration-200 hover:border-rose-200/80 hover:bg-rose-400/20 hover:shadow-[0_0_24px_rgba(251,113,133,0.25)] disabled:cursor-not-allowed disabled:opacity-40';
const FUTURE_BADGE_BUSY =
  'rounded-xl border border-cyan-300/45 bg-cyan-500/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100';
const FUTURE_BADGE_MUTED =
  'rounded-xl border border-slate-300/25 bg-slate-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200';
const POPUP_SECTION_TAB_BASE =
  'rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all duration-200';
const POPUP_SECTION_TAB_ACTIVE =
  'border-cyan-300/55 bg-cyan-500/18 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.2)]';
const POPUP_SECTION_TAB_IDLE = 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-cyan-300/35 hover:bg-cyan-500/10 hover:text-cyan-100';

function PopupButtonLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 leading-none">
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function estimatedBandwidthKbps(bot: TradeBotRow | null, connectedEndpoints: number) {
  if (!bot || connectedEndpoints <= 0) return '0.0 kbps';
  const instances = Number(bot.counts?.instances || 0);
  const orders = Number(bot.counts?.orders || 0);
  const estimate = 8 + instances * 5.5 + Math.min(orders, 1000) * 0.08 + connectedEndpoints * 2.3;
  return `${estimate.toFixed(1)} kbps`;
}

function roundDownToStep(value: number, stepSize: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(stepSize) || stepSize <= 0) return value;
  return Math.floor(value / stepSize) * stepSize;
}

function resolvePreviewMinQuoteSpendFloor(previewSide: PreviewSide, minQuoteSpend: number) {
  const floor = Math.max(0, Number(minQuoteSpend || 0));
  return previewSide === 'buy' ? floor : 0;
}

function resolvePreviewEffectiveMinNotional({
  previewSide,
  exchangeMinNotional,
  minQuoteSpend
}: {
  previewSide: PreviewSide;
  exchangeMinNotional: number;
  minQuoteSpend: number;
}) {
  const exchangeFloor = Math.max(0, Number(exchangeMinNotional || 0));
  const quoteSpendFloor = resolvePreviewMinQuoteSpendFloor(previewSide, minQuoteSpend);
  return Math.max(exchangeFloor, quoteSpendFloor);
}

function hashSignalKey(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const normalized = hash >>> 0;
  return `sig_${normalized.toString(16).padStart(8, '0')}`;
}

function splitPineArgs(body: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) args.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) args.push(tail);
  return args;
}

function parsePineArgParts(rawArgs: string): { positional: string[]; named: Record<string, string> } {
  const parts = splitPineArgs(rawArgs);
  const positional: string[] = [];
  const named: Record<string, string> = {};

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex > 0) {
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (key) {
        named[key] = value;
        continue;
      }
    }
    positional.push(part.trim());
  }
  return { positional, named };
}

function stripPineQuotes(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('\'') && raw.endsWith('\''))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parsePineLiteral(value: string): string | number | boolean | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  return stripPineQuotes(raw);
}

function extractPineInputSettings(source: string): PineInputSetting[] {
  const settings: PineInputSetting[] = [];
  const lineRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*input(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*\((.*)\)\s*$/gm;
  let match: RegExpExecArray | null = null;
  while ((match = lineRegex.exec(source))) {
    const key = String(match[1] || '').trim();
    const type = String(match[2] || 'generic').trim().toLowerCase();
    const argsRaw = String(match[3] || '').trim();
    const { positional, named } = parsePineArgParts(argsRaw);
    const titleRaw = named.title || named.label || positional.find((part) => /^["']/.test(part)) || null;
    const defRaw = named.defval || named.default || positional.find((part) => !/^["']/.test(part)) || null;
    settings.push({
      key,
      type,
      title: titleRaw ? stripPineQuotes(titleRaw) : null,
      defaultValue: defRaw ? parsePineLiteral(defRaw) : null,
      raw: match[0].trim()
    });
  }
  return settings;
}

function extractPineHeader(source: string): {
  scriptType: PineScriptAnalysis['scriptType'];
  name: string | null;
  interval: string | null;
} {
  const headerMatch = source.match(/^\s*(strategy|indicator)\s*\(([\s\S]*?)\)\s*$/m);
  if (!headerMatch) {
    return { scriptType: 'unknown', name: null, interval: null };
  }
  const scriptType = String(headerMatch[1]).toLowerCase() === 'strategy' ? 'strategy' : 'indicator';
  const argsRaw = String(headerMatch[2] || '');
  const { positional, named } = parsePineArgParts(argsRaw);
  const nameRaw = named.title || positional[0] || null;
  const timeframeRaw = named.timeframe || named.resolution || null;
  const interval = timeframeRaw ? normalizeTimeframe(stripPineQuotes(timeframeRaw)) : null;
  return {
    scriptType,
    name: nameRaw ? stripPineQuotes(nameRaw) : null,
    interval
  };
}

function extractPineIndicators(source: string): string[] {
  const indicators = new Set<string>();
  const regex = /\bta\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source))) {
    indicators.add(String(match[1] || '').trim().toLowerCase());
  }
  return Array.from(indicators);
}

function extractPineFunctions(source: string): string[] {
  const functions = new Set<string>();
  const customFnRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*=>/gm;
  let custom: RegExpExecArray | null = null;
  while ((custom = customFnRegex.exec(source))) {
    functions.add(String(custom[1] || '').trim());
  }
  const builtInRegex = /\b(math|ta|str|array|request|timeframe)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let builtIn: RegExpExecArray | null = null;
  while ((builtIn = builtInRegex.exec(source))) {
    functions.add(`${builtIn[1]}.${builtIn[2]}`);
  }
  return Array.from(functions);
}

function extractPineActions(source: string): string[] {
  const actions = new Set<string>();
  const regex = /\bstrategy\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source))) {
    actions.add(String(match[1] || '').trim().toLowerCase());
  }
  return Array.from(actions);
}

function findPineNumericSetting(settings: PineInputSetting[], patterns: RegExp[]) {
  for (const item of settings) {
    const haystack = `${item.key} ${item.title || ''}`.toLowerCase();
    if (!patterns.some((pattern) => pattern.test(haystack))) continue;
    if (typeof item.defaultValue === 'number' && Number.isFinite(item.defaultValue)) {
      return item.defaultValue;
    }
  }
  return null;
}

function deriveRulesPatchFromPineAnalysis(analysis: PineScriptAnalysis): Partial<BotTradingRules> {
  const patch: Partial<BotTradingRules> = {
    pineAnalysis: analysis
  };

  if (analysis.interval) {
    patch.signalTimeframe = normalizeTimeframe(analysis.interval);
  }

  const slPct = findPineNumericSetting(analysis.indicatorSettings, [/stop.*loss/, /\bsl\b/, /loss.*pct/, /sl.*percent/]);
  const tpPct = findPineNumericSetting(analysis.indicatorSettings, [/take.*profit/, /\btp\b/, /profit.*pct/, /tp.*percent/]);
  const rr = findPineNumericSetting(analysis.indicatorSettings, [/risk.*reward/, /\brr\b/, /reward.*risk/]);
  const atrLength = findPineNumericSetting(analysis.indicatorSettings, [/atr.*length/, /\batr.*len\b/, /\blen.*atr\b/]);
  const atrMultiplier = findPineNumericSetting(analysis.indicatorSettings, [/atr.*mult/, /mult.*atr/, /atr.*factor/]);
  const dailyLoss = findPineNumericSetting(analysis.indicatorSettings, [/daily.*loss/, /max.*daily.*loss/, /loss.*cap/]);
  const reinvestment = findPineNumericSetting(analysis.indicatorSettings, [/reinvest/, /investment/, /capital.*alloc/, /equity.*pct/]);

  if (analysis.indicators.includes('atr') && (atrMultiplier || atrLength)) {
    patch.slType = 'atr_multiplier';
    if (atrLength && atrLength >= 2) patch.slAtrLength = Math.floor(atrLength);
    if (atrMultiplier && atrMultiplier > 0) patch.slAtrMultiplier = atrMultiplier;
  } else if (slPct && slPct > 0) {
    patch.slType = 'percent';
    patch.slValue = slPct;
  }

  if (tpPct && tpPct > 0) {
    patch.tpType = 'percent';
    patch.tpValue = tpPct;
  } else if (rr && rr > 0) {
    patch.tpType = 'rr';
    patch.tpValue = rr;
  }

  if (dailyLoss && dailyLoss > 0) {
    patch.dailyLossCapEnabled = true;
    patch.dailyLossLimitPct = dailyLoss;
  }

  if (reinvestment && reinvestment > 0) {
    patch.sizingMode = 'balance_pct';
    patch.allocationValue = Math.max(0, Math.min(100, reinvestment));
    patch.reinvestmentPct = Math.max(0, Math.min(100, reinvestment));
  }

  return patch;
}

function analyzePineScriptSource(source: string): PineScriptAnalysis {
  const clean = String(source || '').replace(/\r\n/g, '\n').trim();
  const header = extractPineHeader(clean);
  const inputSettings = extractPineInputSettings(clean);
  const indicators = extractPineIndicators(clean);
  const functions = extractPineFunctions(clean);
  const actions = extractPineActions(clean);
  const notes: string[] = [];

  if (!header.name) notes.push('Strategy/indicator title not found.');
  if (!header.interval) notes.push('No explicit timeframe in script header. Set Signal Timeframe manually if needed.');
  if (!inputSettings.length) notes.push('No input.* parameters detected.');
  if (!indicators.length) notes.push('No ta.* indicators detected.');

  return {
    scriptType: header.scriptType,
    name: header.name,
    interval: header.interval,
    indicators,
    functions,
    actions,
    indicatorSettings: inputSettings,
    notes,
    sourceDigest: hashSignalKey(clean).slice(4),
    generatedAt: new Date().toISOString()
  };
}

export default function TradeBotsModule() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tabId } = useParams<{ tabId?: string }>();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const legacyPopupBotId = queryParams.get('legacyPopupBotId') || queryParams.get('popupBotId') || '';
  const legacyPopupSection = normalizePopupSectionFromQuery(
    queryParams.get('legacyPopupSection') || queryParams.get('popupSection')
  );
  const forceBotsTabFromQuery = Boolean(legacyPopupBotId);
  const activeTab: TabKey = forceBotsTabFromQuery ? 'bots' : isTradeBotTabKey(tabId) ? tabId : 'overview';
  const [bots, setBots] = useState<TradeBotRow[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [botsError, setBotsError] = useState('');
  const [rentalsError, setRentalsError] = useState('');
  const [query, setQuery] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [selectedBot, setSelectedBot] = useState<TradeBotRow | null>(null);
  const [activePopupSection, setActivePopupSection] = useState<BotPopupSection>('integrations');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [webhookProfile, setWebhookProfile] = useState<MyWebhookResponse | null>(null);
  const [exchangeAccounts, setExchangeAccounts] = useState<ExchangeAccount[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instanceActionTargetId, setInstanceActionTargetId] = useState<string | null>(null);
  const [botActionInFlight, setBotActionInFlight] = useState<BotLifecycleAction | null>(null);
  const [integrationActionTargetId, setIntegrationActionTargetId] = useState<string | null>(null);
  const [integrationActionInFlight, setIntegrationActionInFlight] = useState<IntegrationLifecycleAction | null>(null);
  const [testingIntegrationId, setTestingIntegrationId] = useState<string | null>(null);
  const [botLinks, setBotLinks] = useState<Record<string, BotConnectivityLink>>(() => readBotLinks());
  const [botRulesMap, setBotRulesMap] = useState<Record<string, BotTradingRules>>(() => readBotTradingRulesMap());
  const [integrationDetail, setIntegrationDetail] = useState<IntegrationDetail>(null);
  const [tradingSymbol, setTradingSymbol] = useState('BTCUSDC');
  const [botRulesDraft, setBotRulesDraft] = useState<BotTradingRules | null>(null);
  const [exchangeSnapshot, setExchangeSnapshot] = useState<OrderCheckSnapshot | null>(null);
  const [tradingDetailsLoading, setTradingDetailsLoading] = useState(false);
  const [tradingDetailsError, setTradingDetailsError] = useState('');
  const [pineScriptSource, setPineScriptSource] = useState('');
  const [pineScriptFileName, setPineScriptFileName] = useState('');
  const [algoBaseStart, setAlgoBaseStart] = useState(10);
  const [algoBaseEnd, setAlgoBaseEnd] = useState(50);
  const [algoMathSide, setAlgoMathSide] = useState<PreviewSide>('buy');
  const selectedBotIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedBotIdRef.current = selectedBot?.id || null;
  }, [selectedBot?.id]);

  useEffect(() => {
    if (forceBotsTabFromQuery) return;
    if (isTradeBotTabKey(tabId)) return;
    if (tabId !== 'overview') {
      navigate('/platform/trade-bots/overview', { replace: true });
    }
  }, [forceBotsTabFromQuery, navigate, tabId]);

  const selectedBotLink = useMemo<BotConnectivityLink>(() => {
    if (!selectedBot) return {};
    return botLinks[selectedBot.id] || {};
  }, [botLinks, selectedBot]);

  const selectedBotRules = useMemo(() => {
    if (!selectedBot) return createDefaultTradingRules(DEFAULT_TRADING_RULES.symbol);
    return botRulesMap[selectedBot.id] || createDefaultTradingRulesForBot(selectedBot);
  }, [botRulesMap, selectedBot]);

  const webhookUrls = useMemo(() => collectWebhookUrls(webhookProfile), [webhookProfile]);

  const linkedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === selectedBotLink.integrationId) || null,
    [integrations, selectedBotLink.integrationId]
  );

  const linkedExchangeAccount = useMemo(
    () => exchangeAccounts.find((account) => account.id === selectedBotLink.exchangeAccountId) || null,
    [exchangeAccounts, selectedBotLink.exchangeAccountId]
  );

  const tradingViewConnected = useMemo(() => {
    if (!selectedBotLink.webhookUrl) return false;
    return webhookUrls.includes(selectedBotLink.webhookUrl);
  }, [selectedBotLink.webhookUrl, webhookUrls]);

  const exchangeConnected = useMemo(() => integrationIsHealthy(linkedIntegration?.status), [linkedIntegration?.status]);

  const connectedEndpoints = Number(tradingViewConnected) + Number(exchangeConnected);
  const connectivityBandwidth = estimatedBandwidthKbps(selectedBot, connectedEndpoints);
  const overallConnectivityStatus = connectedEndpoints === 2 ? 'connected' : connectedEndpoints === 1 ? 'partial' : 'disconnected';
  const marketFilters = exchangeSnapshot?.market?.filters?.data || null;
  const marketTicker = exchangeSnapshot?.market?.ticker?.data || null;
  const marketPrices = exchangeSnapshot?.market?.prices?.data || null;
  const marketAtr = exchangeSnapshot?.market?.atr?.data || null;
  const symbolAssets = useMemo(
    () => resolveSymbolAssets(tradingSymbol, marketFilters?.baseAsset || null, marketFilters?.quoteAsset || null),
    [marketFilters?.baseAsset, marketFilters?.quoteAsset, tradingSymbol]
  );
  const balanceAssets = useMemo(() => {
    const rows = exchangeSnapshot?.currentBalance?.source?.data?.assets;
    return Array.isArray(rows) ? rows : [];
  }, [exchangeSnapshot]);
  const quoteAssetBalance = useMemo(() => {
    if (!symbolAssets.quoteAsset) return null;
    return balanceAssets.find((row: any) => String(row?.asset || '').toUpperCase() === symbolAssets.quoteAsset) || null;
  }, [balanceAssets, symbolAssets.quoteAsset]);
  const baseAssetBalance = useMemo(() => {
    if (!symbolAssets.baseAsset) return null;
    return balanceAssets.find((row: any) => String(row?.asset || '').toUpperCase() === symbolAssets.baseAsset) || null;
  }, [balanceAssets, symbolAssets.baseAsset]);
  const openOrdersSummary = exchangeSnapshot?.isStillOpen?.source?.data || null;
  const tradesSummary = exchangeSnapshot?.didTradeHappen?.source?.myTrades?.data || null;
  const tradeHistoryRows = useMemo(() => {
    const rawItems = Array.isArray((tradesSummary as any)?.items) ? (tradesSummary as any).items : [];
    return rawItems.map((item: any, index: number) => {
      const timestamp = Number(item?.time);
      const executedAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null;
      const side =
        item?.isBuyer === true ? 'BUY' : item?.isBuyer === false ? 'SELL' : String(item?.side || '').toUpperCase() || '—';
      const price = Number(item?.price);
      const qty = Number(item?.qty);
      const quoteQty = Number(item?.quoteQty);
      const commission = Number(item?.commission);
      const commissionAsset = String(item?.commissionAsset || '').toUpperCase();
      const fee =
        Number.isFinite(commission) && commission > 0
          ? `${formatDecimal(commission, 10)}${commissionAsset ? ` ${commissionAsset}` : ''}`
          : '—';
      return {
        id: `${String(item?.orderId || 'order')}:${String(item?.id || item?.tradeId || index)}`,
        executedAt,
        symbol: String(item?.symbol || selectedBotRules.symbol || tradingSymbol || '—').toUpperCase(),
        side,
        price: Number.isFinite(price) ? price : null,
        qty: Number.isFinite(qty) ? qty : null,
        quoteQty: Number.isFinite(quoteQty) ? quoteQty : null,
        orderId: item?.orderId ? String(item.orderId) : '—',
        fee,
        liquidity: item?.isMaker === true ? 'maker' : item?.isMaker === false ? 'taker' : '—',
        signalStatus: item?.isBestMatch === true ? 'matched' : item?.isBestMatch === false ? 'review' : 'captured'
      };
    });
  }, [selectedBotRules.symbol, tradesSummary, tradingSymbol]);
  const integrationCredentials = integrationDetail?.credentials || [];
  const integrationLogs = integrationDetail?.logs || [];
  const activeRules = botRulesDraft || selectedBotRules;
  const algoIsSell = algoMathSide === 'sell';
  const activePineAnalysis = activeRules?.pineAnalysis || null;
  const activeCodeParameterSchema = activeRules?.codeParameterSchema || [];
  const activeCodeParameterValues = activeRules?.codeParameters || {};
  const codeParameterByKey = useMemo(() => {
    const map = new Map<string, BotCodeParameter>();
    activeCodeParameterSchema.forEach((item) => map.set(String(item.key || '').trim(), item));
    return map;
  }, [activeCodeParameterSchema]);
  const isArnPineBot = useMemo(
    () => isArnPineFaithfulBot(selectedBot, activeRules, activeCodeParameterSchema),
    [activeCodeParameterSchema, activeRules, selectedBot]
  );
  const arnParameterSchema = useMemo(
    () =>
      ARN_PINE_PARAMETER_KEYS.map((key) => codeParameterByKey.get(key))
        .filter(Boolean)
        .map((item) => item as BotCodeParameter),
    [codeParameterByKey]
  );
  const popupSections = useMemo<Array<{ key: BotPopupSection; label: string }>>(() => {
    const base: Array<{ key: BotPopupSection; label: string }> = [
      { key: 'integrations', label: 'Integrations' },
      { key: 'parameters', label: 'Parameters' },
      { key: 'algo', label: 'Algo' },
      { key: 'exchange', label: 'Exchange' },
      { key: 'trade-history', label: 'Trade History' }
    ];
    if (isArnPineBot) {
      base.splice(3, 0, { key: 'arn-pine', label: 'ARN Pine' });
    }
    return base;
  }, [isArnPineBot]);
  const arnParameterValueByKey = useMemo<Record<string, BotCodeParameterValue>>(() => {
    const values: Record<string, BotCodeParameterValue> = {};
    arnParameterSchema.forEach((param) => {
      values[param.key] = Object.prototype.hasOwnProperty.call(activeCodeParameterValues, param.key)
        ? activeCodeParameterValues[param.key]
        : param.defaultValue;
    });
    return values;
  }, [activeCodeParameterValues, arnParameterSchema]);
  const signalKeySeed = useMemo(() => {
    if (!activeRules) return '';
    return `${selectedBot?.id || 'bot'}:${activeRules.symbol}:${activeRules.signalTimeframe}:${activeRules.signalSource}`;
  }, [activeRules, selectedBot?.id]);
  const signalHashKey = useMemo(() => hashSignalKey(signalKeySeed), [signalKeySeed]);
  const arnSignalPreview = useMemo(() => {
    if (!isArnPineBot || arnParameterSchema.length === 0) return null;
    const readNumber = (key: string, fallback: number) => {
      const n = Number(arnParameterValueByKey[key]);
      return Number.isFinite(n) ? n : fallback;
    };
    const readBoolean = (key: string, fallback: boolean) => {
      const value = arnParameterValueByKey[key];
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      const text = String(value ?? '')
        .trim()
        .toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(text)) return true;
      if (['false', '0', 'no', 'off'].includes(text)) return false;
      return fallback;
    };
    const readText = (key: string, fallback = '') => {
      const value = arnParameterValueByKey[key];
      if (value === null || value === undefined || value === '') return fallback;
      return String(value);
    };

    return {
      signal_id: signalHashKey,
      symbol: readText('symbol', tradingSymbol || activeRules.symbol || 'BTCUSDT'),
      action: readText('action', 'ENTRY').toUpperCase(),
      direction: readText('direction', 'LONG').toUpperCase(),
      price: Number(marketPrices?.last || marketTicker?.price || 0) || 0,
      bar_index: 0,
      atr: Number(marketAtr?.value || 0) || null,
      volatility_spike: readBoolean('volatility_spike', false),
      leverage: readNumber('leverage', 1),
      tp_percent: readNumber('tp_percent', 1),
      sl_atr_multiplier: readNumber('sl_atr_multiplier', 1.5),
      investment_percentage: readNumber('investment_percentage', 90),
      daily_loss_limit: readNumber('daily_loss_limit', 5),
      cooldown_candles: Math.floor(readNumber('cooldown_candles', 2)),
      timestamp_ms: Date.now()
    };
  }, [
    activeRules.symbol,
    arnParameterSchema.length,
    arnParameterValueByKey,
    isArnPineBot,
    marketAtr?.value,
    marketPrices?.last,
    marketTicker?.price,
    signalHashKey,
    tradingSymbol
  ]);
  const allocationLabel = useMemo(() => {
    if (!activeRules) return 'Allocation Value';
    if (activeRules.sizingMode === 'fixed_quote') return 'Allocation (USDC)';
    if (activeRules.sizingMode === 'risk_per_trade_pct') return 'Risk / Trade %';
    return 'Allocation %';
  }, [activeRules]);
  const sideAwareMinNotional = useMemo(() => {
    const minQuoteSpend = Math.max(0, Number(activeRules?.minQuoteSpend || 0));
    const exchangeMinNotional = Math.max(0, Number(marketFilters?.minNotional || 0));
    return {
      exchangeMinNotional,
      buyFloor: resolvePreviewEffectiveMinNotional({
        previewSide: 'buy',
        exchangeMinNotional,
        minQuoteSpend
      }),
      sellFloor: resolvePreviewEffectiveMinNotional({
        previewSide: 'sell',
        exchangeMinNotional,
        minQuoteSpend
      })
    };
  }, [activeRules?.minQuoteSpend, marketFilters?.minNotional]);
  const rulesPreview = useMemo(() => {
    const rules = activeRules;
    if (!rules) return null;

    const freeQuote = Number(quoteAssetBalance?.free || 0);
    const freeBase = Number(baseAssetBalance?.free || 0);
    const referencePrices = {
      last: Number(marketPrices?.last || marketTicker?.price || 0),
      mark: Number(marketPrices?.mark || marketPrices?.last || marketTicker?.price || 0),
      mid: Number(marketPrices?.mid || marketPrices?.mark || marketPrices?.last || marketTicker?.price || 0)
    };
    const refPrice = referencePrices[rules.referencePriceSource] || 0;
    const stepSize = Number(marketFilters?.stepSize || 0);
    const exchangeMinNotional = Number(marketFilters?.minNotional || 0);
    const minQuoteSpend = Math.max(0, Number(rules.minQuoteSpend || 0));
    const maxQuoteSpend = Math.max(minQuoteSpend, Number(rules.maxQuoteSpend || 0));
    const minQuoteSpendFloor = resolvePreviewMinQuoteSpendFloor(rules.previewSide, minQuoteSpend);
    const allocationValue = Math.max(0, Number(rules.allocationValue || 0));
    const reinvestmentFactor = Math.max(0, Math.min(1, Number(rules.reinvestmentPct || 0) / 100));
    const atrValue = Number(marketAtr?.value || 0);

    let quoteSpendRawBase = 0;
    if (rules.sizingMode === 'fixed_quote') {
      quoteSpendRawBase = allocationValue;
    } else if (rules.sizingMode === 'balance_pct' || rules.sizingMode === 'risk_per_trade_pct') {
      quoteSpendRawBase = freeQuote * (allocationValue / 100);
    } else {
      const atrPct = refPrice > 0 && atrValue > 0 ? atrValue / refPrice : 0;
      const volatilityFactor = atrPct > 0 ? 1 / (1 + atrPct * 10) : 1;
      quoteSpendRawBase = freeQuote * (allocationValue / 100) * volatilityFactor;
    }

    const quoteSpendBeforeCompounding =
      rules.sizingMode === 'fixed_quote' ? quoteSpendRawBase : quoteSpendRawBase * reinvestmentFactor;
    const compoundingMath = applyCompoundingToQuoteSpendMath({
      baseQuoteSpend: quoteSpendBeforeCompounding,
      freeQuote,
      compoundingEnabled: rules.compoundingEnabled,
      compoundingMode: rules.compoundingMode,
      compoundingBaseQuote: rules.compoundingBaseQuote,
      compoundingPct: rules.compoundingPct,
      targetSpendPct: rules.targetSpendPct
    });
    const quoteSpendRaw = compoundingMath.quoteSpend;
    const quoteSpend = Math.max(minQuoteSpendFloor, Math.min(maxQuoteSpend, quoteSpendRaw));
    const qtyRaw = refPrice > 0 ? quoteSpend / refPrice : 0;
    const qtyFinal = roundDownToStep(qtyRaw, stepSize);
    const notionalAfterRounding = qtyFinal * (refPrice || 0);
    const effectiveMinNotionalBuy = resolvePreviewEffectiveMinNotional({
      previewSide: 'buy',
      exchangeMinNotional,
      minQuoteSpend
    });
    const effectiveMinNotionalSell = resolvePreviewEffectiveMinNotional({
      previewSide: 'sell',
      exchangeMinNotional,
      minQuoteSpend
    });
    const effectiveMinNotional = rules.previewSide === 'sell' ? effectiveMinNotionalSell : effectiveMinNotionalBuy;

    let status: 'ready' | 'warning' | 'rejected' = 'ready';
    let reason = '';
    if (!refPrice || refPrice <= 0) {
      status = 'rejected';
      reason = 'No reference price';
    } else if (qtyFinal <= 0) {
      status = 'rejected';
      reason = 'Quantity becomes zero after rounding';
    } else if (notionalAfterRounding < effectiveMinNotional) {
      status = 'rejected';
      reason = 'Notional after rounding is below min notional';
    } else if (rules.previewSide !== 'sell' && quoteSpend > freeQuote) {
      status = 'warning';
      reason = 'Configured quote spend is above free quote balance';
    } else if (rules.previewSide === 'sell' && qtyFinal > freeBase) {
      status = 'warning';
      reason = 'Sell quantity is above free base balance';
    } else if (rules.maxPositionExposurePct > 0 && quoteSpend > freeQuote * (rules.maxPositionExposurePct / 100)) {
      status = 'warning';
      reason = 'Quote spend exceeds max exposure %';
    } else if (rules.maxOpenPositionsPerSymbol > 0 && Number(openOrdersSummary?.countForSymbol || 0) >= rules.maxOpenPositionsPerSymbol) {
      status = 'warning';
      reason = 'Open positions/orders already at configured max per symbol';
    }

    const side = rules.previewSide;
    const slValue = Number(rules.slValue || 0);
    const tpValue = Number(rules.tpValue || 0);
    let slPrice: number | null = null;
    if (rules.slType === 'percent' && refPrice > 0 && slValue > 0) {
      const pct = slValue / 100;
      slPrice = side === 'buy' ? refPrice * (1 - pct) : refPrice * (1 + pct);
    } else if (rules.slType === 'fixed_price' && slValue > 0) {
      slPrice = slValue;
    } else if (rules.slType === 'atr_multiplier' && refPrice > 0 && atrValue > 0 && Number(rules.slAtrMultiplier || 0) > 0) {
      const distance = atrValue * Number(rules.slAtrMultiplier);
      slPrice = side === 'buy' ? refPrice - distance : refPrice + distance;
    }

    let tpPrice: number | null = null;
    if (rules.tpType === 'percent' && refPrice > 0 && tpValue > 0) {
      const pct = tpValue / 100;
      tpPrice = side === 'buy' ? refPrice * (1 + pct) : refPrice * (1 - pct);
    } else if (rules.tpType === 'fixed_price' && tpValue > 0) {
      tpPrice = tpValue;
    } else if (rules.tpType === 'rr' && slPrice && refPrice > 0 && tpValue > 0) {
      const riskDistance = Math.abs(refPrice - slPrice);
      tpPrice = side === 'buy' ? refPrice + riskDistance * tpValue : refPrice - riskDistance * tpValue;
    }

    return {
      status,
      reason,
      previewSide: rules.previewSide,
      freeQuote,
      freeBase,
      refPrice,
      stepSize,
      exchangeMinNotional,
      minQuoteSpendFloor,
      effectiveMinNotionalBuy,
      effectiveMinNotionalSell,
      effectiveMinNotional,
      quoteSpendBeforeCompounding,
      quoteSpendRaw,
      quoteSpend,
      compoundingEnabled: rules.compoundingEnabled,
      compoundingMode: rules.compoundingMode,
      compoundingPct: rules.compoundingPct,
      compoundingBaseQuoteConfigured: compoundingMath.compoundingBaseQuoteConfigured,
      compoundingBaseQuoteAuto: compoundingMath.compoundingBaseQuoteAuto,
      compoundingBaseQuoteUsed: compoundingMath.compoundingBaseQuoteUsed,
      compoundingProfitQuote: compoundingMath.compoundingProfitQuote,
      compoundingFactor: compoundingMath.compoundingFactor,
      targetSpendPct: compoundingMath.targetSpendPct,
      targetSpendRatio: compoundingMath.targetSpendRatio,
      targetSpendApplied: compoundingMath.targetSpendApplied,
      qtyRaw,
      qtyFinal,
      notionalAfterRounding,
      atrValue,
      referencePriceSource: rules.referencePriceSource,
      slPrice,
      tpPrice
    };
  }, [
    openOrdersSummary?.countForSymbol,
    baseAssetBalance?.free,
    botRulesDraft,
    marketFilters?.minNotional,
    marketFilters?.stepSize,
    marketPrices?.last,
    marketPrices?.mark,
    marketPrices?.mid,
    marketAtr?.value,
    marketTicker?.price,
    quoteAssetBalance?.free,
    activeRules
  ]);
  const algoLatestBuyPrice = useMemo(() => {
    for (const row of tradeHistoryRows) {
      if (String(row?.side || '').toUpperCase() !== 'BUY') continue;
      const price = Number(row?.price);
      if (Number.isFinite(price) && price > 0) return price;
    }
    return null;
  }, [tradeHistoryRows]);
  const algoMathPreview = useMemo(() => {
    if (!activeRules || !rulesPreview) return null;
    const refPrice = Number(rulesPreview.refPrice || 0);
    const allocationValue = Math.max(0, Number(activeRules.allocationValue || 0));
    const maxQuoteSpend = Math.max(
      Math.max(0, Number(activeRules.minQuoteSpend || 0)),
      Math.max(0, Number(activeRules.maxQuoteSpend || 0))
    );
    const isSell = algoMathSide === 'sell';

    if (!isSell) {
      const compoundingMath = applyCompoundingToQuoteSpendMath({
        baseQuoteSpend: rulesPreview.quoteSpendBeforeCompounding,
        freeQuote: rulesPreview.freeQuote,
        compoundingEnabled: activeRules.compoundingEnabled,
        compoundingMode: activeRules.compoundingMode,
        compoundingBaseQuote: activeRules.compoundingBaseQuote,
        compoundingPct: activeRules.compoundingPct,
        targetSpendPct: activeRules.targetSpendPct
      });
      const quoteSpendRaw = compoundingMath.quoteSpend;
      const quoteSpend = Math.max(
        resolvePreviewMinQuoteSpendFloor('buy', Number(activeRules.minQuoteSpend || 0)),
        Math.min(maxQuoteSpend, quoteSpendRaw)
      );
      const qtyRaw = refPrice > 0 ? quoteSpend / refPrice : 0;
      return {
        side: 'buy' as const,
        refPrice,
        freeQuote: Number(rulesPreview.freeQuote || 0),
        freeBase: Number(rulesPreview.freeBase || 0),
        capacityQuote: Number(rulesPreview.freeQuote || 0),
        baseSpend: Number(rulesPreview.quoteSpendBeforeCompounding || 0),
        quoteSpendRaw,
        quoteSpend,
        qtyRaw,
        compoundingEnabled: activeRules.compoundingEnabled,
        compoundingMode: activeRules.compoundingMode,
        compoundingPct: activeRules.compoundingPct,
        compoundingBaseQuoteConfigured: compoundingMath.compoundingBaseQuoteConfigured,
        compoundingBaseQuoteAuto: compoundingMath.compoundingBaseQuoteAuto,
        compoundingBaseQuoteUsed: compoundingMath.compoundingBaseQuoteUsed,
        compoundingProfitQuote: compoundingMath.compoundingProfitQuote,
        compoundingFactor: compoundingMath.compoundingFactor,
        targetSpendPct: compoundingMath.targetSpendPct,
        targetSpendRatio: compoundingMath.targetSpendRatio,
        targetSpendApplied: compoundingMath.targetSpendApplied,
        profitSide: true,
        referenceBuyPrice: null as number | null,
        ladderApplied: false,
        ladderFactor: null as number | null,
        ladderEdgeRatio: null as number | null
      };
    }

    const freeBase = Number(rulesPreview.freeBase || 0);
    const sellCapacityQuote = Math.max(0, freeBase * Math.max(0, refPrice));
    const baseSellQuoteSpend =
      activeRules.sizingMode === 'fixed_quote'
        ? allocationValue
        : sellCapacityQuote * (allocationValue / 100);
    const referenceBuyPrice = Number(algoLatestBuyPrice || 0) > 0 ? Number(algoLatestBuyPrice) : null;
    const profitSide =
      referenceBuyPrice !== null && refPrice > 0
        ? refPrice > referenceBuyPrice
        : false;
    const compoundingMath = applyCompoundingToQuoteSpendMath({
      baseQuoteSpend: baseSellQuoteSpend,
      freeQuote: sellCapacityQuote,
      compoundingEnabled: activeRules.sellCompoundingEnabled,
      compoundingMode: activeRules.sellCompoundingMode,
      compoundingBaseQuote: activeRules.sellCompoundingBaseQuote,
      compoundingPct: activeRules.sellCompoundingPct,
      targetSpendPct: activeRules.sellTargetSpendPct
    });
    let quoteSpendRaw = profitSide ? compoundingMath.quoteSpend : baseSellQuoteSpend;
    let ladderApplied = false;
    let ladderFactor: number | null = null;
    let ladderEdgeRatio: number | null = null;

    if (!profitSide && activeRules.sellLadderEnabled) {
      const baseQty = refPrice > 0 ? baseSellQuoteSpend / refPrice : 0;
      const ladderMath = applySellLadderToSellQuantityMath({
        qtyRaw: baseQty,
        freeBase,
        marketSellPrice: refPrice,
        referenceBuyPrice,
        sellLadderEnabled: activeRules.sellLadderEnabled,
        sellLadderStrengthPct: activeRules.sellLadderStrengthPct,
        sellLadderMinFactor: activeRules.sellLadderMinFactor,
        sellLadderMaxFactor: activeRules.sellLadderMaxFactor
      });
      quoteSpendRaw = ladderMath.qtyRaw * Math.max(0, refPrice);
      ladderApplied = ladderMath.applied;
      ladderFactor = ladderMath.applied ? ladderMath.factor : null;
      ladderEdgeRatio = ladderMath.applied ? ladderMath.edgeRatio : null;
    }

    const quoteSpend = Math.max(0, Math.min(maxQuoteSpend, quoteSpendRaw));
    const qtyRaw = refPrice > 0 ? quoteSpend / refPrice : 0;
    return {
      side: 'sell' as const,
      refPrice,
      freeQuote: Number(rulesPreview.freeQuote || 0),
      freeBase,
      capacityQuote: sellCapacityQuote,
      baseSpend: baseSellQuoteSpend,
      quoteSpendRaw,
      quoteSpend,
      qtyRaw,
      compoundingEnabled: activeRules.sellCompoundingEnabled,
      compoundingMode: activeRules.sellCompoundingMode,
      compoundingPct: activeRules.sellCompoundingPct,
      compoundingBaseQuoteConfigured: compoundingMath.compoundingBaseQuoteConfigured,
      compoundingBaseQuoteAuto: compoundingMath.compoundingBaseQuoteAuto,
      compoundingBaseQuoteUsed: compoundingMath.compoundingBaseQuoteUsed,
      compoundingProfitQuote: profitSide ? compoundingMath.compoundingProfitQuote : 0,
      compoundingFactor: profitSide ? compoundingMath.compoundingFactor : 1,
      targetSpendPct: compoundingMath.targetSpendPct,
      targetSpendRatio: compoundingMath.targetSpendRatio,
      targetSpendApplied: profitSide ? compoundingMath.targetSpendApplied : false,
      profitSide,
      referenceBuyPrice,
      ladderApplied,
      ladderFactor,
      ladderEdgeRatio
    };
  }, [
    activeRules,
    algoLatestBuyPrice,
    algoMathSide,
    rulesPreview
  ]);
  const targetSpendSuggestedBaseQuote = useMemo(() => {
    if (!algoMathPreview || !activeRules) return null;
    if (algoMathPreview.side === 'sell') {
      return deriveCompoundingBaseQuoteForTargetSpend({
        baseQuoteSpend: algoMathPreview.baseSpend,
        freeQuote: algoMathPreview.capacityQuote,
        compoundingEnabled: true,
        compoundingMode: activeRules.sellCompoundingMode,
        compoundingPct: activeRules.sellCompoundingPct,
        targetSpendPct: activeRules.sellTargetSpendPct
      });
    }
    return deriveCompoundingBaseQuoteForTargetSpend({
      baseQuoteSpend: algoMathPreview.baseSpend,
      freeQuote: algoMathPreview.capacityQuote,
      compoundingEnabled: true,
      compoundingMode: activeRules.compoundingMode,
      compoundingPct: activeRules.compoundingPct,
      targetSpendPct: activeRules.targetSpendPct
    });
  }, [
    activeRules,
    algoMathPreview
  ]);
  const algoCompoundingRows = useMemo(() => {
    if (!activeRules || !algoMathPreview) return [];
    const startRaw = Math.floor(Number(algoBaseStart));
    const endRaw = Math.floor(Number(algoBaseEnd));
    const startSafe = Number.isFinite(startRaw) ? startRaw : 10;
    const endSafe = Number.isFinite(endRaw) ? endRaw : 50;
    const start = Math.max(1, Math.min(startSafe, endSafe));
    const end = Math.max(start, Math.max(startSafe, endSafe));
    const cappedEnd = Math.min(1000, end);

    const rows: Array<{ compoundingBaseQuote: number; compoundingFactor: number; quoteSpendRaw: number }> = [];
    for (let baseQuote = start; baseQuote <= cappedEnd; baseQuote += 1) {
      const sideIsSell = algoMathPreview.side === 'sell';
      const math = applyCompoundingToQuoteSpendMath({
        baseQuoteSpend: algoMathPreview.baseSpend,
        freeQuote: algoMathPreview.capacityQuote,
        compoundingEnabled: sideIsSell ? activeRules.sellCompoundingEnabled : activeRules.compoundingEnabled,
        compoundingMode: sideIsSell ? activeRules.sellCompoundingMode : activeRules.compoundingMode,
        compoundingBaseQuote: baseQuote,
        compoundingPct: sideIsSell ? activeRules.sellCompoundingPct : activeRules.compoundingPct,
        targetSpendPct: null
      });
      rows.push({
        compoundingBaseQuote: baseQuote,
        compoundingFactor: math.compoundingFactor,
        quoteSpendRaw: math.quoteSpend
      });
      if (rows.length >= 300) break;
    }
    return rows;
  }, [
    activeRules?.compoundingEnabled,
    activeRules?.compoundingMode,
    activeRules?.compoundingPct,
    activeRules?.sellCompoundingEnabled,
    activeRules?.sellCompoundingMode,
    activeRules?.sellCompoundingPct,
    algoMathPreview?.baseSpend,
    algoMathPreview?.capacityQuote,
    algoMathPreview?.side,
    algoBaseStart,
    algoBaseEnd
  ]);
  const runtimeConfigPreview = useMemo(() => {
    const rules = activeRules;
    if (!rules) return null;
    return {
      symbol: rules.symbol,
      executionFunction: rules.executionFunction,
      signal: {
        idKey: signalHashKey,
        source: rules.signalSource,
        timeframe: rules.signalTimeframe,
        dedup: {
          enabled: rules.signalDedupEnabled,
          windowSec: rules.signalDedupWindowSec
        }
      },
      order: {
        type: rules.orderType,
        limitPrice: rules.limitPrice,
        referencePriceSource: rules.referencePriceSource,
        slippageTolerancePct: rules.slippageTolerancePct,
        cancelIfNotFilledSec: rules.cancelIfNotFilledSec
      },
      sizing: {
        mode: rules.sizingMode,
        allocationValue: rules.allocationValue,
        reinvestmentPct: rules.reinvestmentPct,
        compounding: {
          enabled: rules.compoundingEnabled,
          mode: rules.compoundingMode,
          pct: rules.compoundingPct,
          baseQuote: rules.compoundingBaseQuote,
          targetSpendPct: rules.targetSpendPct
        },
        sellCompounding: {
          enabled: rules.sellCompoundingEnabled,
          mode: rules.sellCompoundingMode,
          pct: rules.sellCompoundingPct,
          baseQuote: rules.sellCompoundingBaseQuote,
          targetSpendPct: rules.sellTargetSpendPct,
          ladder: {
            enabled: rules.sellLadderEnabled,
            strengthPct: rules.sellLadderStrengthPct,
            minFactor: rules.sellLadderMinFactor,
            maxFactor: rules.sellLadderMaxFactor
          }
        },
        minQuoteSpend: rules.minQuoteSpend,
        maxQuoteSpend: rules.maxQuoteSpend,
        minQuoteSpendScope: 'buy_only',
        effectiveMinNotional: rulesPreview
          ? {
              previewSide: rulesPreview.previewSide,
              applied: rulesPreview.effectiveMinNotional,
              buy: rulesPreview.effectiveMinNotionalBuy,
              sell: rulesPreview.effectiveMinNotionalSell,
              exchange: rulesPreview.exchangeMinNotional
            }
          : null,
        preview: rulesPreview
          ? {
              quoteSpendBeforeCompounding: rulesPreview.quoteSpendBeforeCompounding,
              compoundingFactor: rulesPreview.compoundingFactor,
              compoundingProfitQuote: rulesPreview.compoundingProfitQuote,
              compoundingBaseQuoteUsed: rulesPreview.compoundingBaseQuoteUsed,
              quoteSpend: rulesPreview.quoteSpend,
              qtyFinal: rulesPreview.qtyFinal,
              refPrice: rulesPreview.refPrice,
              minQuoteSpendFloor: rulesPreview.minQuoteSpendFloor
            }
          : null
      },
      risk: {
        cooldownSeconds: rules.cooldownSeconds,
        maxOpenOrdersPerSymbol: rules.maxOpenOrdersPerSymbol,
        maxPositionExposurePct: rules.maxPositionExposurePct,
        maxOpenPositionsPerSymbol: rules.maxOpenPositionsPerSymbol,
        dailyLoss: {
          enabled: rules.dailyLossCapEnabled,
          limitPct: rules.dailyLossLimitPct,
          resetTimeUtc: rules.dailyResetTimeUtc
        }
      },
      protection: {
        sl: {
          type: rules.slType,
          value: rules.slValue,
          atrLength: rules.slAtrLength,
          atrMultiplier: rules.slAtrMultiplier
        },
        tp: {
          type: rules.tpType,
          value: rules.tpValue
        }
      },
      meta: {
        signalKeySeed,
        pineScript: rules.pineAnalysis
          ? {
              scriptType: rules.pineAnalysis.scriptType,
              name: rules.pineAnalysis.name,
              interval: rules.pineAnalysis.interval,
              indicators: rules.pineAnalysis.indicators,
              functions: rules.pineAnalysis.functions,
              actions: rules.pineAnalysis.actions,
              indicatorSettings: rules.pineAnalysis.indicatorSettings
            }
          : null,
        botId: selectedBot?.id || null,
        integrationId: selectedBotLink.integrationId || null,
        exchangeAccountId: selectedBotLink.exchangeAccountId || null,
        tradingViewWebhookUrl: selectedBotLink.webhookUrl || null
      }
    };
  }, [activeRules, rulesPreview, selectedBot?.id, selectedBotLink.exchangeAccountId, selectedBotLink.integrationId, selectedBotLink.webhookUrl, signalHashKey, signalKeySeed]);

  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((bot) => {
      const text = [bot.name, bot.kind, bot.description || '', bot.latestVersion?.status || '', bot.latestVersion?.language || '']
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [bots, query]);

  const totalInstances = useMemo(
    () => bots.reduce((sum, bot) => sum + Number(bot.counts?.instances || 0), 0),
    [bots]
  );

  const activeRentals = useMemo(
    () =>
      rentals.filter((rental) => {
        const status = (rental.status || '').toLowerCase();
        return status === 'active' || status === 'running';
      }),
    [rentals]
  );
  const overviewIntegrationLinkedCount = useMemo(
    () => bots.filter((bot) => Boolean(botLinks[bot.id]?.integrationId)).length,
    [botLinks, bots]
  );
  const overviewWebhookLinkedCount = useMemo(
    () => bots.filter((bot) => Boolean(botLinks[bot.id]?.webhookUrl)).length,
    [botLinks, bots]
  );
  const overviewFullyLinkedCount = useMemo(
    () => bots.filter((bot) => Boolean(botLinks[bot.id]?.integrationId && botLinks[bot.id]?.webhookUrl)).length,
    [botLinks, bots]
  );
  const overviewNeedsAttentionCount = useMemo(
    () => bots.filter((bot) => botConnectivityStatus(bot, botLinks[bot.id]) === 'issue').length,
    [botLinks, bots]
  );
  const overviewCoveragePct = useMemo(() => {
    if (!bots.length) return 0;
    return Math.round((overviewFullyLinkedCount / bots.length) * 100);
  }, [bots.length, overviewFullyLinkedCount]);
  const runningInstanceCount = useMemo(
    () => botInstances.filter((instance) => normalizeInstanceState(instance.status) === 'running').length,
    [botInstances]
  );

  const load = async () => {
    const ws = getWorkspaceId().trim();
    if (!ws) {
      setBots([]);
      setRentals([]);
      setBotsError('Workspace not found. Please sign in again.');
      setRentalsError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setBotsError('');
    setRentalsError('');
    const [botsResult, rentalsResult] = await Promise.allSettled([listBots(), listRentals()]);

    if (botsResult.status === 'fulfilled') {
      const nextBots = (botsResult.value.items || []).map((bot) => ({
        ...bot,
        name: normalizeBotName(bot.name)
      })) as TradeBotRow[];
      setBots(nextBots);
    } else {
      setBots([]);
      setBotsError(botsResult.reason?.message || 'Failed to load workspace bots.');
    }

    if (rentalsResult.status === 'fulfilled') {
      setRentals(rentalsResult.value.items || []);
    } else {
      setRentals([]);
      setRentalsError(rentalsResult.reason?.message || 'Failed to load rentals.');
    }

    setLastLoadedAt(new Date().toISOString());
    setLoading(false);
  };

  const loadBotInstances = async (botId?: string | null, { silent = false }: { silent?: boolean } = {}) => {
    if (!botId) {
      setBotInstances([]);
      return;
    }
    if (!silent) setInstancesLoading(true);
    try {
      const result = await listInstances(botId);
      if (selectedBotIdRef.current !== botId) return;
      setBotInstances((result.items || []) as BotInstance[]);
    } finally {
      if (!silent && selectedBotIdRef.current === botId) setInstancesLoading(false);
    }
  };

  const handleInstanceControl = async (instanceId: string, action: BotInstanceLifecycleAction) => {
    if (!selectedBot?.id || !instanceId) return;
    setInstanceActionTargetId(instanceId);
    setModalError('');
    setModalMessage('');
    try {
      const actionRunner =
        action === 'start'
          ? startInstance
          : action === 'pause'
            ? pauseInstance
            : action === 'stop'
              ? stopInstance
              : restartInstance;
      const updated = await actionRunner(selectedBot.id, instanceId);
      if (!updated) {
        setModalError(`Failed to ${action} bot instance.`);
        return;
      }
      setBotInstances((prev) => prev.map((item) => (item.id === instanceId ? { ...item, ...updated } : item)));
      const suffix = action === 'restart' ? 'restarted' : action === 'pause' ? 'paused' : action === 'start' ? 'started' : 'stopped';
      setModalMessage(`Instance ${instanceId.slice(0, 10)} ${suffix}.`);
      await loadBotInstances(selectedBot.id, { silent: true });
    } catch (error: any) {
      setModalError(error?.message || `Failed to ${action} bot instance.`);
    } finally {
      setInstanceActionTargetId(null);
    }
  };

  const handleBotControl = async (action: BotLifecycleAction) => {
    if (!selectedBot?.id) return;
    if (action === 'delete') {
      const confirmed = window.confirm(`Delete bot "${selectedBot.name}"? This cannot be undone.`);
      if (!confirmed) return;
    }

    setBotActionInFlight(action);
    setModalError('');
    setModalMessage('');
    try {
      const runner =
        action === 'pause'
          ? pauseBot
          : action === 'resume'
            ? resumeBot
            : action === 'stop'
              ? stopBot
            : action === 'restart'
              ? restartBot
              : deleteBot;
      const result = await runner(selectedBot.id);
      if (!result) {
        setModalError(`Failed to ${action} bot.`);
        return;
      }

      if (action === 'delete') {
        const removedBotId = selectedBot.id;
        setBots((prev) => prev.filter((bot) => bot.id !== removedBotId));
        setBotLinks((prev) => {
          const next = { ...prev };
          delete next[removedBotId];
          writeBotLinks(next);
          return next;
        });
        setBotRulesMap((prev) => {
          const next = { ...prev };
          delete next[removedBotId];
          writeBotTradingRulesMap(next);
          return next;
        });
        closeBotPopup();
        return;
      }

      const nextInstances = Array.isArray((result as any)?.instances) ? ((result as any).instances as BotInstance[]) : [];
      if (nextInstances.length > 0) {
        setBotInstances(nextInstances);
      } else {
        await loadBotInstances(selectedBot.id, { silent: true });
      }
      const updatedCount = Number((result as any)?.updated || 0);
      const suffix =
        action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'stop' ? 'stopped' : 'restarted';
      setModalMessage(`Bot ${suffix}. ${updatedCount} instance${updatedCount === 1 ? '' : 's'} updated.`);
      setBots((prev) =>
        prev.map((bot) => {
          if (bot.id !== selectedBot.id) return bot;
          return {
            ...bot,
            counts: {
              ...(bot.counts || {}),
              instances: Number((result as any)?.totalInstances || bot.counts?.instances || 0)
            }
          };
        })
      );
    } catch (error: any) {
      setModalError(error?.message || `Failed to ${action} bot.`);
    } finally {
      setBotActionInFlight(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const applyRuntimeConfigFromBackend = (
    botId: string,
    payload: {
      links?: BotConnectivityLink | null;
      rules?: Partial<BotTradingRules> | null;
      parameters?:
        | {
            sourceCode?: string | null;
            schema?: BotCodeParameter[];
            values?: Record<string, BotCodeParameterValue>;
            updatedAt?: string | null;
          }
        | null;
    }
  ) => {
    const links = payload.links || null;
    const rules = payload.rules || null;
    const parameters = payload.parameters || null;

    if (links) {
      const normalizedLinks: BotConnectivityLink = {
        webhookUrl: links.webhookUrl || null,
        integrationId: links.integrationId || null,
        exchangeAccountId: links.exchangeAccountId || null,
        updatedAt: links.updatedAt || new Date().toISOString()
      };
      setBotLinks((prev) => {
        const next = {
          ...prev,
          [botId]: normalizedLinks
        };
        writeBotLinks(next);
        return next;
      });
    }

    if ((rules && typeof rules === 'object') || parameters) {
      const mergedRules = {
        ...(rules && typeof rules === 'object' ? rules : {}),
        ...(parameters
          ? {
              codeSource: parameters.sourceCode ?? (rules as any)?.codeSource ?? null,
              codeParameterSchema: parameters.schema ?? (rules as any)?.codeParameterSchema ?? [],
              codeParameters: parameters.values ?? (rules as any)?.codeParameters ?? {},
              codeParametersUpdatedAt:
                parameters.updatedAt ?? (rules as any)?.codeParametersUpdatedAt ?? null
            }
          : {})
      };
      const sanitizedRules = sanitizeTradingRules(mergedRules);
      setBotRulesMap((prev) => {
        const next = {
          ...prev,
          [botId]: sanitizedRules
        };
        writeBotTradingRulesMap(next);
        return next;
      });
      if (selectedBotIdRef.current === botId) {
        setBotRulesDraft(sanitizedRules);
        setTradingSymbol(sanitizedRules.symbol);
      }
    }
  };

  const syncRuntimeConfigFromBackend = async (botId: string) => {
    const runtime = await getTradeBotRuntimeConfig(botId);
    if (!runtime) return;
    applyRuntimeConfigFromBackend(botId, {
      links: runtime.links || null,
      rules: runtime.rules || null,
      parameters: runtime.parameters || null
    });
  };

  const persistRuntimeConfigForBot = async (
    botId: string,
    overrides?: {
      links?: BotConnectivityLink | null;
      rules?: BotTradingRules | null;
    }
  ) => {
    const targetBot = selectedBot?.id === botId ? selectedBot : bots.find((item) => item.id === botId) || null;
    const nextLinks = overrides && Object.prototype.hasOwnProperty.call(overrides, 'links')
      ? overrides.links || {}
      : botLinks[botId] || {};
    const nextRules = overrides && Object.prototype.hasOwnProperty.call(overrides, 'rules')
      ? overrides.rules
      : botRulesMap[botId] || createDefaultTradingRulesForBot(targetBot);
    const sanitizedRules = sanitizeTradingRules(nextRules || createDefaultTradingRulesForBot(targetBot));

    const saved = await saveTradeBotRuntimeConfig(botId, {
      links: nextLinks,
      rules: sanitizedRules
    });

    if (!saved) {
      setModalError('Failed to persist bot runtime configuration to backend.');
      return false;
    }

    applyRuntimeConfigFromBackend(botId, {
      links: saved.links || null,
      rules: saved.rules || null,
      parameters: saved.parameters || null
    });
    return true;
  };

  const upsertBotLink = (botId: string, patch: BotConnectivityLink) => {
    const next = {
      ...botLinks,
      [botId]: {
        ...(botLinks[botId] || {}),
        ...patch,
        updatedAt: new Date().toISOString()
      }
    };
    setBotLinks(next);
    writeBotLinks(next);
    return next[botId];
  };

  const upsertBotRules = (botId: string, nextRules: BotTradingRules) => {
    const next = {
      ...botRulesMap,
      [botId]: sanitizeTradingRules(nextRules)
    };
    setBotRulesMap(next);
    writeBotTradingRulesMap(next);
    return next[botId];
  };

  const updateBotRulesDraft = (patch: Partial<BotTradingRules>) => {
    setBotRulesDraft((prev) => sanitizeTradingRules({ ...(prev || selectedBotRules), ...patch }));
  };

  const updateCodeParameterDraftValue = (
    key: string,
    type: BotCodeParameterType,
    rawValue: string | number | boolean | null
  ) => {
    if (!key) return;
    const current = activeRules?.codeParameters || {};
    let nextValue: BotCodeParameterValue = rawValue;
    if (type === 'number') {
      const n = Number(rawValue);
      nextValue = Number.isFinite(n) ? n : null;
    } else if (type === 'boolean') {
      if (typeof rawValue === 'boolean') {
        nextValue = rawValue;
      } else {
        const normalized = String(rawValue ?? '')
          .trim()
          .toLowerCase();
        nextValue = ['true', '1', 'yes', 'on'].includes(normalized);
      }
    } else {
      nextValue = rawValue === null || rawValue === undefined ? '' : String(rawValue);
    }
    updateBotRulesDraft({
      codeParameters: {
        ...current,
        [key]: nextValue
      }
    });
  };

  const handleResetArnParameterDefaults = () => {
    if (!activeRules || arnParameterSchema.length === 0) return;
    const nextCodeParameters = { ...(activeRules.codeParameters || {}) };
    arnParameterSchema.forEach((param) => {
      nextCodeParameters[param.key] = param.defaultValue as BotCodeParameterValue;
    });
    updateBotRulesDraft({ codeParameters: nextCodeParameters });
    setModalError('');
    setModalMessage('ARN Pine parameters reset to template defaults. Click "Save Rules" to persist.');
  };

  const openBotPopup = (bot: TradeBotRow) => {
    setSelectedBot(bot);
    setAlgoMathSide('buy');
    setModalError('');
    setModalMessage('');
    const initialRules = sanitizeTradingRules(botRulesMap[bot.id] || createDefaultTradingRulesForBot(bot));
    const openOnArnPage = isArnPineFaithfulBot(bot, initialRules, initialRules.codeParameterSchema || []);
    setActivePopupSection(openOnArnPage ? 'arn-pine' : 'integrations');
    setBotRulesDraft(initialRules);
    setTradingSymbol(initialRules.symbol);
  };

  const closeBotPopup = () => {
    if (forceBotsTabFromQuery) {
      navigate('/platform/trade-bots/overview', { replace: true });
    }
    setSelectedBot(null);
    setActivePopupSection('integrations');
    setModalError('');
    setModalMessage('');
    setWebhookProfile(null);
    setExchangeAccounts([]);
    setIntegrations([]);
    setTestingIntegrationId(null);
    setIntegrationDetail(null);
    setExchangeSnapshot(null);
    setTradingDetailsError('');
    setTradingDetailsLoading(false);
    setBotRulesDraft(null);
    setPineScriptSource('');
    setPineScriptFileName('');
    setAlgoMathSide('buy');
    setBotInstances([]);
    setInstancesLoading(false);
    setInstanceActionTargetId(null);
    setBotActionInFlight(null);
    setIntegrationActionTargetId(null);
    setIntegrationActionInFlight(null);
  };

  const loadConnectivityContext = async (botId?: string) => {
    if (!botId) return;
    setModalLoading(true);
    setModalError('');
    const [webhookRes, accountsRes, integrationsRes] = await Promise.allSettled([
      getMyWebhook(),
      listExchangeAccounts(),
      listIntegrations()
    ]);

    if (webhookRes.status === 'fulfilled') {
      setWebhookProfile(webhookRes.value || null);
    } else {
      setWebhookProfile(null);
    }

    if (accountsRes.status === 'fulfilled') {
      setExchangeAccounts((accountsRes.value.items || []) as ExchangeAccount[]);
    } else {
      setExchangeAccounts([]);
    }

    if (integrationsRes.status === 'fulfilled') {
      setIntegrations((integrationsRes.value || []) as Integration[]);
    } else {
      setIntegrations([]);
    }

    if (
      webhookRes.status === 'rejected' &&
      accountsRes.status === 'rejected' &&
      integrationsRes.status === 'rejected'
    ) {
      setModalError('Failed to load connectivity data.');
    }

    setModalLoading(false);
  };

  const loadTradingDetails = async (integrationId: string) => {
    const targetIntegration = integrations.find((row) => row.id === integrationId) || null;
    const exchangeId = String(targetIntegration?.exchange || '').toLowerCase();
    const currentRules = sanitizeTradingRules(botRulesDraft || selectedBotRules);
    const symbolForFetch = normalizeSymbol(currentRules.symbol || tradingSymbol);
    setTradingDetailsLoading(true);
    setTradingDetailsError('');

    try {
      const detail = await fetchIntegrationDetail(integrationId);
      setIntegrationDetail(detail);
      const resolvedExchange = String(detail?.exchange || exchangeId || '').toLowerCase();
      if (resolvedExchange && resolvedExchange !== 'mexc') {
        setExchangeSnapshot(null);
        setTradingDetailsError(`Live trading diagnostics currently support MEXC spot only. Linked exchange: ${resolvedExchange}.`);
        return;
      }

      const snapshot = await fetchMexcSpotSnapshot({
        integrationId,
        symbol: symbolForFetch || undefined,
        interval: timeframeToInterval(currentRules.signalTimeframe),
        atrLength: currentRules.slAtrLength
      });
      setExchangeSnapshot(snapshot);
    } catch (error: any) {
      setExchangeSnapshot(null);
      setTradingDetailsError(error?.message || 'Failed to pull exchange trading details.');
    } finally {
      setTradingDetailsLoading(false);
    }
  };

  const handleRefreshTradingDetails = async () => {
    if (!selectedBotLink.integrationId) return;
    await loadTradingDetails(selectedBotLink.integrationId);
  };

  const handlePineScriptFileSelected = async (event: any) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setPineScriptSource(String(text || ''));
      setPineScriptFileName(String(file.name || 'pinescript'));
      setModalError('');
      setModalMessage(`Loaded PineScript file: ${file.name}`);
    } catch (error: any) {
      setModalError(error?.message || 'Failed to read PineScript file.');
    } finally {
      if (event?.target) event.target.value = '';
    }
  };

  const handleAnalyzePineScript = () => {
    const source = String(pineScriptSource || '').trim();
    if (!source) {
      setModalError('Paste or upload a PineScript before analysis.');
      return null;
    }
    try {
      const analysis = analyzePineScriptSource(source);
      updateBotRulesDraft({ pineAnalysis: analysis });
      setModalError('');
      setModalMessage(
        `PineScript analyzed (${analysis.scriptType}${analysis.name ? `: ${analysis.name}` : ''}).`
      );
      return analysis;
    } catch (error: any) {
      setModalError(error?.message || 'Unable to analyze PineScript.');
      return null;
    }
  };

  const handleApplyPineToRules = () => {
    const analyzed = handleAnalyzePineScript();
    if (!analyzed) return;
    const patch = deriveRulesPatchFromPineAnalysis(analyzed);
    updateBotRulesDraft(patch);
    setModalError('');
    setModalMessage('PineScript insights applied to rule draft. Click "Save Rules" to persist.');
  };

  const handleRulesSave = async () => {
    if (!selectedBot || !botRulesDraft) return;
    const sanitized = sanitizeTradingRules(botRulesDraft);
    upsertBotRules(selectedBot.id, sanitized);
    const persisted = await persistRuntimeConfigForBot(selectedBot.id, {
      rules: sanitized
    });
    if (!persisted) return;
    setBotRulesDraft(sanitized);
    setTradingSymbol(sanitized.symbol);
    if (selectedBotLink.integrationId) {
      await loadTradingDetails(selectedBotLink.integrationId);
    }
    setModalError('');
    setModalMessage('Sizing, compounding, risk, SL/TP, and execution rules saved for this bot.');
  };

  const handleRulesReset = () => {
    if (!selectedBot) return;
    const fallback = createDefaultTradingRulesForBot(selectedBot);
    setBotRulesDraft(fallback);
    setTradingSymbol(fallback.symbol);
    setModalError('');
    setModalMessage('Trading rules reset to defaults. Save to apply.');
  };

  useEffect(() => {
    if (!selectedBot) return;
    void loadConnectivityContext(selectedBot.id);
    void syncRuntimeConfigFromBackend(selectedBot.id);
    void loadBotInstances(selectedBot.id);
  }, [selectedBot?.id]);

  useEffect(() => {
    if (!selectedBot) return;
    if (botRulesDraft) return;
    const initialRules = sanitizeTradingRules(botRulesMap[selectedBot.id] || createDefaultTradingRulesForBot(selectedBot));
    setBotRulesDraft(initialRules);
    setTradingSymbol(initialRules.symbol);
  }, [botRulesDraft, botRulesMap, selectedBot]);

  useEffect(() => {
    if (!selectedBot) return;
    if (!selectedBotLink.integrationId) {
      setIntegrationDetail(null);
      setExchangeSnapshot(null);
      setTradingDetailsError('');
      return;
    }
    loadTradingDetails(selectedBotLink.integrationId);
  }, [selectedBot?.id, selectedBotLink.integrationId]);

  useEffect(() => {
    if (!forceBotsTabFromQuery || activeTab !== 'bots' || !legacyPopupBotId) return;
    const targetBot = bots.find((bot) => bot.id === legacyPopupBotId);
    if (!targetBot) return;
    if (!selectedBot || selectedBot.id !== targetBot.id) {
      openBotPopup(targetBot);
      return;
    }
    if (legacyPopupSection) {
      setActivePopupSection(legacyPopupSection);
    }
  }, [activeTab, bots, forceBotsTabFromQuery, legacyPopupBotId, legacyPopupSection, selectedBot?.id]);

  useEffect(() => {
    if (activeTab !== 'bots') {
      setSelectedBot(null);
      setModalError('');
      setModalMessage('');
      setWebhookProfile(null);
      setExchangeAccounts([]);
      setIntegrations([]);
      setTestingIntegrationId(null);
      setIntegrationDetail(null);
      setExchangeSnapshot(null);
      setTradingDetailsError('');
      setTradingDetailsLoading(false);
      setBotRulesDraft(null);
      setActivePopupSection('integrations');
      setBotInstances([]);
      setInstancesLoading(false);
      setInstanceActionTargetId(null);
      setBotActionInFlight(null);
      setIntegrationActionTargetId(null);
      setIntegrationActionInFlight(null);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!selectedBot) return;
    const allowedSections = new Set(popupSections.map((section) => section.key));
    if (!allowedSections.has(activePopupSection)) {
      setActivePopupSection('integrations');
    }
  }, [activePopupSection, popupSections, selectedBot]);

  const handleRefreshConnectivity = async () => {
    if (!selectedBot) return;
    await loadConnectivityContext(selectedBot.id);
    if (selectedBotLink.integrationId) {
      await loadTradingDetails(selectedBotLink.integrationId);
    }
  };

  const handleAssignIngress = async () => {
    if (!selectedBot) return;
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const assigned = await assignWebhook();
      setWebhookProfile(assigned);
      const urls = collectWebhookUrls(assigned);
      if (urls.length > 0) {
        const links = upsertBotLink(selectedBot.id, { webhookUrl: urls[0] });
        const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
        if (!persisted) return;
      }
      setModalMessage(urls.length > 0 ? 'TradingView ingress assigned and linked.' : 'TradingView ingress assigned.');
    } catch (error: any) {
      setModalError(error?.message || 'Failed to assign TradingView ingress.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleVerifyIngress = async () => {
    if (!selectedBot) return;
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const profile = await getMyWebhook();
      const urls = collectWebhookUrls(profile);
      setWebhookProfile(profile);
      if (selectedBotLink.webhookUrl && urls.includes(selectedBotLink.webhookUrl)) {
        setModalMessage('TradingView ingress link is valid.');
      } else {
        setModalError('Linked TradingView ingress URL is not currently assigned.');
      }
    } catch (error: any) {
      setModalError(error?.message || 'Failed to verify TradingView ingress.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleLinkWebhook = async (url: string) => {
    if (!selectedBot) return;
    if (!url || selectedBotLink.webhookUrl === url) return;
    if (selectedBotLink.webhookUrl && selectedBotLink.webhookUrl !== url) {
      setModalError('Unlink current TradingView ingress before linking another URL.');
      setModalMessage('');
      return;
    }
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const links = upsertBotLink(selectedBot.id, { webhookUrl: url });
      const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
      if (!persisted) return;
      setModalMessage('TradingView ingress linked.');
    } catch (error: any) {
      setModalError(error?.message || 'Failed to link TradingView ingress.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleUnlinkWebhook = async () => {
    if (!selectedBot || !selectedBotLink.webhookUrl) return;
    const confirmed = window.confirm('Unlink TradingView ingress from this bot?');
    if (!confirmed) return;
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const links = upsertBotLink(selectedBot.id, { webhookUrl: null });
      const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
      if (!persisted) return;
      setModalMessage('TradingView ingress unlinked from this bot.');
    } catch (error: any) {
      setModalError(error?.message || 'Failed to unlink TradingView ingress.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleLinkIntegration = async (integrationId: string) => {
    if (!selectedBot || !integrationId) return;
    if (selectedBotLink.integrationId === integrationId) return;
    if (selectedBotLink.integrationId && selectedBotLink.integrationId !== integrationId) {
      setModalError('Unlink current exchange integration before linking another integration.');
      setModalMessage('');
      return;
    }
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const links = upsertBotLink(selectedBot.id, { integrationId });
      const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
      if (!persisted) return;
      setModalMessage('Exchange integration linked to this bot.');
      await loadTradingDetails(integrationId);
    } catch (error: any) {
      setModalError(error?.message || 'Failed to link exchange integration.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleUnlinkIntegrationLink = async (integrationId: string, fromDeleteOption = false) => {
    if (!selectedBot) return;
    if (selectedBotLink.integrationId !== integrationId) return;
    const prompt = fromDeleteOption
      ? 'Delete this integration link from this bot? The integration and credentials will stay connected.'
      : 'Unlink this exchange integration from this bot?';
    const confirmed = window.confirm(prompt);
    if (!confirmed) return;

    setIntegrationActionTargetId(integrationId);
    setIntegrationActionInFlight('unlink');
    setModalError('');
    setModalMessage('');
    try {
      const links = upsertBotLink(selectedBot.id, { integrationId: null });
      const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
      if (!persisted) return;
      setIntegrationDetail(null);
      setExchangeSnapshot(null);
      setTradingDetailsError('');
      setModalMessage(fromDeleteOption ? 'Integration link deleted from this bot.' : 'Integration unlinked from this bot.');
    } catch (error: any) {
      setModalError(error?.message || 'Failed to unlink integration from this bot.');
    } finally {
      setIntegrationActionTargetId(null);
      setIntegrationActionInFlight(null);
    }
  };

  const handleLinkExchangeAccount = async (exchangeAccountId: string) => {
    if (!selectedBot || !exchangeAccountId) return;
    if (selectedBotLink.exchangeAccountId === exchangeAccountId) return;
    if (selectedBotLink.exchangeAccountId && selectedBotLink.exchangeAccountId !== exchangeAccountId) {
      setModalError('Unlink current exchange account before linking another account.');
      setModalMessage('');
      return;
    }
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const links = upsertBotLink(selectedBot.id, { exchangeAccountId });
      const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
      if (!persisted) return;
      setModalMessage('Exchange account linked.');
    } catch (error: any) {
      setModalError(error?.message || 'Failed to link exchange account.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleTestIntegration = async (integrationId: string) => {
    if (!selectedBot) return;
    setTestingIntegrationId(integrationId);
    setModalError('');
    setModalMessage('');
    try {
      const result = await testIntegration(integrationId);
      const links = upsertBotLink(selectedBot.id, { integrationId });
      const persisted = await persistRuntimeConfigForBot(selectedBot.id, { links });
      if (!persisted) return;
      setIntegrations((prev) =>
        prev.map((integration) =>
          integration.id === integrationId
            ? {
                ...integration,
                status: result.status || integration.status,
                lastTestedAt: result.rotatedAt || new Date().toISOString()
              }
            : integration
        )
      );
      setModalMessage(`Connectivity check finished with status: ${result.status}.`);
      const refreshed = await listIntegrations();
      setIntegrations((refreshed || []) as Integration[]);
      await loadTradingDetails(integrationId);
    } catch (error: any) {
      setModalError(error?.message || 'Exchange connectivity check failed.');
    } finally {
      setTestingIntegrationId(null);
    }
  };

  const handleIntegrationControl = async (integrationId: string, action: IntegrationLifecycleAction) => {
    if (!selectedBot) return;
    if (action === 'delete' || action === 'unlink') {
      await handleUnlinkIntegrationLink(integrationId, action === 'delete');
      return;
    }

    setIntegrationActionTargetId(integrationId);
    setIntegrationActionInFlight(action);
    setModalError('');
    setModalMessage('');
    try {
      const runner =
        action === 'pause'
          ? pauseIntegration
          : action === 'resume'
            ? resumeIntegration
            : restartIntegration;
      const result = await runner(integrationId);

      const nextIntegration = (result as any)?.integration || null;
      if (nextIntegration?.id) {
        setIntegrations((prev) =>
          prev.map((integration) => (integration.id === integrationId ? { ...integration, ...nextIntegration } : integration))
        );
      }

      if (selectedBotLink.integrationId === integrationId) {
        await loadTradingDetails(integrationId);
      }
      const label = action === 'pause' ? 'stopped' : action === 'resume' ? 'resumed' : 'restarted';
      setModalMessage(`Integration ${label}.`);
    } catch (error: any) {
      setModalError(error?.message || `Failed to ${action} integration.`);
    } finally {
      setIntegrationActionTargetId(null);
      setIntegrationActionInFlight(null);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'connectivity', label: 'Connectivity' },
    { key: 'bots', label: 'Bots' },
    { key: 'marketplace', label: 'Marketplace' },
    { key: 'rentals', label: 'Rentals' },
    { key: 'logs-reports', label: 'Logs + Reports' }
  ];
  const tabRail = (
    <nav className="grid grid-cols-3 gap-2 sm:w-fit">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        const isMarketplaceTab = tab.key === 'marketplace';
        const targetPath = tab.key === 'bots' ? '/platform/trade-bots/bots' : `/platform/trade-bots/${tab.key}`;
        const Icon = TRADE_BOT_TAB_ICONS[tab.key];
        return (
          <Link
            key={tab.key}
            to={targetPath}
            className={`group relative flex aspect-square w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-5 py-5 text-center text-base font-semibold transition sm:w-40 ${
              isActive
                ? 'border-primary-200/80 bg-primary-400/10 text-white'
                : 'border-white/10 bg-transparent text-white/80 hover:border-primary-400/40 hover:bg-primary-500/10'
            } ${isMarketplaceTab ? 'border-amber-300/70 shadow-[0_0_18px_rgba(251,191,36,0.22)]' : ''}`}
          >
            {isMarketplaceTab && <span className="pointer-events-none absolute inset-0 rounded-xl border border-amber-300/75 animate-pulse z-10"></span>}
            <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-bl from-white/40 to-white/0 opacity-10 z-0"></span>
            <span className={`relative z-10 flex h-10 w-10 items-center justify-center ${isActive ? 'opacity-100' : 'opacity-70'}`}>
              <Icon className="h-6 w-6 text-white/85" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className={`relative z-10 leading-snug text-base ${isActive ? 'text-white' : 'text-white/70'}`}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="trade-bots-page space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-label">Trade Bots · Global</p>
            <p className="text-sm text-gray-300 max-w-3xl">
              Workspace bots, marketplace listings, and rentals in the same visual language as exchange integration pages.
            </p>
          </div>
          <Link to="/platform" className="text-xs uppercase tracking-[0.3em] text-primary-200">
            ← Back
          </Link>
        </div>
      </header>
      <div className="space-y-6">
        {botsError && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{botsError}</div>}
        {rentalsError && <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-200">{rentalsError}</div>}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,31rem)_minmax(0,1fr)] lg:gap-x-24 lg:items-start">
          <div>{tabRail}</div>
          <div className="space-y-6">
            {activeTab === 'overview' && (
              <>
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Bots" value={String(bots.length)} helper="Loaded bots" />
                  <MetricCard label="Instances" value={String(totalInstances)} helper="Across versions" />
                  <MetricCard label="Rentals" value={String(rentals.length)} helper="Active + historical" />
                  <MetricCard label="Active Rentals" value={String(activeRentals.length)} helper="Running + active status" />
                  <MetricCard label="Linked Integrations" value={String(overviewIntegrationLinkedCount)} helper="Bots mapped to exchange" />
                  <MetricCard label="Linked Webhooks" value={String(overviewWebhookLinkedCount)} helper="Bots mapped to TradingView URL" />
                  <MetricCard label="Coverage" value={`${overviewCoveragePct}%`} helper="Webhook + integration on same bot" />
                  <MetricCard label="Needs Attention" value={String(overviewNeedsAttentionCount)} helper="Bots in issue state" />
                  <StatusToggleCard label="Automation Status" enabled={automationEnabled} onToggle={() => setAutomationEnabled((v) => !v)} />
                </section>
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="section-label">Overview</p>
                  <p className="text-sm text-gray-300">
                    Use this panel for quick health checks, then switch to Connectivity or Bots for detailed actions.
                  </p>
                </section>
              </>
            )}

            {activeTab === 'connectivity' && (
              <section className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="section-label">Connectivity</p>
                  <p className="text-sm text-gray-300">Review webhook and integration links across all bots in one map.</p>
                </div>
                <ConnectivityMindmap bots={bots} botLinks={botLinks} />
              </section>
            )}

            {activeTab === 'bots' && (
              <section className="card-shell space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="section-label">Control Plane</p>
                      <h3 className="text-xl font-semibold text-main">Trade bot operations summary</h3>
                    </div>
                    <button type="button" className="btn btn-secondary btn-small" onClick={load}>
                      Refresh
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <StatCard label="Active rentals" value={String(activeRentals.length)} />
                    <StatCard label="Last loaded" value={formatDate(lastLoadedAt)} />
                    <StatCard label="Automation" value={automationEnabled ? 'enabled' : 'disabled'} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="section-label">Bots</p>
                    <p className="text-sm text-gray-300">Monitor versions, instances, and execution readiness. Click any bot to configure connectivity.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100"
                      placeholder="Search bot name/status"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <button type="button" className="btn btn-secondary btn-small" onClick={load}>
                      Refresh
                    </button>
                  </div>
                </div>

                {loading && <p className="text-sm text-gray-400">Loading trade bot data...</p>}
                {!loading && filteredBots.length === 0 && !botsError && <p className="text-sm text-gray-400">No bots found.</p>}
                {!loading && filteredBots.length > 0 && (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {filteredBots.map((bot) => (
                      <button
                        key={bot.id}
                        type="button"
                        onClick={() => openBotPopup(bot)}
                        className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-300/40 hover:bg-primary-500/10"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <h3 className="text-left text-lg font-semibold text-white">{bot.name}</h3>
                            <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{bot.kind}</p>
                          </div>
                          <span className="rounded-lg border border-primary-300/35 bg-primary-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-primary-100">
                            {bot.latestVersion?.status || 'unknown'}
                          </span>
                        </div>
                        <p className="mt-2 text-left text-sm text-gray-300">{bot.description || 'No description'}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                          <InfoTile label="Version" value={versionText(bot)} mono />
                          <InfoTile label="Updated" value={formatDate(bot.updatedAt)} />
                          <InfoTile label="Instances" value={String(bot.counts?.instances || 0)} />
                          <InfoTile label="Orders" value={String(bot.counts?.orders || 0)} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'marketplace' && (
              <section className="card-shell space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="section-label">Marketplace</p>
                    <p className="text-sm text-gray-300">Marketplace is managed on its dedicated page.</p>
                  </div>
                  <Link to="/market" className="btn btn-white-animated btn-small">
                    Open Marketplace
                  </Link>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                  Open <span className="text-primary-200">Market</span> to browse and rent published bots.
                </div>
              </section>
            )}

            {activeTab === 'rentals' && (
              <section className="card-shell space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="section-label">Rental Status</p>
                    <p className="text-sm text-gray-300">Active and historical workspace rentals.</p>
                  </div>
                  <Link to="/market/rentals" className="btn btn-white-animated btn-small">
                    Open Rentals
                  </Link>
                </div>
                {loading && <p className="text-sm text-gray-400">Loading rentals...</p>}
                {!loading && rentals.length === 0 && <p className="text-sm text-gray-400">No rentals found.</p>}
                {!loading && rentals.length > 0 && (
                  <div className="space-y-2">
                    {rentals.slice(0, 10).map((rental) => (
                      <div key={rental.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-white">{normalizeBotName(rental.bot?.name || rental.botId)}</p>
                          <span className="text-xs uppercase tracking-[0.14em] text-gray-300">{rental.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          Plan {rental.plan?.name || rental.planId} • Expires {formatDate(rental.expiresAt)}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">Instance {rental.botInstanceId || 'provisioning'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'logs-reports' && (
              <section className="card-shell space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="section-label">Logs And Reports</p>
                    <p className="text-sm text-gray-300">Open execution telemetry and sizing reports for diagnostics.</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-small" onClick={load}>
                    Refresh
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Link to="/platform/orders/reports" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 hover:border-primary-300/40">
                    Signal/Exchange Reports
                  </Link>
                  <Link
                    to="/platform/orders/sizing/details"
                    className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 hover:border-primary-300/40"
                  >
                    Sizing Details
                  </Link>
                  <Link
                    to="/platform/orders/sizing/reports"
                    className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 hover:border-primary-300/40"
                  >
                    Sizing Reports
                  </Link>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
                  Last sync: {formatDate(lastLoadedAt)} {botsError || rentalsError ? '• check alert banners for fetch errors.' : '• no load errors detected.'}
                </div>
              </section>
            )}
          </div>
        </section>
      </div>

      {selectedBot && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-6 backdrop-blur-md" role="dialog" aria-modal="true" onClick={closeBotPopup}>
          <div
            className="mx-auto w-full max-w-[110rem] rounded-3xl border border-white/15 bg-black/90 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 px-7 py-8">
              <div className="max-w-6xl space-y-5">
                <div>
                  <p className="section-label">Bot Connectivity</p>
                  <h3 className="text-4xl font-semibold text-main md:text-5xl">{selectedBot.name}</h3>
                  <p className="mt-2 text-sm text-gray-300">Link TradingView ingress and exchange connections, then run connectivity checks.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="min-h-28 rounded-xl border border-white/15 bg-black/45 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Connectivity status</p>
                    <p className="mt-3 text-2xl font-semibold text-white">{overallConnectivityStatus}</p>
                  </div>
                  <div className="min-h-28 rounded-xl border border-white/15 bg-black/45 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Connectivity bandwidth</p>
                    <p className="mt-3 text-2xl font-semibold text-white">{connectivityBandwidth}</p>
                    <p className="text-[11px] text-gray-400">estimated telemetry</p>
                  </div>
                  <div className="min-h-28 rounded-xl border border-white/15 bg-black/45 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">TradingView</p>
                    <span className={`mt-3 inline-flex rounded-lg border px-2 py-1 text-xs uppercase tracking-[0.14em] ${connectivityBadgeClass(tradingViewConnected)}`}>
                      {tradingViewConnected ? 'connected' : 'not linked'}
                    </span>
                  </div>
                  <div className="min-h-28 rounded-xl border border-white/15 bg-black/45 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Exchange</p>
                    <span className={`mt-3 inline-flex rounded-lg border px-2 py-1 text-xs uppercase tracking-[0.14em] ${connectivityBadgeClass(exchangeConnected)}`}>
                      {exchangeConnected ? linkedIntegration?.exchange || 'connected' : 'not linked'}
                    </span>
                  </div>
                  <div className="min-h-28 rounded-xl border border-white/15 bg-black/45 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Market filters</p>
                    <p className="mt-3 text-sm font-semibold text-white">
                      {marketFilters ? `minNotional ${formatDecimal(marketFilters.minNotional)}` : 'not pulled'}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {marketFilters ? `step ${formatDecimal(marketFilters.stepSize, 12)}` : 'link integration + pull'}
                    </p>
                  </div>
                  <div className="min-h-28 rounded-xl border border-white/15 bg-black/45 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Available balance</p>
                    <p className="mt-3 text-sm font-semibold text-white">
                      {symbolAssets.quoteAsset || 'quote'} {formatDecimal(quoteAssetBalance?.free)}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {symbolAssets.baseAsset || 'base'} {formatDecimal(baseAssetBalance?.free)}
                    </p>
                  </div>
                </div>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={closeBotPopup}>
                <PopupButtonLabel icon={X} label="Close" />
              </button>
            </div>

            <div className="space-y-5 px-7 py-6">
              {modalError && <div className="rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{modalError}</div>}
              {modalMessage && <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{modalMessage}</div>}

              <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-black/45 p-2 text-xs uppercase tracking-[0.2em]">
                {popupSections.map((section) => {
                  const isActive = activePopupSection === section.key;
                  return (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => setActivePopupSection(section.key)}
                      className={`${POPUP_SECTION_TAB_BASE} ${isActive ? POPUP_SECTION_TAB_ACTIVE : POPUP_SECTION_TAB_IDLE}`}
                    >
                      {section.label}
                    </button>
                  );
                })}
              </nav>

              {activePopupSection === 'integrations' && (
                <div className="grid gap-3 xl:grid-cols-3">
                  <section className="rounded-2xl border border-white/15 bg-black/45 p-4 xl:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">Bot runtime controls</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Control all bot instances at once, or run lifecycle actions on individual instances.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={FUTURE_ACTION_WARNING}
                          onClick={() => handleBotControl('pause')}
                          disabled={Boolean(botActionInFlight)}
                        >
                          <PopupButtonLabel icon={Pause} label="Pause Bot" />
                        </button>
                        <button
                          type="button"
                          className={FUTURE_ACTION_SUCCESS}
                          onClick={() => handleBotControl('resume')}
                          disabled={Boolean(botActionInFlight)}
                        >
                          <PopupButtonLabel icon={Play} label="Resume Bot" />
                        </button>
                        <button
                          type="button"
                          className={FUTURE_ACTION_PRIMARY}
                          onClick={() => handleBotControl('restart')}
                          disabled={Boolean(botActionInFlight)}
                        >
                          <PopupButtonLabel icon={RotateCcw} label="Restart Bot" />
                        </button>
                        <button
                          type="button"
                          className={FUTURE_ACTION_STOP}
                          onClick={() => handleBotControl('stop')}
                          disabled={Boolean(botActionInFlight)}
                        >
                          <PopupButtonLabel icon={Square} label="Stop Bot" />
                        </button>
                        <button
                          type="button"
                          className={FUTURE_ACTION_DANGER}
                          onClick={() => handleBotControl('delete')}
                          disabled={Boolean(botActionInFlight)}
                        >
                          <PopupButtonLabel icon={Trash2} label="Delete Bot" />
                        </button>
                        {botActionInFlight && (
                          <span className={FUTURE_BADGE_BUSY}>
                            Applying {botActionInFlight}
                          </span>
                        )}
                        <span className={FUTURE_BADGE_MUTED}>
                          running {runningInstanceCount}/{botInstances.length}
                        </span>
                        <button
                          type="button"
                          className={FUTURE_ACTION_PRIMARY}
                          onClick={() => loadBotInstances(selectedBot.id)}
                          disabled={instancesLoading}
                        >
                          <PopupButtonLabel icon={RefreshCw} label={instancesLoading ? 'Refreshing...' : 'Refresh Instances'} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {instancesLoading && <p className="text-xs text-gray-400">Loading instances...</p>}
                      {!instancesLoading && botInstances.length === 0 && (
                        <p className="text-xs text-gray-400">No instances found for this bot. Create or rent an instance to enable runtime controls.</p>
                      )}
                      {botInstances.map((instance) => {
                        const status = normalizeInstanceState(instance.status);
                        const isBusy = instanceActionTargetId === instance.id;
                        const canStart = canRunInstanceAction(instance, 'start');
                        const canPause = canRunInstanceAction(instance, 'pause');
                        const canStop = canRunInstanceAction(instance, 'stop');
                        const canRestart = canRunInstanceAction(instance, 'restart');
                        return (
                          <div key={instance.id} className="rounded-lg border border-white/15 bg-black/35 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-gray-100">{String(instance.symbol || 'SYMBOL').toUpperCase()}</p>
                                  <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${instanceStatusBadgeClass(status)}`}>
                                    {status}
                                  </span>
                                  {isBusy && (
                                    <span className={FUTURE_BADGE_BUSY}>
                                      applying
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] text-gray-400">
                                  Started {formatDate(instance.startedAt)} · Stopped {formatDate(instance.stoppedAt)}
                                </p>
                                <p className="mt-1 break-all text-[10px] font-mono text-gray-500">Instance {instance.id}</p>
                                {instance.lastError && <p className="mt-1 text-[11px] text-rose-200">Last error: {instance.lastError}</p>}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className={FUTURE_ACTION_SUCCESS}
                                  onClick={() => handleInstanceControl(instance.id, 'start')}
                                  disabled={isBusy || !canStart}
                                >
                                  <PopupButtonLabel icon={Play} label="Start" />
                                </button>
                                <button
                                  type="button"
                                  className={FUTURE_ACTION_WARNING}
                                  onClick={() => handleInstanceControl(instance.id, 'pause')}
                                  disabled={isBusy || !canPause}
                                >
                                  <PopupButtonLabel icon={Pause} label="Pause" />
                                </button>
                                <button
                                  type="button"
                                  className={FUTURE_ACTION_PRIMARY}
                                  onClick={() => handleInstanceControl(instance.id, 'restart')}
                                  disabled={isBusy || !canRestart}
                                >
                                  <PopupButtonLabel icon={RotateCcw} label="Restart" />
                                </button>
                                <button
                                  type="button"
                                  className={FUTURE_ACTION_STOP}
                                  onClick={() => handleInstanceControl(instance.id, 'stop')}
                                  disabled={isBusy || !canStop}
                                >
                                  <PopupButtonLabel icon={Square} label="Stop" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">TradingView ingress</p>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleAssignIngress} disabled={modalLoading}>
                      <PopupButtonLabel icon={Plus} label="Assign" />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Available webhook URLs for TradingView alerts.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
                    {webhookUrls.length === 0 && <p className="text-xs text-gray-400">No ingress URLs assigned yet.</p>}
                    {webhookUrls.map((url) => {
                      const linked = selectedBotLink.webhookUrl === url;
                      const linkDisabled = modalLoading || linked || Boolean(selectedBotLink.webhookUrl && !linked);
                      const unlinkDisabled = modalLoading || !linked;
                      return (
                        <div key={url} className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <p className="break-all font-mono text-[11px] text-gray-200">{url}</p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${connectivityBadgeClass(linked)}`}>
                              {linked ? 'linked' : 'available'}
                            </span>
                            <button
                              type="button"
                              className={FUTURE_ACTION_PRIMARY}
                              onClick={() => void handleLinkWebhook(url)}
                              disabled={linkDisabled}
                            >
                              <PopupButtonLabel icon={Link2Icon} label="Link" />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_INFO}
                              onClick={() => void handleUnlinkWebhook()}
                              disabled={unlinkDisabled}
                            >
                              <PopupButtonLabel icon={Unlink2} label="Unlink" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="mt-3 btn btn-secondary btn-small" onClick={handleVerifyIngress} disabled={modalLoading}>
                    <PopupButtonLabel icon={Search} label="Check Connectivity" />
                  </button>
                </section>

                  <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">Exchange integrations</p>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleRefreshConnectivity} disabled={modalLoading}>
                      <PopupButtonLabel icon={RefreshCw} label="Refresh" />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Link any exchange integration and run a connection test.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
                    {integrations.length === 0 && <p className="text-xs text-gray-400">No exchange integrations found.</p>}
                    {integrations.map((integration) => {
                      const linked = selectedBotLink.integrationId === integration.id;
                      const healthy = integrationIsHealthy(integration.status);
                      const isActionBusy = integrationActionTargetId === integration.id;
                      const statusTone = String(integration.status || '').toLowerCase();
                      const linkDisabled =
                        modalLoading ||
                        isActionBusy ||
                        Boolean(integrationActionInFlight) ||
                        linked ||
                        Boolean(selectedBotLink.integrationId && selectedBotLink.integrationId !== integration.id);
                      const unlinkDisabled =
                        modalLoading || isActionBusy || Boolean(integrationActionInFlight) || !linked;
                      return (
                        <div key={integration.id} className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-gray-100">{integration.label || integration.exchange}</p>
                              <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                                {integration.exchange} · {integration.environment}
                              </p>
                            </div>
                            <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${connectivityBadgeClass(healthy)}`}>
                              {integration.status || 'unknown'}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-gray-400">Last tested {formatDate(integration.lastTestedAt || null)}</p>
                          {isActionBusy && (
                            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100">
                              Applying {integrationActionInFlight}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className={FUTURE_ACTION_PRIMARY}
                              onClick={() => void handleLinkIntegration(integration.id)}
                              disabled={linkDisabled}
                            >
                              <PopupButtonLabel icon={Link2Icon} label={linked ? 'Linked' : 'Link'} />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_STOP}
                              onClick={() => handleTestIntegration(integration.id)}
                              disabled={testingIntegrationId === integration.id || isActionBusy || modalLoading}
                            >
                              <PopupButtonLabel
                                icon={Search}
                                label={testingIntegrationId === integration.id ? 'Testing...' : 'Check Connectivity'}
                              />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_WARNING}
                              onClick={() => handleIntegrationControl(integration.id, 'pause')}
                              disabled={isActionBusy || modalLoading || statusTone === 'paused'}
                            >
                              <PopupButtonLabel icon={Square} label="Stop" />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_SUCCESS}
                              onClick={() => handleIntegrationControl(integration.id, 'resume')}
                              disabled={isActionBusy || modalLoading || statusTone !== 'paused'}
                            >
                              <PopupButtonLabel icon={Play} label="Resume" />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_PRIMARY}
                              onClick={() => handleIntegrationControl(integration.id, 'restart')}
                              disabled={isActionBusy || modalLoading}
                            >
                              <PopupButtonLabel icon={RotateCcw} label="Restart" />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_INFO}
                              onClick={() => handleIntegrationControl(integration.id, 'unlink')}
                              disabled={unlinkDisabled}
                            >
                              <PopupButtonLabel icon={Unlink2} label="Unlink" />
                            </button>
                            <button
                              type="button"
                              className={FUTURE_ACTION_DANGER}
                              onClick={() => handleIntegrationControl(integration.id, 'delete')}
                              disabled={unlinkDisabled}
                            >
                              <PopupButtonLabel icon={Trash2} label="Delete Link" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                  <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                  <p className="text-sm font-semibold text-white">Exchange accounts</p>
                  <p className="mt-1 text-xs text-gray-400">Optional account link used by bot runtime in this workspace.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
                    {exchangeAccounts.length === 0 && <p className="text-xs text-gray-400">No exchange accounts configured.</p>}
                    {exchangeAccounts.map((account) => {
                      const linked = selectedBotLink.exchangeAccountId === account.id;
                      return (
                        <div key={account.id} className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <p className="text-sm font-semibold text-gray-100">{account.name}</p>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                            {account.venue} {account.isSandbox ? '· sandbox' : '· live'}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-[11px] text-gray-400">Updated {formatDate(account.updatedAt)}</p>
                            <button
                              type="button"
                              className={FUTURE_ACTION_PRIMARY}
                              onClick={() => void handleLinkExchangeAccount(account.id)}
                              disabled={modalLoading || linked || Boolean(selectedBotLink.exchangeAccountId && !linked)}
                            >
                              <PopupButtonLabel icon={Link2Icon} label={linked ? 'Linked' : 'Link'} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 rounded-lg border border-white/15 bg-black/35 p-2 text-[11px] text-gray-300">
                    Linked account: {linkedExchangeAccount ? `${linkedExchangeAccount.name} (${linkedExchangeAccount.venue})` : 'none'}
                  </div>
                </section>
                </div>
              )}

              {activePopupSection === 'parameters' && (
                <div className="space-y-3">
                  <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">PineScript import</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Upload or paste PineScript to detect indicators, settings, functions, interval, and auto-fill bot rule draft values.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleAnalyzePineScript}>
                      <PopupButtonLabel icon={Search} label="Analyze Script" />
                    </button>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleApplyPineToRules}>
                      <PopupButtonLabel icon={Save} label="Apply To Rules" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        setPineScriptSource('');
                        setPineScriptFileName('');
                        updateBotRulesDraft({ pineAnalysis: null });
                      }}
                    >
                      <PopupButtonLabel icon={X} label="Clear" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      Upload PineScript (.pine/.txt)
                      <input
                        type="file"
                        accept=".pine,.txt,.pinescript"
                        onChange={handlePineScriptFileSelected}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-200 outline-none file:mr-2 file:rounded file:border-0 file:bg-primary-500/20 file:px-2 file:py-1 file:text-[11px] file:text-primary-100"
                      />
                    </label>
                    {pineScriptFileName && <p className="text-[11px] text-gray-400">Loaded file: {pineScriptFileName}</p>}
                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      PineScript Source
                      <textarea
                        value={pineScriptSource}
                        onChange={(event) => setPineScriptSource(event.target.value)}
                        placeholder="//@version=5 strategy(...)"
                        className="mt-1 h-52 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-2 text-xs text-gray-100 outline-none"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    {!activePineAnalysis && (
                      <div className="rounded-lg border border-white/15 bg-black/35 p-2 text-xs text-gray-400">
                        No PineScript analysis yet. Upload/paste script and click <span className="text-gray-200">Analyze Script</span>.
                      </div>
                    )}

                    {activePineAnalysis && (
                      <>
                        <div className="grid gap-2 md:grid-cols-2">
                          <InfoTile label="Script Type" value={activePineAnalysis.scriptType.toUpperCase()} />
                          <InfoTile label="Script Name" value={activePineAnalysis.name || '—'} />
                          <InfoTile label="Interval" value={activePineAnalysis.interval || '—'} />
                          <InfoTile label="Analyzed At" value={formatDate(activePineAnalysis.generatedAt)} />
                        </div>

                        <div className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Indicators</p>
                          <p className="mt-1 text-xs text-gray-200 break-words">
                            {activePineAnalysis.indicators.length ? activePineAnalysis.indicators.join(', ') : 'none'}
                          </p>
                        </div>

                        <div className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Functions</p>
                          <p className="mt-1 text-xs text-gray-200 break-words">
                            {activePineAnalysis.functions.length ? activePineAnalysis.functions.join(', ') : 'none'}
                          </p>
                        </div>

                        <div className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Strategy Actions</p>
                          <p className="mt-1 text-xs text-gray-200 break-words">
                            {activePineAnalysis.actions.length ? activePineAnalysis.actions.join(', ') : 'none'}
                          </p>
                        </div>

                        <div className="rounded-lg border border-white/15 bg-black/35 p-2">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Indicator Settings / Inputs</p>
                          <div className="mt-1 max-h-32 overflow-auto space-y-1 pr-1">
                            {activePineAnalysis.indicatorSettings.length === 0 && (
                              <p className="text-xs text-gray-400">No input.* settings detected.</p>
                            )}
                            {activePineAnalysis.indicatorSettings.map((setting) => (
                              <div key={`${setting.key}:${setting.type}`} className="flex items-center justify-between gap-2 text-[11px] text-gray-200">
                                <p className="truncate">{setting.title || setting.key}</p>
                                <p className="shrink-0 font-mono text-gray-400">
                                  {setting.type} = {setting.defaultValue === null ? 'null' : String(setting.defaultValue)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {activePineAnalysis.notes.length > 0 && (
                          <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 p-2">
                            <p className="text-[11px] uppercase tracking-[0.14em] text-amber-200">Analysis Notes</p>
                            <div className="mt-1 space-y-1 text-xs text-amber-100">
                              {activePineAnalysis.notes.map((note, idx) => (
                                <p key={`${idx}:${note}`}>{note}</p>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

              {activePopupSection === 'parameters' && (
                <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Trading rules and function</p>
                    <p className="mt-1 text-xs text-gray-400">Adjust sizing details, risk rules, ATR stop loss, TP, execution safety, and signal metadata per bot.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleRulesReset}>
                      <PopupButtonLabel icon={RotateCcw} label="Reset Defaults" />
                    </button>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleRulesSave}>
                      <PopupButtonLabel icon={Save} label="Save Rules" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-3 rounded-lg border border-white/15 bg-black/35 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Code-driven parameters</p>
                      <p className="mt-1 text-xs text-gray-300">
                        Parameters are extracted from bot code and stored per bot. Edit values below, then click Save Rules.
                      </p>
                    </div>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleRulesSave}>
                      <PopupButtonLabel icon={RefreshCw} label="Refresh From Code" />
                    </button>
                  </div>

                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Bot Source Code (Python)
                    <textarea
                      value={activeRules.codeSource || ''}
                      onChange={(event) => updateBotRulesDraft({ codeSource: event.target.value })}
                      placeholder="# Paste your bot python code here. Parameters are extracted from constants/dataclass defaults."
                      className="mt-1 h-40 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-2 text-xs text-gray-100 outline-none"
                    />
                  </label>

                  <div className="rounded-md border border-white/10 bg-black/25 px-2 py-2 text-[11px] text-gray-300">
                    Source status:{' '}
                    {activeRules.codeSource
                      ? `loaded (${activeRules.codeSource.length} chars)`
                      : 'not set'}{' '}
                    · Parameters detected: {activeCodeParameterSchema.length}
                    {activeRules.codeParametersUpdatedAt ? ` · Updated ${formatDate(activeRules.codeParametersUpdatedAt)}` : ''}
                  </div>

                  {activeCodeParameterSchema.length === 0 && (
                    <p className="text-xs text-amber-200">
                      No code parameters detected yet. Paste bot code and click <span className="text-amber-100">Refresh From Code</span>.
                    </p>
                  )}

                  {activeCodeParameterSchema.length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {activeCodeParameterSchema.map((param) => {
                        const currentValue = Object.prototype.hasOwnProperty.call(activeCodeParameterValues, param.key)
                          ? activeCodeParameterValues[param.key]
                          : param.defaultValue;

                        return (
                          <label key={`${param.key}:${param.type}`} className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                            {param.label}
                            <p className="mt-1 text-[10px] normal-case tracking-normal text-gray-400">
                              {param.key}
                              {param.source ? ` · ${param.source}` : ''}
                              {param.line ? ` · line ${param.line}` : ''}
                            </p>
                            {param.description && (
                              <p className="mt-1 text-[10px] normal-case tracking-normal text-gray-400">{param.description}</p>
                            )}

                            {param.type === 'boolean' ? (
                              <select
                                value={Boolean(currentValue) ? 'true' : 'false'}
                                onChange={(event) =>
                                  updateCodeParameterDraftValue(param.key, param.type, event.target.value === 'true')
                                }
                                className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : (
                              <input
                                type={param.type === 'number' ? 'number' : 'text'}
                                step={param.type === 'number' ? 'any' : undefined}
                                value={currentValue === null || currentValue === undefined ? '' : String(currentValue)}
                                onChange={(event) =>
                                  updateCodeParameterDraftValue(
                                    param.key,
                                    param.type,
                                    param.type === 'number' ? event.target.value : event.target.value
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Symbol
                    <input
                      value={activeRules.symbol}
                      onChange={(event) => {
                        const symbol = normalizeSymbol(event.target.value);
                        updateBotRulesDraft({ symbol });
                        setTradingSymbol(symbol);
                      }}
                      placeholder="BTCUSDC"
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Function
                    <select
                      value={activeRules.executionFunction}
                      onChange={(event) => updateBotRulesDraft({ executionFunction: event.target.value as ExecutionFunction })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="live_trading">Live trading</option>
                      <option value="paper_trading">Paper trading</option>
                      <option value="signal_only">Signal only</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Signal Timeframe
                    <input
                      value={activeRules.signalTimeframe}
                      onChange={(event) => updateBotRulesDraft({ signalTimeframe: event.target.value })}
                      placeholder="5m"
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Signal Source
                    <select
                      value={activeRules.signalSource}
                      onChange={(event) => updateBotRulesDraft({ signalSource: event.target.value as SignalSource })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="tradingview">TradingView</option>
                      <option value="internal">Internal</option>
                      <option value="api">API</option>
                    </select>
                  </label>

                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Signal Deduplication
                    <select
                      value={activeRules.signalDedupEnabled ? 'enabled' : 'disabled'}
                      onChange={(event) => updateBotRulesDraft({ signalDedupEnabled: event.target.value === 'enabled' })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Dedup Window (sec)
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={activeRules.signalDedupWindowSec}
                      disabled={!activeRules.signalDedupEnabled}
                      onChange={(event) => updateBotRulesDraft({ signalDedupWindowSec: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  <div className="rounded-lg border border-white/15 bg-black/35 px-2 py-1">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Signal ID / hash key</p>
                    <p className="mt-1 text-[11px] font-mono text-gray-200 break-all">{signalHashKey}</p>
                    <p className="mt-1 text-[10px] text-gray-500 break-all">{signalKeySeed}</p>
                  </div>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Preview Side
                    <select
                      value={activeRules.previewSide}
                      onChange={(event) => updateBotRulesDraft({ previewSide: event.target.value as PreviewSide })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Order Type
                    <select
                      value={activeRules.orderType}
                      onChange={(event) => updateBotRulesDraft({ orderType: event.target.value as 'market' | 'limit' })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="market">Market</option>
                      <option value="limit">Limit</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Reference Price Source
                    <select
                      value={activeRules.referencePriceSource}
                      onChange={(event) => updateBotRulesDraft({ referencePriceSource: event.target.value as ReferencePriceSource })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="last">Last Price</option>
                      <option value="mark">Mark Price</option>
                      <option value="mid">Bid/Ask Mid</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Limit Price
                    <input
                      type="number"
                      step="0.00000001"
                      value={activeRules.limitPrice ?? ''}
                      disabled={activeRules.orderType !== 'limit'}
                      onChange={(event) => updateBotRulesDraft({ limitPrice: event.target.value ? Number(event.target.value) : null })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>

                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Sizing Mode
                    <select
                      value={activeRules.sizingMode}
                      onChange={(event) => updateBotRulesDraft({ sizingMode: event.target.value as SizingMode })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="balance_pct">Balance %</option>
                      <option value="fixed_quote">Fixed USDC</option>
                      <option value="risk_per_trade_pct">Risk per trade %</option>
                      <option value="volatility_adjusted">Volatility adjusted</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    {allocationLabel}
                    <input
                      type="number"
                      step="0.0001"
                      value={activeRules.allocationValue}
                      onChange={(event) => updateBotRulesDraft({ allocationValue: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Reinvestment %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.0001"
                      value={activeRules.reinvestmentPct}
                      onChange={(event) => updateBotRulesDraft({ reinvestmentPct: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Enable Compounding
                    <div className="mt-1 flex h-8 items-center rounded-lg border border-white/15 bg-black/35 px-2">
                      <input
                        type="checkbox"
                        checked={Boolean(activeRules.compoundingEnabled)}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          const currentBase = Number(activeRules.compoundingBaseQuote || 0);
                          const inferredBase = Number(quoteAssetBalance?.free || 0);
                          updateBotRulesDraft({
                            compoundingEnabled: enabled,
                            compoundingBaseQuote:
                              enabled && currentBase <= 0 && inferredBase > 0
                                ? inferredBase
                                : activeRules.compoundingBaseQuote
                          });
                        }}
                        className="h-4 w-4 rounded border-white/40 bg-black/40 text-sky-400 focus:ring-0"
                      />
                      <span className="ml-2 text-[11px] normal-case text-gray-300">
                        Scale size with account growth
                      </span>
                    </div>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Compounding Mode
                    <select
                      value={activeRules.compoundingMode}
                      disabled={!activeRules.compoundingEnabled}
                      onChange={(event) => updateBotRulesDraft({ compoundingMode: event.target.value as CompoundingMode })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    >
                      <option value="full_balance">Full balance</option>
                      <option value="profit_only">Profit only</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Compounding Strength %
                    <input
                      type="number"
                      min={0}
                      max={300}
                      step="0.0001"
                      disabled={!activeRules.compoundingEnabled}
                      value={activeRules.compoundingPct}
                      onChange={(event) => updateBotRulesDraft({ compoundingPct: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Compounding Base Quote
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      disabled={!activeRules.compoundingEnabled}
                      value={activeRules.compoundingBaseQuote ?? ''}
                      placeholder={quoteAssetBalance?.free ? String(Number(quoteAssetBalance.free)) : 'optional'}
                      onChange={(event) =>
                        updateBotRulesDraft({
                          compoundingBaseQuote: event.target.value ? Number(event.target.value) : null
                        })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  {activeRules.compoundingEnabled &&
                    activeRules.compoundingMode === 'full_balance' &&
                    !activeRules.compoundingBaseQuote && (
                      <div className="md:col-span-2 xl:col-span-2 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                        Full-balance compounding needs a base quote value. If empty, live size may stay near baseline.
                      </div>
                    )}
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Min Quote Spend
                    <input
                      type="number"
                      step="0.0001"
                      value={activeRules.minQuoteSpend}
                      onChange={(event) => updateBotRulesDraft({ minQuoteSpend: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Max Quote Spend
                    <input
                      type="number"
                      step="0.0001"
                      value={activeRules.maxQuoteSpend}
                      onChange={(event) => updateBotRulesDraft({ maxQuoteSpend: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <div className="md:col-span-2 xl:col-span-2 rounded-lg border border-sky-300/25 bg-sky-500/8 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-sky-100">Min Notional Scope</p>
                    <p className="mt-1 text-[11px] text-sky-50">BUY uses floor: max(exchange minNotional, minQuoteSpend)</p>
                    <p className="text-[11px] text-sky-50">SELL uses floor: exchange minNotional only</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border border-sky-300/25 bg-black/25 px-2 py-1">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-sky-100">BUY Effective Floor</p>
                        <p className="mt-1 text-xs font-semibold text-white">{formatDecimal(sideAwareMinNotional.buyFloor)}</p>
                      </div>
                      <div className="rounded-md border border-sky-300/25 bg-black/25 px-2 py-1">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-sky-100">SELL Effective Floor</p>
                        <p className="mt-1 text-xs font-semibold text-white">{formatDecimal(sideAwareMinNotional.sellFloor)}</p>
                      </div>
                    </div>
                  </div>

                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Stop Loss Type
                    <select
                      value={activeRules.slType}
                      onChange={(event) => updateBotRulesDraft({ slType: event.target.value as StopType })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="none">None</option>
                      <option value="percent">Percent</option>
                      <option value="atr_multiplier">ATR Multiplier</option>
                      <option value="fixed_price">Fixed Price</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Stop Loss Value
                    <input
                      type="number"
                      step="0.0001"
                      value={activeRules.slValue ?? ''}
                      disabled={activeRules.slType === 'none' || activeRules.slType === 'atr_multiplier'}
                      onChange={(event) => updateBotRulesDraft({ slValue: event.target.value ? Number(event.target.value) : null })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    ATR Length
                    <input
                      type="number"
                      min={2}
                      step="1"
                      value={activeRules.slAtrLength}
                      disabled={activeRules.slType !== 'atr_multiplier'}
                      onChange={(event) => updateBotRulesDraft({ slAtrLength: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    ATR Multiplier
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={activeRules.slAtrMultiplier ?? ''}
                      disabled={activeRules.slType !== 'atr_multiplier'}
                      onChange={(event) => updateBotRulesDraft({ slAtrMultiplier: event.target.value ? Number(event.target.value) : null })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Take Profit Type
                    <select
                      value={activeRules.tpType}
                      onChange={(event) => updateBotRulesDraft({ tpType: event.target.value as StopType })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="none">None</option>
                      <option value="percent">Percent</option>
                      <option value="rr">Risk:Reward</option>
                      <option value="fixed_price">Fixed Price</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Take Profit Value
                    <input
                      type="number"
                      step="0.0001"
                      value={activeRules.tpValue ?? ''}
                      disabled={activeRules.tpType === 'none'}
                      onChange={(event) => updateBotRulesDraft({ tpValue: event.target.value ? Number(event.target.value) : null })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>

                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Max Exposure %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.0001"
                      value={activeRules.maxPositionExposurePct}
                      onChange={(event) => updateBotRulesDraft({ maxPositionExposurePct: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Max Open Positions / Symbol
                    <input
                      type="number"
                      min={1}
                      step="1"
                      value={activeRules.maxOpenPositionsPerSymbol}
                      onChange={(event) => updateBotRulesDraft({ maxOpenPositionsPerSymbol: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Cooldown Seconds
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={activeRules.cooldownSeconds}
                      onChange={(event) => updateBotRulesDraft({ cooldownSeconds: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Max Open Orders / Symbol
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={activeRules.maxOpenOrdersPerSymbol}
                      onChange={(event) => updateBotRulesDraft({ maxOpenOrdersPerSymbol: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Slippage Tolerance %
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={activeRules.slippageTolerancePct}
                      onChange={(event) => updateBotRulesDraft({ slippageTolerancePct: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Cancel If Not Filled (sec)
                    <input
                      type="number"
                      min={0}
                      step="1"
                      value={activeRules.cancelIfNotFilledSec}
                      onChange={(event) => updateBotRulesDraft({ cancelIfNotFilledSec: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Daily Loss Cap
                    <select
                      value={activeRules.dailyLossCapEnabled ? 'enabled' : 'disabled'}
                      onChange={(event) => updateBotRulesDraft({ dailyLossCapEnabled: event.target.value === 'enabled' })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                    >
                      <option value="disabled">Disabled</option>
                      <option value="enabled">Enabled</option>
                    </select>
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Daily Loss Limit %
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={activeRules.dailyLossLimitPct}
                      disabled={!activeRules.dailyLossCapEnabled}
                      onChange={(event) => updateBotRulesDraft({ dailyLossLimitPct: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                  <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    Daily Reset Time (UTC)
                    <input
                      type="time"
                      value={activeRules.dailyResetTimeUtc}
                      disabled={!activeRules.dailyLossCapEnabled}
                      onChange={(event) => updateBotRulesDraft({ dailyResetTimeUtc: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none disabled:opacity-40"
                    />
                  </label>
                </div>

                {rulesPreview && (
                  <div className="mt-3 space-y-2">
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        rulesPreview.status === 'ready'
                          ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100'
                          : rulesPreview.status === 'warning'
                            ? 'border-amber-300/35 bg-amber-500/10 text-amber-100'
                            : 'border-rose-300/35 bg-rose-500/10 text-rose-100'
                      }`}
                    >
                      Preview status: {rulesPreview.status.toUpperCase()}
                      {rulesPreview.reason ? ` · ${rulesPreview.reason}` : ''}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                      <InfoTile label="Preview Side" value={String(rulesPreview.previewSide || '').toUpperCase()} />
                      <InfoTile label="Ref Price Source" value={String(rulesPreview.referencePriceSource || '').toUpperCase()} />
                      <InfoTile label="Compounding" value={rulesPreview.compoundingEnabled ? 'ON' : 'OFF'} />
                      <InfoTile label="Compounding Mode" value={String(rulesPreview.compoundingMode || '').toUpperCase()} />
                      <InfoTile label="Compounding Base" value={formatDecimal(rulesPreview.compoundingBaseQuoteUsed)} />
                      <InfoTile label="Compounding Factor" value={formatDecimal(rulesPreview.compoundingFactor, 6)} />
                      <InfoTile label="Compounding Profit" value={formatDecimal(rulesPreview.compoundingProfitQuote)} />
                      <InfoTile label="Spend Before Compound" value={formatDecimal(rulesPreview.quoteSpendBeforeCompounding)} />
                      <InfoTile label="Quote Spend" value={formatDecimal(rulesPreview.quoteSpend)} />
                      <InfoTile label="Min Quote Floor (applied)" value={formatDecimal(rulesPreview.minQuoteSpendFloor)} />
                      <InfoTile label="Qty Raw" value={formatDecimal(rulesPreview.qtyRaw, 10)} />
                      <InfoTile label="Qty Final" value={formatDecimal(rulesPreview.qtyFinal, 10)} />
                      <InfoTile label="Notional" value={formatDecimal(rulesPreview.notionalAfterRounding)} />
                      <InfoTile label="Min Notional (applied)" value={formatDecimal(rulesPreview.effectiveMinNotional)} />
                      <InfoTile label="Min Notional BUY" value={formatDecimal(rulesPreview.effectiveMinNotionalBuy)} />
                      <InfoTile label="Min Notional SELL" value={formatDecimal(rulesPreview.effectiveMinNotionalSell)} />
                      <InfoTile label="ATR" value={formatDecimal(rulesPreview.atrValue)} />
                      <InfoTile label="SL Price" value={formatDecimal(rulesPreview.slPrice)} />
                      <InfoTile label="TP Price" value={formatDecimal(rulesPreview.tpPrice)} />
                    </div>
                  </div>
                )}
                {runtimeConfigPreview && (
                  <div className="mt-3 rounded-lg border border-white/15 bg-black/35 p-2">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Runtime config preview</p>
                    <pre className="mt-2 max-h-52 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[11px] text-gray-200">
                      {JSON.stringify(runtimeConfigPreview, null, 2)}
                    </pre>
                  </div>
                )}
                </section>
              )}

              {activePopupSection === 'arn-pine' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">ARN Pine faithful settings</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Dedicated popup page for ARN bot runtime parameters, modeled after the MEXC popup flow.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleResetArnParameterDefaults}>
                        <PopupButtonLabel icon={RotateCcw} label="Reset ARN Defaults" />
                      </button>
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleRulesSave}>
                        <PopupButtonLabel icon={Save} label="Save Rules" />
                      </button>
                    </div>
                  </div>

                  {!isArnPineBot && (
                    <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      Active bot does not match ARN Pine profile.
                    </div>
                  )}

                  {isArnPineBot && arnParameterSchema.length === 0 && (
                    <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      ARN parameter schema not available yet. Open <span className="text-amber-50">Parameters</span> and click
                      <span className="text-amber-50"> Save Rules</span> to hydrate code-driven parameters from backend runtime config.
                    </div>
                  )}

                  {isArnPineBot && arnParameterSchema.length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {arnParameterSchema.map((param) => {
                        const currentValue = Object.prototype.hasOwnProperty.call(arnParameterValueByKey, param.key)
                          ? arnParameterValueByKey[param.key]
                          : param.defaultValue;
                        return (
                          <label key={`arn:${param.key}`} className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                            {param.label}
                            <p className="mt-1 text-[10px] normal-case tracking-normal text-gray-400">
                              {param.key}
                              {param.source ? ` · ${param.source}` : ''}
                            </p>
                            {param.description && (
                              <p className="mt-1 text-[10px] normal-case tracking-normal text-gray-400">{param.description}</p>
                            )}
                            {param.type === 'boolean' ? (
                              <select
                                value={Boolean(currentValue) ? 'true' : 'false'}
                                onChange={(event) => updateCodeParameterDraftValue(param.key, param.type, event.target.value === 'true')}
                                className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : (
                              <input
                                type={param.type === 'number' ? 'number' : 'text'}
                                step={param.type === 'number' ? 'any' : undefined}
                                value={currentValue === null || currentValue === undefined ? '' : String(currentValue)}
                                onChange={(event) => updateCodeParameterDraftValue(param.key, param.type, event.target.value)}
                                className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <InfoTile label="Runtime Path" value="/api/v1/internal/bot/runtime-config" mono />
                    <InfoTile label="Signal Path" value="/signal" mono />
                    <InfoTile label="Schema Params" value={String(arnParameterSchema.length)} />
                    <InfoTile
                      label="Param Source"
                      value={activeRules.codeSource ? 'code-derived' : activeCodeParameterSchema.length > 0 ? 'stored schema' : 'none'}
                    />
                  </div>

                  {arnSignalPreview && (
                    <div className="rounded-lg border border-white/15 bg-black/35 p-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">ARN Signal Payload Preview</p>
                      <pre className="mt-2 max-h-56 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[11px] text-gray-200">
                        {JSON.stringify(arnSignalPreview, null, 2)}
                      </pre>
                    </div>
                  )}
                </section>
              )}

              {activePopupSection === 'algo' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Algo compounding math</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Calculate compounding base quote from a target spend %, inspect factor math, and apply values for this bot runtime.
                      </p>
                      <p className="mt-1 text-[11px] text-amber-100">Use this for the MEXC MACD bot runtime profile.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleRulesSave}>
                        <PopupButtonLabel icon={Save} label="Save Rules" />
                      </button>
                    </div>
                  </div>

                  <div className="inline-flex items-center rounded-full border border-white/20 bg-black/40 p-1">
                    <button
                      type="button"
                      onClick={() => setAlgoMathSide('buy')}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                        !algoIsSell
                          ? 'border border-emerald-300/50 bg-emerald-500/25 text-emerald-50'
                          : 'text-emerald-200/75 hover:bg-emerald-500/10'
                      }`}
                    >
                      <PopupButtonLabel icon={Play} label="Buy" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlgoMathSide('sell')}
                      className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                        algoIsSell
                          ? 'border border-rose-300/50 bg-rose-500/25 text-rose-50'
                          : 'text-rose-200/75 hover:bg-rose-500/10'
                      }`}
                    >
                      <PopupButtonLabel icon={Square} label="Sell" />
                    </button>
                  </div>

                  {algoMathPreview && (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
                      <InfoTile label="Side" value={String(algoMathPreview.side || '').toUpperCase()} />
                      <InfoTile label="Ref Price" value={formatDecimal(algoMathPreview.refPrice)} />
                      <InfoTile label="Capacity Quote" value={formatDecimal(algoMathPreview.capacityQuote)} />
                      <InfoTile label="Allocation %" value={formatDecimal(activeRules.allocationValue, 4)} />
                      {!algoIsSell && <InfoTile label="Reinvestment %" value={formatDecimal(activeRules.reinvestmentPct, 4)} />}
                      <InfoTile label="Base Spend" value={formatDecimal(algoMathPreview.baseSpend)} />
                      <InfoTile label="Compounding Factor" value={formatDecimal(algoMathPreview.compoundingFactor, 8)} />
                      <InfoTile label="Quote Spend Raw" value={formatDecimal(algoMathPreview.quoteSpendRaw)} />
                      <InfoTile label="Quote Spend Final" value={formatDecimal(algoMathPreview.quoteSpend)} />
                      <InfoTile label="Qty Raw" value={formatDecimal(algoMathPreview.qtyRaw, 10)} />
                      <InfoTile label="Target Spend %" value={formatDecimal(algoMathPreview.targetSpendPct, 4)} />
                      <InfoTile label="Target Applied" value={algoMathPreview.targetSpendApplied ? 'YES' : 'NO'} />
                      <InfoTile label="Base Quote (Manual)" value={formatDecimal(algoMathPreview.compoundingBaseQuoteConfigured)} />
                      <InfoTile label="Base Quote (Auto)" value={formatDecimal(algoMathPreview.compoundingBaseQuoteAuto)} />
                      <InfoTile label="Base Quote (Used)" value={formatDecimal(algoMathPreview.compoundingBaseQuoteUsed)} />
                      {algoIsSell && (
                        <InfoTile label="Profit Side" value={algoMathPreview.profitSide ? 'YES' : 'NO'} />
                      )}
                      {algoIsSell && (
                        <InfoTile label="Ref BUY Price" value={formatDecimal(algoMathPreview.referenceBuyPrice)} />
                      )}
                      {algoIsSell && (
                        <InfoTile label="Ladder Applied" value={algoMathPreview.ladderApplied ? 'YES' : 'NO'} />
                      )}
                      {algoIsSell && (
                        <InfoTile label="Ladder Factor" value={formatDecimal(algoMathPreview.ladderFactor, 8)} />
                      )}
                    </div>
                  )}

                  <div
                    className={`rounded-lg border px-3 py-2 text-[11px] ${
                      algoIsSell
                        ? 'border-rose-300/30 bg-rose-500/10 text-rose-50'
                        : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-50'
                    }`}
                  >
                    <p className={`text-[10px] uppercase tracking-[0.16em] ${algoIsSell ? 'text-rose-100' : 'text-emerald-100'}`}>Math</p>
                    {!algoIsSell && (
                      <>
                        <p className="mt-1 font-mono">baseSpend = freeQuote * (allocationValue/100) * (reinvestmentPct/100)</p>
                        <p className="mt-1 font-mono">factor(full_balance) = 1 + (freeQuote/baseQuote - 1) * (compoundingPct/100)</p>
                        <p className="mt-1 font-mono">quoteSpendRaw = baseSpend * factor</p>
                        <p className="mt-1 font-mono">
                          autoBaseQuote = (strength * freeQuote) / ((targetSpend/baseSpend) - 1 + strength), targetSpend = freeQuote * (targetSpendPct/100)
                        </p>
                      </>
                    )}
                    {algoIsSell && (
                      <>
                        <p className="mt-1 font-mono">sellCapacityQuote = freeBase * marketSellPrice</p>
                        <p className="mt-1 font-mono">
                          baseSellQuote = sizingMode==fixed_quote ? allocationValue : sellCapacityQuote * (allocationValue/100)
                        </p>
                        <p className="mt-1 font-mono">profit side: factor = 1 + (sellCapacityQuote/baseQuote - 1) * (sellCompoundingPct/100)</p>
                        <p className="mt-1 font-mono">profit side: quoteSpendRaw = baseSellQuote * factor</p>
                        <p className="mt-1 font-mono">targetSellQuote = sellCapacityQuote * (sellTargetSpendPct/100)</p>
                        <p className="mt-1 font-mono">
                          loss side: edgeRatio = (marketSellPrice - refBuyPrice) / refBuyPrice, qtyRaw = baseQty * clamp(1 + edgeRatio * slope, minFactor, maxFactor)
                        </p>
                      </>
                    )}
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      Enable Compounding
                      <div className="mt-1 flex h-8 items-center rounded-lg border border-white/15 bg-black/35 px-2">
                        <input
                          type="checkbox"
                          checked={Boolean(algoIsSell ? activeRules.sellCompoundingEnabled : activeRules.compoundingEnabled)}
                          onChange={(event) =>
                            updateBotRulesDraft(
                              algoIsSell
                                ? { sellCompoundingEnabled: event.target.checked }
                                : { compoundingEnabled: event.target.checked }
                            )}
                          className={`h-4 w-4 rounded border-white/40 bg-black/40 ${algoIsSell ? 'text-rose-400' : 'text-emerald-400'} focus:ring-0`}
                        />
                        <span className="ml-2 text-[11px] normal-case text-gray-300">Use compounding factor</span>
                      </div>
                    </label>

                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      Compounding Mode
                      <select
                        value={algoIsSell ? activeRules.sellCompoundingMode : activeRules.compoundingMode}
                        onChange={(event) =>
                          updateBotRulesDraft(
                            algoIsSell
                              ? { sellCompoundingMode: event.target.value as CompoundingMode }
                              : { compoundingMode: event.target.value as CompoundingMode }
                          )}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                      >
                        <option value="full_balance">Full balance</option>
                        <option value="profit_only">Profit only</option>
                      </select>
                    </label>

                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      Compounding Strength %
                      <input
                        type="number"
                        min={0}
                        max={300}
                        step="0.0001"
                        value={algoIsSell ? activeRules.sellCompoundingPct : activeRules.compoundingPct}
                        onChange={(event) =>
                          updateBotRulesDraft(
                            algoIsSell
                              ? { sellCompoundingPct: Number(event.target.value) }
                              : { compoundingPct: Number(event.target.value) }
                          )}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                      />
                    </label>

                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      Target Spend %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.0001"
                        value={algoIsSell ? activeRules.sellTargetSpendPct ?? '' : activeRules.targetSpendPct ?? ''}
                        placeholder={algoIsSell ? 'e.g. 91.05' : 'e.g. 93.05'}
                        onChange={(event) =>
                          updateBotRulesDraft(
                            algoIsSell
                              ? { sellTargetSpendPct: event.target.value ? Number(event.target.value) : null }
                              : { targetSpendPct: event.target.value ? Number(event.target.value) : null }
                          )}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                      />
                    </label>

                    <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                      Compounding Base Quote
                      <input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={algoIsSell ? activeRules.sellCompoundingBaseQuote ?? '' : activeRules.compoundingBaseQuote ?? ''}
                        placeholder="optional/manual"
                        onChange={(event) =>
                          updateBotRulesDraft(
                            algoIsSell
                              ? { sellCompoundingBaseQuote: event.target.value ? Number(event.target.value) : null }
                              : { compoundingBaseQuote: event.target.value ? Number(event.target.value) : null }
                          )}
                        className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                      />
                    </label>

                    {algoIsSell && (
                      <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        Enable Loss Ladder
                        <div className="mt-1 flex h-8 items-center rounded-lg border border-white/15 bg-black/35 px-2">
                          <input
                            type="checkbox"
                            checked={Boolean(activeRules.sellLadderEnabled)}
                            onChange={(event) => updateBotRulesDraft({ sellLadderEnabled: event.target.checked })}
                            className="h-4 w-4 rounded border-white/40 bg-black/40 text-rose-400 focus:ring-0"
                          />
                          <span className="ml-2 text-[11px] normal-case text-gray-300">Reduce qty faster on loss</span>
                        </div>
                      </label>
                    )}

                    {algoIsSell && (
                      <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        Ladder Strength %
                        <input
                          type="number"
                          min={0}
                          max={500}
                          step="0.0001"
                          value={activeRules.sellLadderStrengthPct}
                          onChange={(event) => updateBotRulesDraft({ sellLadderStrengthPct: Number(event.target.value) })}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                        />
                      </label>
                    )}

                    {algoIsSell && (
                      <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        Ladder Min Factor
                        <input
                          type="number"
                          min={0.01}
                          max={1}
                          step="0.0001"
                          value={activeRules.sellLadderMinFactor}
                          onChange={(event) => updateBotRulesDraft({ sellLadderMinFactor: Number(event.target.value) })}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                        />
                      </label>
                    )}

                    {algoIsSell && (
                      <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        Ladder Max Factor
                        <input
                          type="number"
                          min={1}
                          max={10}
                          step="0.0001"
                          value={activeRules.sellLadderMaxFactor}
                          onChange={(event) => updateBotRulesDraft({ sellLadderMaxFactor: Number(event.target.value) })}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                        />
                      </label>
                    )}

                    <div className="rounded-lg border border-white/15 bg-black/35 px-2 py-1">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Auto base quote</p>
                      <p className="mt-1 text-xs text-gray-100">{formatDecimal(targetSpendSuggestedBaseQuote)}</p>
                      <button
                        type="button"
                        className={`mt-2 ${FUTURE_ACTION_PRIMARY}`}
                        disabled={targetSpendSuggestedBaseQuote === null}
                        onClick={() => {
                          if (targetSpendSuggestedBaseQuote === null) return;
                          updateBotRulesDraft(
                            algoIsSell
                              ? {
                                  sellCompoundingEnabled: true,
                                  sellCompoundingMode: 'full_balance',
                                  sellCompoundingBaseQuote: Number(targetSpendSuggestedBaseQuote.toFixed(8))
                                }
                              : {
                                  compoundingEnabled: true,
                                  compoundingMode: 'full_balance',
                                  compoundingBaseQuote: Number(targetSpendSuggestedBaseQuote.toFixed(8))
                                }
                          );
                        }}
                      >
                        <PopupButtonLabel icon={Save} label="Apply Auto Base Quote" />
                      </button>
                    </div>

                    <div className="rounded-lg border border-white/15 bg-black/35 px-2 py-1">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Quick target</p>
                      <button
                        type="button"
                        className={`mt-2 w-full ${FUTURE_ACTION_PRIMARY}`}
                        onClick={() => updateBotRulesDraft(algoIsSell ? { sellTargetSpendPct: 91.05 } : { targetSpendPct: 93.05 })}
                      >
                        <PopupButtonLabel icon={Plus} label={algoIsSell ? 'Set 91.05%' : 'Set 93.05%'} />
                      </button>
                    </div>
                  </div>

                  {((algoIsSell ? activeRules.sellTargetSpendPct : activeRules.targetSpendPct) &&
                    (algoIsSell ? activeRules.sellCompoundingMode : activeRules.compoundingMode) !== 'full_balance') && (
                    <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                      Target spend auto-base works with full-balance compounding mode only.
                    </div>
                  )}

                  {algoIsSell && algoMathPreview && !algoMathPreview.profitSide && (
                    <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                      Current sell is not on profit side vs last BUY reference. SELL compounding math above is planning math; runtime uses ladder/baseline on loss side.
                    </div>
                  )}

                  <div className="rounded-lg border border-white/15 bg-black/35 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Compounding base quote table</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Columns: compoundingBaseQuote, compoundingFactor, quoteSpendRaw. Uses current side math and compounding settings.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={FUTURE_ACTION_STOP}
                          onClick={() => {
                            setAlgoBaseStart(10);
                            setAlgoBaseEnd(50);
                          }}
                        >
                          <PopupButtonLabel icon={RotateCcw} label="10-50" />
                        </button>
                        <button
                          type="button"
                          className={FUTURE_ACTION_STOP}
                          onClick={() => {
                            setAlgoBaseStart(51);
                            setAlgoBaseEnd(100);
                          }}
                        >
                          <PopupButtonLabel icon={RotateCcw} label="51-100" />
                        </button>
                        <button
                          type="button"
                          className={FUTURE_ACTION_STOP}
                          onClick={() => {
                            setAlgoBaseStart(101);
                            setAlgoBaseEnd(150);
                          }}
                        >
                          <PopupButtonLabel icon={RotateCcw} label="101-150" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        Base Quote Start
                        <input
                          type="number"
                          step="1"
                          min={1}
                          value={algoBaseStart}
                          onChange={(event) => setAlgoBaseStart(Number(event.target.value))}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                        />
                      </label>
                      <label className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        Base Quote End
                        <input
                          type="number"
                          step="1"
                          min={1}
                          value={algoBaseEnd}
                          onChange={(event) => setAlgoBaseEnd(Number(event.target.value))}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none"
                        />
                      </label>
                    </div>

                    <div className="mt-2 max-h-80 overflow-auto rounded-md border border-white/10">
                      <table className="w-full text-left text-xs text-gray-200">
                        <thead className="sticky top-0 bg-black/75 text-[10px] uppercase tracking-[0.14em] text-gray-400">
                          <tr>
                            <th className="px-2 py-2">Compounding Base Quote</th>
                            <th className="px-2 py-2">Compounding Factor</th>
                            <th className="px-2 py-2">Quote Spend Raw</th>
                          </tr>
                        </thead>
                        <tbody>
                          {algoCompoundingRows.map((row) => (
                            <tr key={`algo:${row.compoundingBaseQuote}`} className="border-t border-white/10">
                              <td className="px-2 py-1.5 font-mono text-[11px] text-gray-100">{formatDecimal(row.compoundingBaseQuote, 8)}</td>
                              <td className="px-2 py-1.5 font-mono text-[11px] text-gray-100">{formatDecimal(row.compoundingFactor, 8)}</td>
                              <td className="px-2 py-1.5 font-mono text-[11px] text-gray-100">{formatDecimal(row.quoteSpendRaw, 8)}</td>
                            </tr>
                          ))}
                          {algoCompoundingRows.length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-2 py-2 text-[11px] text-gray-400">
                                No rows to show.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              )}

              {activePopupSection === 'exchange' && (
                <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Exchange trading details</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Live trading prerequisites pulled from the linked exchange integration: balances, symbol filters, and execution readiness.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={tradingSymbol}
                      onChange={(event) => {
                        const symbol = normalizeSymbol(event.target.value);
                        setTradingSymbol(symbol);
                        updateBotRulesDraft({ symbol });
                      }}
                      placeholder="BTCUSDC"
                      className="w-36 rounded-lg border border-white/15 bg-black/35 px-2 py-1 text-xs text-gray-100 outline-none transition focus:border-primary-300/60"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-small disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={handleRefreshTradingDetails}
                      disabled={!selectedBotLink.integrationId || tradingDetailsLoading}
                    >
                      <PopupButtonLabel icon={RefreshCw} label={tradingDetailsLoading ? 'Pulling...' : 'Pull from Exchange'} />
                    </button>
                  </div>
                </div>

                {!selectedBotLink.integrationId && (
                  <p className="mt-3 text-xs text-gray-400">Link an exchange integration to pull trading-required exchange details.</p>
                )}

                {selectedBotLink.integrationId && (
                  <div className="mt-3 space-y-3">
                    {tradingDetailsError && (
                      <div className="rounded-lg border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                        {tradingDetailsError}
                      </div>
                    )}
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <InfoTile
                        label="Exchange"
                        value={`${(integrationDetail?.exchange || linkedIntegration?.exchange || '—').toUpperCase()} · ${
                          integrationDetail?.environment || linkedIntegration?.environment || 'live'
                        }`}
                      />
                      <InfoTile label="Integration status" value={integrationDetail?.status || linkedIntegration?.status || 'unknown'} />
                      <InfoTile
                        label="Last checked"
                        value={formatDate(exchangeSnapshot?.checkedAt || integrationDetail?.lastTestedAt || linkedIntegration?.lastTestedAt || null)}
                      />
                      <InfoTile
                        label="Credential key"
                        value={integrationCredentials[0]?.apiKeyMasked || integrationDetail?.apiKeyMasked || linkedIntegration?.apiKeyMasked || '—'}
                        mono
                      />
                      <InfoTile label={`Free ${symbolAssets.quoteAsset || 'quote'}`} value={formatDecimal(quoteAssetBalance?.free)} />
                      <InfoTile label={`Free ${symbolAssets.baseAsset || 'base'}`} value={formatDecimal(baseAssetBalance?.free)} />
                      <InfoTile label="Last price" value={formatDecimal(marketPrices?.last || marketTicker?.price)} />
                      <InfoTile label="Mark price" value={formatDecimal(marketPrices?.mark)} />
                      <InfoTile label="Bid/Ask mid" value={formatDecimal(marketPrices?.mid)} />
                      <InfoTile label="ATR" value={formatDecimal(marketAtr?.value)} />
                      <InfoTile label="Min notional" value={formatDecimal(marketFilters?.minNotional)} />
                      <InfoTile label="Step size" value={formatDecimal(marketFilters?.stepSize, 12)} />
                      <InfoTile label="Min qty" value={formatDecimal(marketFilters?.minQty, 12)} />
                      <InfoTile label="Open orders" value={openOrdersSummary ? String(openOrdersSummary.countForSymbol || 0) : '—'} />
                      <InfoTile label="Recent trades" value={tradesSummary ? String(tradesSummary.count || 0) : '—'} />
                    </div>
                    <div className="rounded-lg border border-white/15 bg-black/35 p-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Recent exchange logs</p>
                      {integrationLogs.length === 0 && <p className="mt-1 text-xs text-gray-400">No exchange log entries available.</p>}
                      {integrationLogs.slice(0, 3).map((log) => (
                        <div key={log.id} className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-300">
                          <p className="truncate">{log.message}</p>
                          <p className="shrink-0 text-[11px] text-gray-500">{formatDate(log.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </section>
              )}

              {activePopupSection === 'trade-history' && (
                <section className="rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Trade history</p>
                      <p className="mt-1 text-xs text-gray-400">Recent bot trade signals from the linked exchange integration.</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={handleRefreshTradingDetails}
                      disabled={!selectedBotLink.integrationId || tradingDetailsLoading}
                    >
                      <PopupButtonLabel icon={RefreshCw} label={tradingDetailsLoading ? 'Pulling...' : 'Refresh Trades'} />
                    </button>
                  </div>

                  {!selectedBotLink.integrationId && (
                    <p className="mt-3 text-xs text-gray-400">Link an exchange integration to load trade history.</p>
                  )}

                  {selectedBotLink.integrationId && (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <InfoTile label="Total signals" value={String(tradesSummary?.count || 0)} />
                        <InfoTile label="Quote filled" value={formatDecimal(tradesSummary?.totalQuoteQty)} />
                        <InfoTile label="Qty filled" value={formatDecimal(tradesSummary?.totalQty)} />
                        <InfoTile label="Latest signal" value={formatDate(tradesSummary?.latestTradeAt || null)} />
                      </div>

                      <div className="overflow-x-auto rounded-xl border border-white/15 bg-black/35">
                        <table className="min-w-full text-xs text-gray-200">
                          <thead className="text-left text-[10px] uppercase tracking-[0.14em] text-gray-500">
                            <tr>
                              <th className="px-3 py-2">Signal time</th>
                              <th className="px-3 py-2">Symbol</th>
                              <th className="px-3 py-2">Side</th>
                              <th className="px-3 py-2">Price</th>
                              <th className="px-3 py-2">Qty</th>
                              <th className="px-3 py-2">Quote qty</th>
                              <th className="px-3 py-2">Order ID</th>
                              <th className="px-3 py-2">Fee</th>
                              <th className="px-3 py-2">Liquidity</th>
                              <th className="px-3 py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tradeHistoryRows.length === 0 && (
                              <tr className="border-t border-white/10">
                                <td className="px-3 py-3 text-gray-400" colSpan={10}>
                                  No trade signals found for the current symbol/integration.
                                </td>
                              </tr>
                            )}
                            {tradeHistoryRows.map((row) => (
                              <tr key={row.id} className="border-t border-white/10">
                                <td className="px-3 py-2">{formatDate(row.executedAt)}</td>
                                <td className="px-3 py-2 font-mono">{row.symbol}</td>
                                <td className="px-3 py-2">{row.side}</td>
                                <td className="px-3 py-2">{formatDecimal(row.price, 8)}</td>
                                <td className="px-3 py-2">{formatDecimal(row.qty, 8)}</td>
                                <td className="px-3 py-2">{formatDecimal(row.quoteQty, 8)}</td>
                                <td className="px-3 py-2 font-mono">{row.orderId}</td>
                                <td className="px-3 py-2">{row.fee}</td>
                                <td className="px-3 py-2 uppercase">{row.liquidity}</td>
                                <td className="px-3 py-2 uppercase">{row.signalStatus}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/45 p-3 text-xs text-gray-300">
                <p>Linked TradingView URL: {selectedBotLink.webhookUrl || 'none'}</p>
                <p>Linked exchange integration: {linkedIntegration?.label || linkedIntegration?.exchange || 'none'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

type BotConnectivityStatus = 'online' | 'idle' | 'issue';

function botConnectivityStatus(bot: TradeBotRow, link?: BotConnectivityLink): BotConnectivityStatus {
  const hasBotConnectivityLink = Boolean(link?.webhookUrl && link?.integrationId);
  if (hasBotConnectivityLink) return 'online';
  const status = String(bot.latestVersion?.status || '').toLowerCase();
  const instances = Number(bot.counts?.instances || 0);
  if (['error', 'failed', 'rejected', 'disabled'].includes(status)) return 'issue';
  if (instances > 0 || ['published', 'approved', 'running', 'active', 'connected'].includes(status)) return 'online';
  return 'idle';
}

type TradeBotConnectivityNode = {
  id: string;
  label: string;
  type: 'source' | 'bot' | 'integration';
  status: 'ok' | 'degraded' | 'down' | 'idle' | 'unknown';
};

type TradeBotConnectivityLink = {
  id: string;
  from: string;
  to: string;
  status: 'ok' | 'degraded' | 'down' | 'idle' | 'unknown';
  alertsLastWindow?: number;
};

function toConnectivityState(value: BotConnectivityStatus): TradeBotConnectivityNode['status'] {
  if (value === 'online') return 'ok';
  if (value === 'issue') return 'down';
  return 'idle';
}

function connectivityTone(status?: string | null) {
  const key = String(status || 'unknown').toLowerCase();
  if (key === 'ok') return '#34d399';
  if (key === 'degraded') return '#fbbf24';
  if (key === 'down') return '#f87171';
  if (key === 'idle') return 'rgba(52, 211, 153, 0.45)';
  return '#9ca3af';
}

function aggregateConnectivityStatus(nodes: Array<{ status?: string | null }> = []) {
  const states = nodes.map((node) => String(node.status || 'unknown').toLowerCase());
  if (states.includes('down')) return 'down';
  if (states.includes('degraded')) return 'degraded';
  if (states.includes('ok')) return 'ok';
  if (states.includes('idle')) return 'idle';
  return 'unknown';
}

function ConnectivityMindmap({
  bots,
  botLinks
}: {
  bots: TradeBotRow[];
  botLinks: Record<string, BotConnectivityLink>;
}) {
  const scopedBots = useMemo(() => bots.slice(0, 12), [bots]);

  const connectivityNodes = useMemo<TradeBotConnectivityNode[]>(() => {
    const botNodes = scopedBots.map((bot) => {
      const status = botConnectivityStatus(bot, botLinks[bot.id]);
      return {
        id: `bot:${bot.id}`,
        label: normalizeBotName(bot.name),
        type: 'bot' as const,
        status: toConnectivityState(status)
      };
    });

    const integrationStatusMap = new Map<string, TradeBotConnectivityNode['status'][]>();
    scopedBots.forEach((bot) => {
      const link = botLinks[bot.id];
      if (!link?.integrationId) return;
      const state = toConnectivityState(botConnectivityStatus(bot, link));
      const key = String(link.integrationId);
      if (!integrationStatusMap.has(key)) integrationStatusMap.set(key, []);
      integrationStatusMap.get(key)?.push(state);
    });

    const integrationNodes = Array.from(integrationStatusMap.entries()).map(([integrationId, states]) => {
      let status: TradeBotConnectivityNode['status'] = 'unknown';
      if (states.includes('down')) status = 'down';
      else if (states.includes('degraded')) status = 'degraded';
      else if (states.includes('ok')) status = 'ok';
      else if (states.includes('idle')) status = 'idle';

      return {
        id: `integration:${integrationId}`,
        label: `Integration ${integrationId.slice(0, 8)}`,
        type: 'integration' as const,
        status
      };
    });

    const ingressStatus: TradeBotConnectivityNode['status'] =
      scopedBots.some((bot) => Boolean(botLinks[bot.id]?.webhookUrl)) ? 'ok' : 'idle';

    return [
      {
        id: 'ingress',
        label: 'TradingView',
        type: 'source',
        status: ingressStatus
      },
      ...botNodes,
      ...integrationNodes
    ];
  }, [botLinks, scopedBots]);

  const connectivityLinks = useMemo<TradeBotConnectivityLink[]>(() => {
    const links: TradeBotConnectivityLink[] = [];
    scopedBots.forEach((bot) => {
      const link = botLinks[bot.id];
      if (!link) return;
      const status = toConnectivityState(botConnectivityStatus(bot, link));
      const botNodeId = `bot:${bot.id}`;

      if (link.webhookUrl) {
        links.push({
          id: `ingress-${bot.id}`,
          from: 'ingress',
          to: botNodeId,
          status
        });
      }

      if (link.integrationId) {
        links.push({
          id: `${bot.id}-${link.integrationId}`,
          from: botNodeId,
          to: `integration:${link.integrationId}`,
          status,
          alertsLastWindow: Number(bot.counts?.orders || 0)
        });
      }
    });
    return links;
  }, [botLinks, scopedBots]);

  const connectedCount = connectivityNodes.filter((node) => node.type === 'bot' && node.status === 'ok').length;

  const treeLayout = useMemo(() => {
    const ingress = connectivityNodes.find((node) => node.type === 'source' || node.id === 'ingress');
    const botGroup = connectivityNodes.filter((node) => node.type === 'bot');
    const integrationsGroup = connectivityNodes.filter((node) => node.type === 'integration');

    const rootLabel = 'DAX Links Server';
    const rootLabelLines = ['DAX', 'Links', 'Server'];
    const rootStatus = aggregateConnectivityStatus(connectivityNodes);
    const rootWidth = 90;
    const rootHeight = 90;
    const root = {
      id: 'root',
      label: rootLabel,
      labelLines: rootLabelLines,
      status: rootStatus,
      x: 60,
      y: 260,
      width: rootWidth,
      height: rootHeight,
      anchorX: 60 + rootWidth,
      anchorY: 260
    };

    const groups = [
      {
        id: 'group:tradingview',
        label: ingress?.label || 'TradingView',
        status: ingress?.status || 'idle',
        items: []
      },
      {
        id: 'group:bots',
        label: 'Trade Bots',
        status: aggregateConnectivityStatus(botGroup),
        items: botGroup
      },
      {
        id: 'group:integrations',
        label: 'Integrations',
        status: aggregateConnectivityStatus(integrationsGroup),
        items: integrationsGroup
      }
    ].filter((group) => group.items.length > 0 || group.id === 'group:tradingview');

    const startY = 100;
    const endY = 420;
    const gapY = groups.length > 1 ? (endY - startY) / (groups.length - 1) : 0;
    const groupX = 320;
    const bracketX = 520;
    const itemX = 545;
    const itemGap = 26;

    const branches: Array<any> = [];
    const stems: Array<any> = [];
    const brackets: Array<any> = [];
    const items: Array<any> = [];
    const groupLabels: Array<any> = [];

    groups.forEach((group, idx) => {
      const y = startY + idx * gapY;
      const labelWidth = Math.max(80, group.label.length * 7);
      const label = {
        ...group,
        x: groupX,
        y,
        width: labelWidth,
        tone: connectivityTone(group.status)
      };
      groupLabels.push(label);

      const branchStart = { x: root.anchorX, y: root.anchorY };
      const branchEndX = groupX - 16;
      const branchPath = `M ${root.anchorX} ${root.anchorY} L ${branchEndX} ${y}`;
      branches.push({
        id: `${root.id}-${group.id}`,
        path: branchPath,
        tone: label.tone,
        start: branchStart,
        end: { x: branchEndX, y }
      });

      if (group.items.length) {
        const maxListHeight = 180;
        const spacing = group.items.length > 1 ? Math.min(itemGap, maxListHeight / (group.items.length - 1)) : 0;
        const listTop = y - ((group.items.length - 1) * spacing) / 2;
        const listItems = group.items.map((item: any, itemIdx: number) => ({
          id: item.id,
          label: `[${item.label || item.id}]`,
          x: itemX,
          y: listTop + itemIdx * spacing,
          tone: connectivityTone(item.status)
        }));
        items.push(...listItems);

        const bracketTop = listItems[0].y - 10;
        const bracketBottom = listItems[listItems.length - 1].y + 10;
        const bracketPath = `M ${bracketX + 10} ${bracketTop} L ${bracketX} ${bracketTop} L ${bracketX} ${bracketBottom} L ${bracketX + 10} ${bracketBottom}`;
        brackets.push({ id: `${group.id}-bracket`, path: bracketPath, tone: label.tone });

        const stemStartX = groupX + labelWidth + 14;
        const midY = (bracketTop + bracketBottom) / 2;
        const stemPath = `M ${stemStartX} ${y} L ${bracketX} ${midY}`;
        stems.push({
          id: `${group.id}-stem`,
          path: stemPath,
          tone: label.tone,
          start: { x: stemStartX, y },
          end: { x: bracketX, y: midY }
        });
      }
    });

    return {
      root,
      groupLabels,
      branches,
      stems,
      brackets,
      items
    };
  }, [connectivityNodes]);

  const linkLayout = useMemo(() => {
    const map = new Map(connectivityNodes.map((node) => [node.id, node]));
    return connectivityLinks
      .map((link) => {
        const from = map.get(link.from);
        const to = map.get(link.to);
        return {
          ...link,
          from,
          to,
          tone: connectivityTone(link.status)
        };
      })
      .filter(Boolean) as Array<
      TradeBotConnectivityLink & {
        from: TradeBotConnectivityNode | undefined;
        to: TradeBotConnectivityNode | undefined;
        tone: string;
      }
    >;
  }, [connectivityLinks, connectivityNodes]);

  return (
    <div className="card-shell space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Connectivity Map</p>
          <p className="text-sm muted-text">
            Live metro view of signal flow and link health. {connectedCount} linked bot(s).
          </p>
        </div>
      </div>

      {connectivityNodes.length === 0 && <p className="text-sm text-gray-400">Connectivity unavailable.</p>}

      {connectivityNodes.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
          <div className="connectivity-shell">
            <svg className="connectivity-svg connectivity-tree" viewBox="0 0 900 520" aria-label="Connectivity diagram">
              <g className="connectivity-branches">
                {treeLayout.branches.map((branch: any) => (
                  <g key={branch.id}>
                    <path className="connectivity-branch" d={branch.path} stroke={branch.tone} strokeWidth={3} fill="none" />
                    <circle className="connectivity-endpoint" cx={branch.start.x} cy={branch.start.y} r={4} fill={branch.tone} />
                    <circle className="connectivity-endpoint" cx={branch.end.x} cy={branch.end.y} r={4} fill={branch.tone} />
                  </g>
                ))}
              </g>
              <g className="connectivity-stems">
                {treeLayout.stems.map((stem: any) => (
                  <g key={stem.id}>
                    <path className="connectivity-stem" d={stem.path} stroke={stem.tone} strokeWidth={2} fill="none" />
                    <circle className="connectivity-endpoint" cx={stem.start.x} cy={stem.start.y} r={3} fill={stem.tone} />
                    <circle className="connectivity-endpoint" cx={stem.end.x} cy={stem.end.y} r={3} fill={stem.tone} />
                  </g>
                ))}
              </g>
              <g className="connectivity-brackets">
                {treeLayout.brackets.map((bracket: any) => (
                  <path key={bracket.id} className="connectivity-bracket" d={bracket.path} stroke={bracket.tone} strokeWidth={2} fill="none" />
                ))}
              </g>
              <g className="connectivity-root">
                <rect
                  className="connectivity-root-box"
                  x={treeLayout.root.x}
                  y={treeLayout.root.y - treeLayout.root.height / 2}
                  width={treeLayout.root.width}
                  height={treeLayout.root.height}
                  rx={10}
                />
                <rect
                  className="connectivity-root-tab"
                  x={treeLayout.root.x}
                  y={treeLayout.root.y + treeLayout.root.height / 2 + 6}
                  width={treeLayout.root.width}
                  height={24}
                  rx={8}
                />
                <circle
                  className="connectivity-led"
                  cx={treeLayout.root.x + 12}
                  cy={treeLayout.root.y - treeLayout.root.height / 2 + 12}
                  r={4}
                  fill={connectivityTone(treeLayout.root.status)}
                />
                <text className="connectivity-root-label" x={treeLayout.root.x + treeLayout.root.width / 2} y={treeLayout.root.y - 8} textAnchor="middle">
                  {(treeLayout.root.labelLines || [treeLayout.root.label]).map((line: string, idx: number) => (
                    <tspan key={line} x={treeLayout.root.x + treeLayout.root.width / 2} dy={idx === 0 ? 0 : 14}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <g
                  className="connectivity-root-icons"
                  transform={`translate(${treeLayout.root.x + treeLayout.root.width - 32}, ${treeLayout.root.y + treeLayout.root.height / 2 + 10})`}
                >
                  <g transform="scale(0.42)">
                    <path
                      d="M12 2l7 3v6c0 5-3.5 9-7 11-3.5-2-7-6-7-11V5l7-3z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </g>
                  <g transform="translate(12, 0) scale(0.42)">
                    <path d="M7 11V8a5 5 0 0110 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    <rect x="6" y="11" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </g>
                </g>
              </g>
              <g className="connectivity-groups">
                {treeLayout.groupLabels.map((group: any) => (
                  <g key={group.id}>
                    <circle className="connectivity-dot" cx={group.x - 10} cy={group.y} r={4} fill={group.tone} />
                    <text className="connectivity-group-label" x={group.x} y={group.y + 4} fill={group.tone}>
                      {group.label}
                    </text>
                  </g>
                ))}
              </g>
              <g className="connectivity-items">
                {treeLayout.items.map((item: any) => (
                  <g key={item.id}>
                    <circle className="connectivity-dot" cx={item.x - 10} cy={item.y} r={3} fill={item.tone} />
                    <text className="connectivity-item-label" x={item.x} y={item.y + 4} fill={item.tone}>
                      {item.label}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
          <aside className="connectivity-panel">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Link details</p>
            <p className="text-xs text-gray-400">Derived from linked webhook/integration pairs.</p>
            <div className="mt-3 space-y-3">
              {linkLayout.map((link, idx) => (
                <div key={`panel-${link.id || idx}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {link.from?.label || link.from?.id} → {link.to?.label || link.to?.id}
                    </span>
                    <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]" style={{ color: link.tone }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: link.tone }}></span>
                      {link.status || 'unknown'}
                    </span>
                  </div>
                  {link.alertsLastWindow != null && (
                    <p className="text-xs text-gray-400">Orders (summary): {link.alertsLastWindow}</p>
                  )}
                </div>
              ))}
              {linkLayout.length === 0 && <p className="text-xs text-gray-400">No link details yet. Link TradingView and exchange integrations in bot settings.</p>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto text-right">
        <p className="text-2xl font-semibold text-main">{value}</p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 mt-1">{helper}</p>
      </div>
    </div>
  );
}

function StatusToggleCard({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto flex items-center justify-between">
        <p className="text-lg font-semibold text-main">{enabled ? 'Enabled' : 'Disabled'}</p>
        <label className="relative inline-flex h-6 w-12 cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={enabled} onChange={onToggle} />
          <span className="absolute inset-0 rounded-full bg-white/10 peer-checked:bg-emerald-400/60 transition"></span>
          <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/80 transition peer-checked:translate-x-6 peer-checked:bg-emerald-100"></span>
        </label>
      </div>
    </div>
  );
}

function StatCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-2 text-sm font-mono text-gray-100 break-all' : 'mt-2 text-xl font-semibold text-white'}>{value}</p>
    </div>
  );
}

function InfoTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-1 font-mono text-[11px] text-gray-100' : 'mt-1 text-[11px] text-gray-100'}>{value}</p>
    </div>
  );
}
