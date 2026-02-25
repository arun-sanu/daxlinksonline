import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { prisma } from '../utils/prisma.js';
import { buildVersion, storagePathsForVersion } from '../builder/build.js';
import { getWorkspaceWorkflowConfig, saveWorkspaceWorkflowConfig } from './workflowService.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

const LANGUAGE_ALIASES = Object.freeze({
  python: 'python',
  py: 'python',
  golang: 'go',
  go: 'go',
  cpp: 'cpp',
  'c++': 'cpp',
  cxx: 'cpp',
  c: 'c',
  java: 'java'
});

export const SUPPORTED_BOT_LANGUAGES = Object.freeze(['python', 'go', 'cpp', 'c', 'java']);
export const SUPPORTED_INSTANCE_CONTROL_ACTIONS = Object.freeze(['start', 'resume', 'pause', 'stop', 'restart']);
export const SUPPORTED_BOT_CONTROL_ACTIONS = Object.freeze(['pause', 'resume', 'stop', 'restart', 'delete']);

function httpError(message, status = 500) {
  return Object.assign(new Error(message), { status });
}

function asPositiveInt(value, fallback = DEFAULT_LIST_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

function toPlainDecimal(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value?.toString === 'function') return value.toString();
  return String(value);
}

export function normalizeBotLanguage(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const normalized = LANGUAGE_ALIASES[raw];
  if (!normalized) {
    throw httpError(
      `Unsupported bot language "${value}". Supported languages: ${SUPPORTED_BOT_LANGUAGES.join(', ')}`,
      400
    );
  }
  return normalized;
}

export function parseVersionNotes(notes) {
  const raw = typeof notes === 'string' ? notes.trim() : '';
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Preserve old plain text notes.
  }
  return { userNotes: raw };
}

export function stringifyVersionNotes(meta = {}) {
  return JSON.stringify(meta);
}

function mergeVersionNotes(existing, patch = {}) {
  return stringifyVersionNotes({
    ...parseVersionNotes(existing),
    ...patch
  });
}

function createWorkflowNodeId(botId) {
  return `bot:${botId}`;
}

function normalizeRuntimeLink(value = null) {
  const links = value && typeof value === 'object' ? value : {};
  const webhookUrlRaw = links?.webhookUrl;
  const integrationIdRaw = links?.integrationId;
  const exchangeAccountIdRaw = links?.exchangeAccountId;

  const webhookUrl = webhookUrlRaw === null || webhookUrlRaw === undefined || webhookUrlRaw === ''
    ? null
    : String(webhookUrlRaw).trim();
  const integrationId = integrationIdRaw === null || integrationIdRaw === undefined || integrationIdRaw === ''
    ? null
    : String(integrationIdRaw).trim();
  const exchangeAccountId = exchangeAccountIdRaw === null || exchangeAccountIdRaw === undefined || exchangeAccountIdRaw === ''
    ? null
    : String(exchangeAccountIdRaw).trim();
  const updatedAt = links?.updatedAt ? String(links.updatedAt) : null;

  return {
    webhookUrl,
    integrationId,
    exchangeAccountId,
    updatedAt
  };
}

function normalizeRuntimeRules(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function asFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTakeProfitMode(value = null) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'trailing' || normalized === 'trail') return 'trailing';
  if (normalized === 'percent' || normalized === 'fixed') return normalized;
  return 'fixed';
}

function summarizeTakeProfitRules(rules = null) {
  const safeRules = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  const mode = normalizeTakeProfitMode(safeRules.tpType || safeRules.tp_type);
  const tpValue = asFiniteNumber(safeRules.tpValue ?? safeRules.tp_value);
  const trailingPct = asFiniteNumber(
    safeRules.trailingTpPct ??
    safeRules.trailing_tp_pct ??
    safeRules.trailingTakeProfitPct ??
    safeRules.trailing_take_profit_pct ??
    (mode === 'trailing' ? tpValue : null)
  );
  const trailingEnabledRaw =
    safeRules.trailingTakeProfitEnabled ??
    safeRules.trailing_take_profit_enabled ??
    safeRules.trailingTpEnabled;
  const trailingEnabled =
    trailingEnabledRaw === undefined || trailingEnabledRaw === null
      ? mode === 'trailing'
      : Boolean(trailingEnabledRaw);

  const valuePct = mode === 'trailing' ? trailingPct : tpValue;
  const label =
    mode === 'trailing'
      ? valuePct !== null
        ? `trailing (${valuePct}%)`
        : 'trailing'
      : valuePct !== null
        ? `${mode} (${valuePct}%)`
        : mode;

  return {
    mode,
    valuePct,
    trailingEnabled,
    label
  };
}

const MEXC_MACD_BOLLINGER_BOT_SLUGS = new Set([
  'mexc-macd-bollinger-bot',
  'mexc-macd-bollinger',
  'arn-hvms-mexc',
  'arn-hvms',
  'hvms-mexc'
]);
const ARN_PINE_FAITHFUL_BOT_SLUGS = new Set([
  'arn-s-shcs-orginal',
  'arn-s-shcs-original',
  'arn-bot-service-pine-faithful',
  'arn-pine-faithful',
  'moneyplantbot1-robot'
]);
const ARN_LIMIT_ONLY_BOT_SLUGS = new Set([
  'arn-s-shcs-limit-only',
  'arn-s-shcs-limitonly',
  'arn-bot-service-limit-only'
]);

function normalizeTextSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTradingSymbol(value, fallback = 'BTCUSDC') {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized || fallback;
}

function isMexcMacdBollingerBot(bot = null) {
  const slug = normalizeTextSlug(bot?.name || '');
  if (MEXC_MACD_BOLLINGER_BOT_SLUGS.has(slug)) return true;
  return slug.includes('mexc') && (slug.includes('bollinger') || slug.includes('hvms'));
}

function isArnLimitOnlyBot(bot = null) {
  const slug = normalizeTextSlug(bot?.name || '');
  if (!slug) return false;
  if (ARN_LIMIT_ONLY_BOT_SLUGS.has(slug)) return true;
  return slug.includes('arn') && slug.includes('shcs') && slug.includes('limit');
}

function isArnPineFaithfulBot(bot = null) {
  const slug = normalizeTextSlug(bot?.name || '');
  if (isArnLimitOnlyBot(bot)) return false;
  if (ARN_PINE_FAITHFUL_BOT_SLUGS.has(slug)) return true;
  return (
    slug.includes('arn') &&
    slug.includes('shcs') &&
    (slug.includes('orginal') || slug.includes('original') || slug.includes('faithful') || slug.includes('moneyplantbot1'))
  );
}

function buildMexcMacdBollingerDefaultRules({ symbol = 'BTCUSDC' } = {}) {
  const normalizedSymbol = normalizeTradingSymbol(symbol, 'BTCUSDC');
  const parameterSchema = [
    {
      key: 'symbol',
      label: 'Symbol',
      type: 'string',
      defaultValue: normalizedSymbol,
      source: 'template:mexc-macd-bollinger',
      description: 'Trading symbol used by the bot process.',
      line: null
    },
    {
      key: 'base_quantity',
      label: 'Base Quantity',
      type: 'number',
      defaultValue: 0.001,
      source: 'template:mexc-macd-bollinger',
      description: 'Fixed quantity per market order.',
      line: null
    },
    {
      key: 'check_interval',
      label: 'Check Interval',
      type: 'number',
      defaultValue: 60,
      source: 'template:mexc-macd-bollinger',
      description: 'Seconds between strategy evaluations.',
      line: null
    },
    {
      key: 'macd_fast',
      label: 'MACD Fast',
      type: 'number',
      defaultValue: 12,
      source: 'template:mexc-macd-bollinger',
      description: 'Fast EMA period for MACD.',
      line: null
    },
    {
      key: 'macd_slow',
      label: 'MACD Slow',
      type: 'number',
      defaultValue: 26,
      source: 'template:mexc-macd-bollinger',
      description: 'Slow EMA period for MACD.',
      line: null
    },
    {
      key: 'macd_signal',
      label: 'MACD Signal',
      type: 'number',
      defaultValue: 9,
      source: 'template:mexc-macd-bollinger',
      description: 'Signal EMA period for MACD.',
      line: null
    },
    {
      key: 'bb_length',
      label: 'BB Length',
      type: 'number',
      defaultValue: 20,
      source: 'template:mexc-macd-bollinger',
      description: 'Bollinger middle-band period.',
      line: null
    },
    {
      key: 'bb_mult',
      label: 'BB Multiplier',
      type: 'number',
      defaultValue: 2.0,
      source: 'template:mexc-macd-bollinger',
      description: 'Bollinger standard deviation multiplier.',
      line: null
    },
    {
      key: 'stop_loss_pct',
      label: 'Stop Loss %',
      type: 'number',
      defaultValue: 2.0,
      source: 'template:mexc-macd-bollinger',
      description: 'Stop loss percentage from entry.',
      line: null
    },
    {
      key: 'risk_reward',
      label: 'Risk Reward',
      type: 'number',
      defaultValue: 5,
      source: 'template:mexc-macd-bollinger',
      description: 'Take profit multiple of stop distance.',
      line: null
    },
    {
      key: 'allow_shorts',
      label: 'Allow Shorts',
      type: 'boolean',
      defaultValue: false,
      source: 'template:mexc-macd-bollinger',
      description: 'Enable short entries where supported.',
      line: null
    }
  ];

  return {
    strategy: 'MACD_Bollinger',
    source: 'python_bot',
    exchange: 'MEXC',
    symbol: normalizedSymbol,
    baseQuantity: 0.001,
    checkInterval: 60,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    bbLength: 20,
    bbMult: 2.0,
    stopLossPct: 2.0,
    riskReward: 5,
    allowShorts: false,
    sellCompoundingEnabled: true,
    sellCompoundingMode: 'full_balance',
    sellCompoundingPct: 100,
    sellTargetSpendPct: 91.05,
    sellLadderEnabled: true,
    sellLadderStrengthPct: 100,
    sellLadderMinFactor: 0.1,
    sellLadderMaxFactor: 2,
    resolveExchangeFromBackend: true,
    runtimeConfigPath: '/api/v1/internal/bot/runtime-config',
    codeParameterSchema: parameterSchema,
    codeParameters: {
      symbol: normalizedSymbol,
      base_quantity: 0.001,
      check_interval: 60,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      bb_length: 20,
      bb_mult: 2.0,
      stop_loss_pct: 2.0,
      risk_reward: 5,
      allow_shorts: false
    }
  };
}

function buildArnPineFaithfulDefaultRules({ symbol = 'BTCUSDT' } = {}) {
  const normalizedSymbol = normalizeTradingSymbol(symbol, 'BTCUSDT');
  const parameterSchema = [
    {
      key: 'symbol',
      label: 'Symbol',
      type: 'string',
      defaultValue: normalizedSymbol,
      source: 'template:arn-pine-faithful',
      description: 'Trading symbol used by the ARN Pine-faithful service.',
      line: null
    },
    {
      key: 'leverage',
      label: 'Leverage',
      type: 'number',
      defaultValue: 1.0,
      source: 'template:arn-pine-faithful',
      description: 'Leverage multiplier applied to computed order size.',
      line: null
    },
    {
      key: 'tp_percent',
      label: 'TP Percent',
      type: 'number',
      defaultValue: 1.0,
      source: 'template:arn-pine-faithful',
      description: 'Take-profit percent from entry price.',
      line: null
    },
    {
      key: 'sl_atr_multiplier',
      label: 'SL ATR Multiplier',
      type: 'number',
      defaultValue: 1.5,
      source: 'template:arn-pine-faithful',
      description: 'ATR multiplier used for stop-loss calculation.',
      line: null
    },
    {
      key: 'investment_percentage',
      label: 'Investment %',
      type: 'number',
      defaultValue: 90.0,
      source: 'template:arn-pine-faithful',
      description: 'Portfolio allocation percentage used per entry signal.',
      line: null
    },
    {
      key: 'daily_loss_limit',
      label: 'Daily Loss Limit %',
      type: 'number',
      defaultValue: 5.0,
      source: 'template:arn-pine-faithful',
      description: 'Loss threshold that triggers close-all protection.',
      line: null
    },
    {
      key: 'cooldown_candles',
      label: 'Cooldown Candles',
      type: 'number',
      defaultValue: 2,
      source: 'template:arn-pine-faithful',
      description: 'Number of candles to wait before accepting new entries.',
      line: null
    },
    {
      key: 'rsi_length',
      label: 'RSI Length',
      type: 'number',
      defaultValue: 14,
      source: 'template:arn-pine-faithful',
      description: 'RSI period used in entry crossover logic.',
      line: null
    },
    {
      key: 'bb_length',
      label: 'Bollinger Length',
      type: 'number',
      defaultValue: 20,
      source: 'template:arn-pine-faithful',
      description: 'Bollinger Bands basis length.',
      line: null
    },
    {
      key: 'bb_mult',
      label: 'Bollinger Multiplier',
      type: 'number',
      defaultValue: 2.0,
      source: 'template:arn-pine-faithful',
      description: 'Bollinger Bands deviation multiplier.',
      line: null
    },
    {
      key: 'volatility_threshold',
      label: 'Volatility Threshold %',
      type: 'number',
      defaultValue: 0.05,
      source: 'template:arn-pine-faithful',
      description: 'Percent threshold used to detect volatility spikes.',
      line: null
    },
    {
      key: 'action',
      label: 'Action',
      type: 'string',
      defaultValue: 'ENTRY',
      source: 'template:arn-pine-faithful',
      description: 'Default signal action when composing test payloads.',
      line: null
    },
    {
      key: 'direction',
      label: 'Direction',
      type: 'string',
      defaultValue: 'LONG',
      source: 'template:arn-pine-faithful',
      description: 'Default signal direction when composing test payloads.',
      line: null
    },
    {
      key: 'volatility_spike',
      label: 'Volatility Spike',
      type: 'boolean',
      defaultValue: false,
      source: 'template:arn-pine-faithful',
      description: 'When true, stop-loss placement is skipped to mirror Pine logic.',
      line: null
    },
    {
      key: 'timezone',
      label: 'Timezone',
      type: 'string',
      defaultValue: 'Asia/Kolkata',
      source: 'template:arn-pine-faithful',
      description: 'Timezone used for end-of-day close behavior.',
      line: null
    }
  ];

  return {
    strategy: 'ARN_PINE_FAITHFUL',
    source: 'python_bot',
    exchange: 'MEXC',
    symbol: normalizedSymbol,
    leverage: 1.0,
    tpPercent: 1.0,
    slAtrMultiplier: 1.5,
    investmentPercentage: 90.0,
    dailyLossLimit: 5.0,
    cooldownCandles: 2,
    rsiLength: 14,
    bbLength: 20,
    bbMult: 2.0,
    volatilityThreshold: 0.05,
    action: 'ENTRY',
    direction: 'LONG',
    volatilitySpike: false,
    timezone: 'Asia/Kolkata',
    resolveExchangeFromBackend: true,
    runtimeConfigPath: '/api/v1/internal/bot/runtime-config',
    signalPath: '/signal',
    codeParameterSchema: parameterSchema,
    codeParameters: {
      symbol: normalizedSymbol,
      leverage: 1.0,
      tp_percent: 1.0,
      sl_atr_multiplier: 1.5,
      investment_percentage: 90.0,
      daily_loss_limit: 5.0,
      cooldown_candles: 2,
      rsi_length: 14,
      bb_length: 20,
      bb_mult: 2.0,
      volatility_threshold: 0.05,
      action: 'ENTRY',
      direction: 'LONG',
      volatility_spike: false,
      timezone: 'Asia/Kolkata'
    }
  };
}

function buildArnLimitOnlyDefaultRules({ symbol = 'BTCUSDC' } = {}) {
  const normalizedSymbol = normalizeTradingSymbol(symbol, 'BTCUSDC');
  const parameterSchema = [
    {
      key: 'symbol_default',
      label: 'Symbol',
      type: 'string',
      defaultValue: normalizedSymbol,
      source: 'template:arn-limit-only',
      description: 'Default symbol used when alert payload omits symbol.',
      line: null
    },
    {
      key: 'min_quote_qty',
      label: 'Min Quote Qty',
      type: 'number',
      defaultValue: 1.05,
      source: 'template:arn-limit-only',
      description: 'Minimum quote amount per entry order.',
      line: null
    },
    {
      key: 'leverage',
      label: 'Leverage',
      type: 'number',
      defaultValue: 1.0,
      source: 'template:arn-limit-only',
      description: 'Reference leverage from Pine payload/backtest sizing.',
      line: null
    },
    {
      key: 'investment_percentage',
      label: 'Reinvestment %',
      type: 'number',
      defaultValue: 48.98,
      source: 'template:arn-limit-only',
      description: 'Exchange-balance sizing percentage used by ARN limit-only execution.',
      line: null
    },
    {
      key: 'daily_loss_limit',
      label: 'Daily Loss Limit %',
      type: 'number',
      defaultValue: 5.0,
      source: 'template:arn-limit-only',
      description: 'Stop trading for day when equity drawdown exceeds this percentage.',
      line: null
    },
    {
      key: 'cooldown_candles',
      label: 'Cooldown Candles',
      type: 'number',
      defaultValue: 2,
      source: 'template:arn-limit-only',
      description: 'TradingView-side cooldown bars after a trade signal.',
      line: null
    },
    {
      key: 'cooldown_seconds',
      label: 'Cooldown Seconds',
      type: 'number',
      defaultValue: 120,
      source: 'template:arn-limit-only',
      description: 'Minimum delay between filled entries.',
      line: null
    },
    {
      key: 'entry_ttl_seconds',
      label: 'Entry TTL',
      type: 'number',
      defaultValue: 20,
      source: 'template:arn-limit-only',
      description: 'Seconds to wait for each limit entry attempt.',
      line: null
    },
    {
      key: 'ladder_steps',
      label: 'Ladder Steps',
      type: 'number',
      defaultValue: 3,
      source: 'template:arn-limit-only',
      description: 'Number of limit retry steps per signal.',
      line: null
    },
    {
      key: 'ladder_step_bps',
      label: 'Ladder Step Bps',
      type: 'number',
      defaultValue: 3,
      source: 'template:arn-limit-only',
      description: 'Price adjustment per retry step in basis points.',
      line: null
    },
    {
      key: 'limit_style',
      label: 'Limit Style',
      type: 'string',
      defaultValue: 'MID',
      source: 'template:arn-limit-only',
      description: 'TradingView limit reference style (MID/BID/ASK/CLOSE).',
      line: null
    },
    {
      key: 'order_type',
      label: 'Order Type',
      type: 'string',
      defaultValue: 'LIMIT',
      source: 'template:arn-limit-only',
      description: 'Entry order type: LIMIT or LIMIT_MAKER (post-only).',
      line: null
    },
    {
      key: 'slippage_bps',
      label: 'Slippage Bps',
      type: 'number',
      defaultValue: 5,
      source: 'template:arn-limit-only',
      description: 'TradingView-side limit offset in basis points.',
      line: null
    },
    {
      key: 'rsi_length',
      label: 'RSI Length',
      type: 'number',
      defaultValue: 14,
      source: 'template:arn-limit-only',
      description: 'TradingView RSI period used by entry logic.',
      line: null
    },
    {
      key: 'bb_length',
      label: 'Bollinger Length',
      type: 'number',
      defaultValue: 20,
      source: 'template:arn-limit-only',
      description: 'TradingView Bollinger basis length.',
      line: null
    },
    {
      key: 'bb_mult',
      label: 'Bollinger Multiplier',
      type: 'number',
      defaultValue: 2.0,
      source: 'template:arn-limit-only',
      description: 'TradingView Bollinger deviation multiplier.',
      line: null
    },
    {
      key: 'volatility_threshold',
      label: 'Volatility Threshold %',
      type: 'number',
      defaultValue: 0.05,
      source: 'template:arn-limit-only',
      description: 'TradingView volatility spike threshold percentage.',
      line: null
    },
    {
      key: 'tp_percent',
      label: 'TP Percent',
      type: 'number',
      defaultValue: 1.0,
      source: 'template:arn-limit-only',
      description: 'Take-profit percentage from entry.',
      line: null
    },
    {
      key: 'sl_atr_multiplier',
      label: 'SL ATR Multiplier',
      type: 'number',
      defaultValue: 1.5,
      source: 'template:arn-limit-only',
      description: 'ATR multiplier used for stop-loss placement.',
      line: null
    },
    {
      key: 'timezone',
      label: 'Timezone',
      type: 'string',
      defaultValue: 'Asia/Kolkata',
      source: 'template:arn-limit-only',
      description: 'Reference timezone for end-of-day behavior in Pine.',
      line: null
    }
  ];

  return {
    strategy: 'ARN_LIMIT_ONLY',
    source: 'python_bot',
    exchange: 'MEXC',
    symbol: normalizedSymbol,
    leverage: 1.0,
    investmentPercentage: 48.98,
    minQuoteQty: 1.05,
    dailyLossLimitPct: 5.0,
    dailyLossLimit: 5.0,
    cooldownCandles: 2,
    cooldownSeconds: 120,
    entryTtlSeconds: 20,
    ladderSteps: 3,
    ladderStepBps: 3,
    limitStyle: 'MID',
    orderType: 'LIMIT',
    slippageBps: 5,
    rsiLength: 14,
    bbLength: 20,
    bbMult: 2.0,
    volatilityThreshold: 0.05,
    tpPercent: 1.0,
    slAtrMultiplier: 1.5,
    timezone: 'Asia/Kolkata',
    resolveExchangeFromBackend: true,
    runtimeConfigPath: '/api/v1/internal/bot/runtime-config',
    signalPath: '/webhook',
    codeParameterSchema: parameterSchema,
    codeParameters: {
      symbol_default: normalizedSymbol,
      min_quote_qty: 1.05,
      leverage: 1.0,
      investment_percentage: 48.98,
      daily_loss_limit: 5.0,
      cooldown_candles: 2,
      cooldown_seconds: 120,
      entry_ttl_seconds: 20,
      ladder_steps: 3,
      ladder_step_bps: 3,
      limit_style: 'MID',
      order_type: 'LIMIT',
      slippage_bps: 5,
      rsi_length: 14,
      bb_length: 20,
      bb_mult: 2.0,
      volatility_threshold: 0.05,
      tp_percent: 1.0,
      sl_atr_multiplier: 1.5,
      timezone: 'Asia/Kolkata'
    }
  };
}

function getDefaultRuntimeRulesForBot(bot = null, { symbol = null } = {}) {
  if (!bot) return null;
  if (isArnLimitOnlyBot(bot)) {
    return buildArnLimitOnlyDefaultRules({ symbol: symbol || bot?.symbol || 'BTCUSDC' });
  }
  if (isArnPineFaithfulBot(bot)) {
    return buildArnPineFaithfulDefaultRules({ symbol: symbol || bot?.symbol || 'BTCUSDT' });
  }
  if (isMexcMacdBollingerBot(bot)) {
    return buildMexcMacdBollingerDefaultRules({ symbol: symbol || bot?.symbol || 'BTCUSDC' });
  }
  return null;
}

function mergeRuntimeRulesWithDefaults(defaultRules = null, currentRules = null) {
  const defaults = normalizeRuntimeRules(defaultRules);
  const current = normalizeRuntimeRules(currentRules);
  if (!defaults) return current;
  if (!current) return defaults;

  const merged = {
    ...defaults,
    ...current
  };

  const defaultSchema = Array.isArray(defaults.codeParameterSchema)
    ? sanitizeCodeParameterSchema(defaults.codeParameterSchema)
    : [];
  const defaultParamKeys = new Set(defaultSchema.map((item) => item.key));

  const defaultParams =
    defaults.codeParameters && typeof defaults.codeParameters === 'object' && !Array.isArray(defaults.codeParameters)
      ? defaults.codeParameters
      : {};
  const currentParams =
    current.codeParameters && typeof current.codeParameters === 'object' && !Array.isArray(current.codeParameters)
      ? current.codeParameters
      : {};

  const filteredCurrentParams = defaultParamKeys.size
    ? Object.fromEntries(Object.entries(currentParams).filter(([key]) => defaultParamKeys.has(String(key))))
    : currentParams;

  merged.codeParameters = {
    ...defaultParams,
    ...filteredCurrentParams
  };

  if (defaultSchema.length) {
    merged.codeParameterSchema = defaultSchema;
    if (!defaults.codeSource) {
      merged.codeSource = null;
    }
  } else if (!Array.isArray(current.codeParameterSchema) && Array.isArray(defaults.codeParameterSchema)) {
    merged.codeParameterSchema = defaults.codeParameterSchema;
  }

  return merged;
}

const CODE_PARAMETER_TYPE_SET = new Set(['number', 'string', 'boolean']);
const CODE_PARAMETER_EXCLUDED_KEYS = new Set([
  'SPEC',
  'PRICE',
  'TICKS',
  'EXIT',
  'STORE',
  'EX',
  'BOT',
  'APP',
  'WS_URL'
]);
const MAX_CODE_PARAMETER_COUNT = Number(process.env.BOT_CODE_PARAMETER_LIMIT || 200);
const MAX_CODE_SOURCE_LENGTH = Number(process.env.BOT_CODE_SOURCE_MAX_CHARS || 250000);

function toParameterLabel(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isValidParameterKey(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''));
}

function trimCodeSource(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, MAX_CODE_SOURCE_LENGTH);
}

function looksLikePythonSource(sourceCode = '') {
  const sample = String(sourceCode || '')
    .slice(0, 8000)
    .trim();
  if (!sample) return false;
  return /(from\s+\w+\s+import|import\s+\w+|class\s+\w+|def\s+\w+\s*\(|@dataclass|if\s+__name__\s*==\s*['"]__main__['"])/.test(sample);
}

function readPythonSourceFromZip(zipPath, preferredFilename = null) {
  const script = `
import os
import sys
import zipfile

zip_path = sys.argv[1]
preferred = os.path.basename(sys.argv[2] or '').strip().lower()
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 250000

def pick_target(names):
    ranked = []
    for name in names:
        lower = name.lower()
        base = os.path.basename(lower)
        depth = lower.count('/')
        score = 1000 - (depth * 10) - len(lower)
        if preferred and base == preferred:
            score += 5000
        if base in ('main.py', 'bot.py', 'app.py', 'runner.py'):
            score += 900
        if 'test' in base:
            score -= 600
        ranked.append((score, name))
    ranked.sort(key=lambda row: row[0], reverse=True)
    return ranked[0][1] if ranked else None

try:
    with zipfile.ZipFile(zip_path, 'r') as zf:
        names = [
            name for name in zf.namelist()
            if name
            and not name.endswith('/')
            and name.lower().endswith('.py')
            and '__macosx/' not in name.lower()
        ]
        target = pick_target(names)
        if not target:
            print('')
            raise SystemExit(0)
        text = zf.read(target).decode('utf-8', 'ignore')
        print(text[:limit])
except Exception:
    print('')
`;

  const args = ['-c', script, zipPath, preferredFilename || '', String(MAX_CODE_SOURCE_LENGTH)];
  const options = {
    encoding: 'utf8',
    maxBuffer: Math.max(1024 * 1024, MAX_CODE_SOURCE_LENGTH * 3)
  };
  const py3 = spawnSync('python3', args, options);
  const runner = py3.status === 0 ? py3 : spawnSync('python', args, options);
  if (runner.status !== 0) return '';
  return trimCodeSource(runner.stdout || '');
}

function extractPythonSourceFromVersionArtifact(versionId, preferredFilename = null) {
  const resolvedVersionId = String(versionId || '').trim();
  if (!resolvedVersionId) return '';
  const { zipPath } = storagePathsForVersion(resolvedVersionId);
  if (!zipPath || !fs.existsSync(zipPath)) return '';

  let isZip = false;
  try {
    const fd = fs.openSync(zipPath, 'r');
    const sig = Buffer.alloc(4);
    fs.readSync(fd, sig, 0, 4, 0);
    fs.closeSync(fd);
    isZip = sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 0x03 && sig[3] === 0x04;
  } catch {
    isZip = false;
  }

  if (!isZip) {
    try {
      const text = trimCodeSource(fs.readFileSync(zipPath, 'utf8'));
      return looksLikePythonSource(text) ? text : '';
    } catch {
      return '';
    }
  }

  const source = readPythonSourceFromZip(zipPath, preferredFilename);
  return looksLikePythonSource(source) ? source : '';
}

function resolveFallbackCodeSourceForBot(bot = null) {
  if (!bot || !bot.latestVersionId) return '';
  const notes = parseVersionNotes(bot?.latestVersion?.notes || '');
  const originalFilename = String(notes?.originalFilename || '').trim();
  const preferredFilename = originalFilename.toLowerCase().endsWith('.py')
    ? path.basename(originalFilename)
    : null;
  return extractPythonSourceFromVersionArtifact(bot.latestVersionId, preferredFilename);
}

function hydrateRuntimeRulesWithCodeSource(rules = null, bot = null) {
  const normalized = rules && typeof rules === 'object' && !Array.isArray(rules) ? { ...rules } : {};
  if (trimCodeSource(normalized.codeSource || '')) return normalized;
  const fallbackCode = resolveFallbackCodeSourceForBot(bot);
  if (fallbackCode) {
    normalized.codeSource = fallbackCode;
  }
  return normalized;
}

function splitPythonValueAndComment(rawValue = '') {
  const input = String(rawValue || '');
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      return {
        value: input.slice(0, i).trim(),
        comment: input.slice(i + 1).trim() || null
      };
    }
  }

  return { value: input.trim(), comment: null };
}

function parsePythonLiteral(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  if (value === 'True') return { type: 'boolean', value: true };
  if (value === 'False') return { type: 'boolean', value: false };

  if (/^-?\d[\d_]*$/.test(value)) {
    const n = Number(value.replace(/_/g, ''));
    if (Number.isFinite(n)) return { type: 'number', value: n };
  }
  if (/^-?\d[\d_]*\.\d[\d_]*$/.test(value)) {
    const n = Number(value.replace(/_/g, ''));
    if (Number.isFinite(n)) return { type: 'number', value: n };
  }

  const quoted = value.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) {
    const unescaped = quoted[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
    return { type: 'string', value: unescaped };
  }

  return null;
}

function sanitizeCodeParameterSchema(value = null) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const key = String(row.key || '').trim();
    if (!isValidParameterKey(key) || seen.has(key)) continue;
    const type = String(row.type || '').trim().toLowerCase();
    if (!CODE_PARAMETER_TYPE_SET.has(type)) continue;
    const defaultValue = row.defaultValue;
    if (
      (type === 'number' && typeof defaultValue !== 'number') ||
      (type === 'string' && typeof defaultValue !== 'string') ||
      (type === 'boolean' && typeof defaultValue !== 'boolean')
    ) {
      continue;
    }
    seen.add(key);
    out.push({
      key,
      label: String(row.label || toParameterLabel(key)),
      type,
      defaultValue,
      source: row.source ? String(row.source) : null,
      description: row.description ? String(row.description) : null,
      line: Number.isFinite(Number(row.line)) ? Number(row.line) : null
    });
    if (out.length >= MAX_CODE_PARAMETER_COUNT) break;
  }
  return out;
}

function normalizeCodeParameterValue(value, type, fallback) {
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = String(value || '')
      .trim()
      .toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    return fallback;
  }
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeCodeParameterValues(value = null, schema = []) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  schema.forEach((item) => {
    normalized[item.key] = normalizeCodeParameterValue(input[item.key], item.type, item.defaultValue);
  });
  return normalized;
}

function extractPythonCodeParameterSchema(sourceCode = '') {
  const source = trimCodeSource(sourceCode);
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  const out = [];
  const seen = new Set();

  const addItem = ({ key, type, defaultValue, sourceLabel, description = null, line }) => {
    if (!isValidParameterKey(key) || seen.has(key) || CODE_PARAMETER_EXCLUDED_KEYS.has(key)) return;
    if (!CODE_PARAMETER_TYPE_SET.has(type)) return;
    seen.add(key);
    out.push({
      key,
      label: toParameterLabel(key),
      type,
      defaultValue,
      source: sourceLabel,
      description,
      line
    });
  };

  let pendingDataclass = false;
  let inDataclass = false;
  let dataclassIndent = 0;
  let dataclassName = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    const classMatch = line.match(/^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/);
    if (pendingDataclass && classMatch) {
      pendingDataclass = false;
      inDataclass = true;
      dataclassIndent = classMatch[1].length;
      dataclassName = classMatch[2];
      continue;
    }
    if (trimmed.startsWith('@dataclass')) {
      pendingDataclass = true;
      continue;
    }
    if (pendingDataclass && trimmed && !trimmed.startsWith('#')) {
      pendingDataclass = false;
    }

    const currentIndent = line.match(/^\s*/)?.[0]?.length || 0;
    if (inDataclass && currentIndent <= dataclassIndent && !trimmed.startsWith('#') && !trimmed.startsWith('@')) {
      inDataclass = false;
      dataclassName = '';
    }

    if (inDataclass) {
      const fieldMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+=\s*(.+)$/);
      if (fieldMatch) {
        const key = fieldMatch[1];
        const split = splitPythonValueAndComment(fieldMatch[2]);
        const literal = parsePythonLiteral(split.value);
        if (literal) {
          addItem({
            key,
            type: literal.type,
            defaultValue: literal.value,
            sourceLabel: `dataclass:${dataclassName || 'unknown'}`,
            description: split.comment,
            line: index + 1
          });
        }
      }
      if (out.length >= MAX_CODE_PARAMETER_COUNT) break;
      continue;
    }

    const constMatch = line.match(/^([A-Z][A-Z0-9_]{2,})\s*(?::\s*[^=]+)?=\s*(.+)$/);
    if (constMatch) {
      const key = constMatch[1];
      const split = splitPythonValueAndComment(constMatch[2]);
      const literal = parsePythonLiteral(split.value);
      if (literal) {
        addItem({
          key,
          type: literal.type,
          defaultValue: literal.value,
          sourceLabel: 'constant',
          description: split.comment,
          line: index + 1
        });
      }
    }
    if (out.length >= MAX_CODE_PARAMETER_COUNT) break;
  }

  return out;
}

function resolveRuntimeCodeParameters(rules = null) {
  const normalized = rules && typeof rules === 'object' && !Array.isArray(rules) ? { ...rules } : {};
  const sourceCode = trimCodeSource(normalized.codeSource || '');
  const derivedSchema = sourceCode ? extractPythonCodeParameterSchema(sourceCode) : [];
  const fallbackSchema = sanitizeCodeParameterSchema(normalized.codeParameterSchema || []);
  const schema = derivedSchema.length ? derivedSchema : fallbackSchema;
  const values = normalizeCodeParameterValues(normalized.codeParameters || {}, schema);
  const updatedAt = normalized.codeParametersUpdatedAt ? String(normalized.codeParametersUpdatedAt) : null;

  if (sourceCode) normalized.codeSource = sourceCode;
  if (schema.length) normalized.codeParameterSchema = schema;
  normalized.codeParameters = values;
  normalized.codeParametersUpdatedAt = updatedAt;

  return {
    rules: normalized,
    parameters: {
      source: sourceCode ? 'code' : schema.length ? 'stored' : 'none',
      sourceCode: sourceCode || null,
      schema,
      values,
      updatedAt
    }
  };
}

function extractRuntimeConfigMap(workflowConfig = {}) {
  const map = workflowConfig?.tradeBots?.runtimeConfigs;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  return map;
}

function normalizeInstanceStatus(value) {
  const normalized = String(value || 'stopped')
    .trim()
    .toLowerCase();
  if (['running', 'paused', 'error', 'stopped'].includes(normalized)) return normalized;
  return 'stopped';
}

export function normalizeInstanceControlAction(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!SUPPORTED_INSTANCE_CONTROL_ACTIONS.includes(normalized)) {
    throw httpError(
      `Unsupported bot instance action "${value}". Supported actions: ${SUPPORTED_INSTANCE_CONTROL_ACTIONS.join(', ')}`,
      400
    );
  }
  return normalized;
}

export function normalizeBotControlAction(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!SUPPORTED_BOT_CONTROL_ACTIONS.includes(normalized)) {
    throw httpError(
      `Unsupported bot action "${value}". Supported actions: ${SUPPORTED_BOT_CONTROL_ACTIONS.join(', ')}`,
      400
    );
  }
  return normalized;
}

function allowedInstanceActions(statusValue) {
  const status = normalizeInstanceStatus(statusValue);
  if (status === 'running') return ['pause', 'stop', 'restart'];
  if (status === 'paused') return ['start', 'resume', 'stop', 'restart'];
  if (status === 'error') return ['start', 'resume', 'stop', 'restart'];
  return ['start', 'resume', 'restart'];
}

function presentBotVersion(version) {
  const meta = parseVersionNotes(version.notes);
  return {
    id: version.id,
    botId: version.botId,
    status: version.status,
    imageRef: version.imageRef || null,
    signedDigest: version.signedDigest || null,
    sbomRef: version.sbomRef || null,
    sdkVersion: version.sdkVersion || null,
    language: meta.language || null,
    entrypoint: meta.entrypoint || null,
    originalFilename: meta.originalFilename || null,
    uploadSizeBytes: meta.uploadSizeBytes || null,
    uploadedAt: meta.uploadedAt || null,
    userNotes: meta.userNotes || null,
    build: meta.build || null,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt
  };
}

function presentBotInstance(instance, { orderCount = 0, runCount = 0, guardrailCount = 0 } = {}) {
  const normalizedStatus = normalizeInstanceStatus(instance.status);
  const allowedActions = allowedInstanceActions(normalizedStatus);
  return {
    id: instance.id,
    workspaceId: instance.workspaceId,
    botId: instance.botId,
    botVersionId: instance.botVersionId,
    exchangeAccountId: instance.exchangeAccountId,
    exchangeAccount: instance.exchange
      ? {
          id: instance.exchange.id,
          name: instance.exchange.name,
          venue: instance.exchange.venue,
          isSandbox: instance.exchange.isSandbox
        }
      : null,
    symbol: instance.symbol,
    direction: instance.direction,
    leverage: instance.leverage,
    maxDailyLossPct: instance.maxDailyLossPct,
    takeProfitPct: instance.takeProfitPct,
    slAtrMult: instance.slAtrMult,
    useLimitEntries: instance.useLimitEntries,
    minNotional: instance.minNotional,
    status: normalizedStatus,
    webhookToken: instance.webhookToken,
    startedAt: instance.startedAt,
    stoppedAt: instance.stoppedAt,
    lastError: instance.lastError || null,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    lifecycle: {
      allowedActions,
      canStart: allowedActions.includes('start'),
      canResume: allowedActions.includes('resume'),
      canPause: allowedActions.includes('pause'),
      canStop: allowedActions.includes('stop'),
      canRestart: allowedActions.includes('restart')
    },
    counts: {
      orders: orderCount,
      runs: runCount,
      guardrailEvents: guardrailCount
    }
  };
}

function presentBotSummary(
  bot,
  { workflowNodeIds = new Set(), orderCount = 0, runCount = 0, guardrailCount = 0, instanceCount = null, access = null } = {}
) {
  const nodeId = createWorkflowNodeId(bot.id);
  return {
    id: bot.id,
    workspaceId: bot.workspaceId,
    name: bot.name,
    kind: bot.kind,
    description: bot.description || null,
    latestVersionId: bot.latestVersionId || null,
    latestVersion: bot.latestVersion ? presentBotVersion(bot.latestVersion) : null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    counts: {
      versions: bot._count?.versions || 0,
      instances: instanceCount !== null ? Number(instanceCount) : bot._count?.instances || 0,
      rentals: bot._count?.rentals || 0,
      orders: orderCount,
      runs: runCount,
      guardrailEvents: guardrailCount
    },
    access: access
      ? {
          owner: Boolean(access.owner),
          rented: Boolean(access.rented)
        }
      : undefined,
    workflow: {
      nodeId,
      linked: workflowNodeIds.has(nodeId)
    }
  };
}

async function hasWorkspaceAccessToBot(workspaceId, botId) {
  const [instance, rental] = await Promise.all([
    prisma.botInstance.findFirst({
      where: {
        workspaceId,
        botId
      },
      select: { id: true }
    }),
    prisma.rental.findFirst({
      where: {
        renterWorkspaceId: workspaceId,
        botId
      },
      select: { id: true }
    })
  ]);
  return Boolean(instance || rental);
}

async function assertBotInWorkspace(workspaceId, botId, options = {}) {
  const allowRented = Boolean(options?.allowRented);
  const bot = await prisma.bot.findUnique({
    where: {
      id: botId
    },
    include: {
      latestVersion: {
        select: {
          id: true,
          notes: true
        }
      }
    }
  });
  if (!bot) {
    throw httpError('Trade bot not found', 404);
  }
  if (bot.workspaceId === workspaceId) {
    return bot;
  }
  if (allowRented && (await hasWorkspaceAccessToBot(workspaceId, botId))) {
    return bot;
  }
  throw httpError('Trade bot not found', 404);
}

async function assertExchangeAccountInWorkspace(workspaceId, exchangeAccountId) {
  const exchangeAccount = await prisma.exchangeAccount.findFirst({
    where: {
      id: exchangeAccountId,
      workspaceId
    }
  });
  if (!exchangeAccount) {
    throw httpError('Exchange account not found in workspace', 404);
  }
  return exchangeAccount;
}

async function assertBotInstanceInWorkspace(workspaceId, botId, instanceId) {
  const instance = await prisma.botInstance.findFirst({
    where: {
      id: instanceId,
      workspaceId,
      botId
    },
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    }
  });
  if (!instance) {
    throw httpError('Trade bot instance not found', 404);
  }
  return instance;
}

async function ensureWorkflowNodeForBot(workspaceId, bot) {
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const customNodes = Array.isArray(cfg.customNodes) ? [...cfg.customNodes] : [];
  const nodeId = createWorkflowNodeId(bot.id);
  const nextNode = {
    id: nodeId,
    side: 'source',
    label: bot.name,
    nodeType: 'trade-bot',
    description: bot.description || `Trade bot: ${bot.name}`
  };

  const idx = customNodes.findIndex((node) => node?.id === nodeId);
  if (idx === -1) {
    customNodes.push(nextNode);
    await saveWorkspaceWorkflowConfig(workspaceId, {
      ...cfg,
      customNodes
    });
    return nodeId;
  }

  const current = customNodes[idx] || {};
  if (
    current.label !== nextNode.label ||
    current.nodeType !== nextNode.nodeType ||
    current.side !== nextNode.side ||
    current.description !== nextNode.description
  ) {
    customNodes[idx] = {
      ...current,
      ...nextNode
    };
    await saveWorkspaceWorkflowConfig(workspaceId, {
      ...cfg,
      customNodes
    });
  }
  return nodeId;
}

async function collectInstanceAggregates(instanceIds = []) {
  if (!instanceIds.length) {
    return {
      orderCountsByInstance: new Map(),
      runCountsByInstance: new Map(),
      guardrailCountsByInstance: new Map()
    };
  }

  const [orderCounts, runCounts, guardrailCounts] = await Promise.all([
    prisma.order.groupBy({
      by: ['botInstanceId'],
      where: { botInstanceId: { in: instanceIds } },
      _count: { _all: true }
    }),
    prisma.botRun.groupBy({
      by: ['botInstanceId'],
      where: { botInstanceId: { in: instanceIds } },
      _count: { _all: true }
    }),
    prisma.guardrailEvent.groupBy({
      by: ['botInstanceId'],
      where: { botInstanceId: { in: instanceIds } },
      _count: { _all: true }
    })
  ]);

  return {
    orderCountsByInstance: new Map(orderCounts.map((row) => [row.botInstanceId, row._count?._all || 0])),
    runCountsByInstance: new Map(runCounts.map((row) => [row.botInstanceId, row._count?._all || 0])),
    guardrailCountsByInstance: new Map(guardrailCounts.map((row) => [row.botInstanceId, row._count?._all || 0]))
  };
}

export function listSupportedBotLanguages() {
  return SUPPORTED_BOT_LANGUAGES;
}

export async function listTradeBots(workspaceId) {
  const [workspace, ownedBots, instances] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { workflowConfig: true }
    }),
    prisma.bot.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      include: {
        latestVersion: true,
        _count: {
          select: {
            versions: true,
            instances: true,
            rentals: true
          }
        }
      }
    }),
    prisma.botInstance.findMany({
      where: {
        workspaceId
      },
      select: {
        id: true,
        botId: true
      }
    })
  ]);

  const ownedBotIds = new Set(ownedBots.map((bot) => bot.id));
  const externalBotIds = Array.from(
    new Set(instances.map((instance) => instance.botId).filter((botId) => botId && !ownedBotIds.has(botId)))
  );

  let externalBots = [];
  if (externalBotIds.length) {
    externalBots = await prisma.bot.findMany({
      where: {
        id: { in: externalBotIds }
      },
      include: {
        latestVersion: true,
        _count: {
          select: {
            versions: true,
            instances: true,
            rentals: true
          }
        }
      }
    });
  }

  const bots = [...ownedBots, ...externalBots].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const workflowNodeIds = new Set(
    ((workspace?.workflowConfig?.customNodes && Array.isArray(workspace.workflowConfig.customNodes))
      ? workspace.workflowConfig.customNodes
      : []
    )
      .map((node) => node?.id)
      .filter(Boolean)
  );
  const instanceIds = instances.map((instance) => instance.id);
  const { orderCountsByInstance, runCountsByInstance, guardrailCountsByInstance } = await collectInstanceAggregates(
    instanceIds
  );

  const perBotCounts = new Map();
  const workspaceInstanceCounts = new Map();
  instances.forEach((instance) => {
    const current = perBotCounts.get(instance.botId) || { orders: 0, runs: 0, guardrailEvents: 0 };
    current.orders += orderCountsByInstance.get(instance.id) || 0;
    current.runs += runCountsByInstance.get(instance.id) || 0;
    current.guardrailEvents += guardrailCountsByInstance.get(instance.id) || 0;
    perBotCounts.set(instance.botId, current);
    workspaceInstanceCounts.set(instance.botId, (workspaceInstanceCounts.get(instance.botId) || 0) + 1);
  });

  return bots.map((bot) => {
    const summaryCounts = perBotCounts.get(bot.id) || { orders: 0, runs: 0, guardrailEvents: 0 };
    return presentBotSummary(bot, {
      workflowNodeIds,
      orderCount: summaryCounts.orders,
      runCount: summaryCounts.runs,
      guardrailCount: summaryCounts.guardrailEvents,
      instanceCount: workspaceInstanceCounts.get(bot.id) || 0,
      access: {
        owner: bot.workspaceId === workspaceId,
        rented: bot.workspaceId !== workspaceId
      }
    });
  });
}

export async function createTradeBot(workspaceId, payload) {
  const bot = await prisma.bot.create({
    data: {
      workspaceId,
      name: payload.name,
      kind: payload.kind || 'code',
      description: payload.description || null
    }
  });
  await ensureWorkflowNodeForBot(workspaceId, bot);
  return getTradeBotDetail(workspaceId, bot.id);
}

export async function getTradeBotDetail(workspaceId, botId) {
  await assertBotInWorkspace(workspaceId, botId, { allowRented: true });

  const [workspace, bot, instances] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { workflowConfig: true }
    }),
    prisma.bot.findUnique({
      where: {
        id: botId
      },
      include: {
        latestVersion: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        _count: {
          select: {
            versions: true,
            instances: true,
            rentals: true
          }
        }
      }
    }),
    prisma.botInstance.findMany({
      where: {
        botId,
        workspaceId
      },
      orderBy: { createdAt: 'desc' },
      include: {
        exchange: {
          select: {
            id: true,
            name: true,
            venue: true,
            isSandbox: true
          }
        }
      }
    })
  ]);

  if (!bot) {
    throw httpError('Trade bot not found', 404);
  }

  const workflowNodeIds = new Set(
    ((workspace?.workflowConfig?.customNodes && Array.isArray(workspace.workflowConfig.customNodes))
      ? workspace.workflowConfig.customNodes
      : []
    )
      .map((node) => node?.id)
      .filter(Boolean)
  );

  const instanceIds = instances.map((instance) => instance.id);
  const { orderCountsByInstance, runCountsByInstance, guardrailCountsByInstance } = await collectInstanceAggregates(
    instanceIds
  );
  const orderCount = instanceIds.reduce((sum, id) => sum + (orderCountsByInstance.get(id) || 0), 0);
  const runCount = instanceIds.reduce((sum, id) => sum + (runCountsByInstance.get(id) || 0), 0);
  const guardrailCount = instanceIds.reduce((sum, id) => sum + (guardrailCountsByInstance.get(id) || 0), 0);

  const nodeId = createWorkflowNodeId(bot.id);
  const base = presentBotSummary(bot, {
    workflowNodeIds,
    orderCount,
    runCount,
    guardrailCount,
    instanceCount: instances.length,
    access: {
      owner: bot.workspaceId === workspaceId,
      rented: bot.workspaceId !== workspaceId
    }
  });

  return {
    ...base,
    versions: (bot.versions || []).map((version) => presentBotVersion(version)),
    instances: instances.map((instance) =>
      presentBotInstance(instance, {
        orderCount: orderCountsByInstance.get(instance.id) || 0,
        runCount: runCountsByInstance.get(instance.id) || 0,
        guardrailCount: guardrailCountsByInstance.get(instance.id) || 0
      })
    ),
    links: {
      orders: `/api/v1/trade-bots/${workspaceId}/bots/${bot.id}/orders`,
      monitoring: `/api/v1/trade-bots/${workspaceId}/bots/${bot.id}/monitoring`,
      workflow: `/api/v1/trade-bots/${workspaceId}/bots/${bot.id}/workflow`,
      workflowNodeId: nodeId
    }
  };
}

export async function getTradeBotRuntimeConfig(workspaceId, botId) {
  const bot = await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const runtimeMap = extractRuntimeConfigMap(cfg);
  const current = runtimeMap[botId] && typeof runtimeMap[botId] === 'object' ? runtimeMap[botId] : {};
  const links = normalizeRuntimeLink(current.links || null);
  const defaultRules = getDefaultRuntimeRulesForBot(bot, { symbol: current?.rules?.symbol || null });
  const rules = mergeRuntimeRulesWithDefaults(defaultRules, normalizeRuntimeRules(current.rules || null));
  const hydratedRules = hydrateRuntimeRulesWithCodeSource(rules, bot);
  const resolved = resolveRuntimeCodeParameters(hydratedRules);

  return {
    workspaceId,
    botId,
    links,
    rules: resolved.rules,
    takeProfit: summarizeTakeProfitRules(resolved.rules),
    parameters: resolved.parameters,
    updatedAt: current.updatedAt || links.updatedAt || null
  };
}

export async function upsertTradeBotRuntimeConfig(workspaceId, botId, payload = {}) {
  const bot = await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const runtimeMap = extractRuntimeConfigMap(cfg);
  const previous = runtimeMap[botId] && typeof runtimeMap[botId] === 'object' ? runtimeMap[botId] : {};
  const defaultRules = getDefaultRuntimeRulesForBot(bot, {
    symbol: payload?.rules?.symbol || previous?.rules?.symbol || null
  });

  const nextLinks = Object.prototype.hasOwnProperty.call(payload, 'links')
    ? normalizeRuntimeLink(payload.links || null)
    : normalizeRuntimeLink(previous.links || null);
  const nextRules = Object.prototype.hasOwnProperty.call(payload, 'rules')
    ? normalizeRuntimeRules(payload.rules || null)
    : normalizeRuntimeRules(previous.rules || null);
  const mergedRules = mergeRuntimeRulesWithDefaults(defaultRules, nextRules);
  const hydratedRules = hydrateRuntimeRulesWithCodeSource(mergedRules, bot);
  const resolved = resolveRuntimeCodeParameters(hydratedRules);

  const nextCodeParametersUpdatedAt = Object.prototype.hasOwnProperty.call(payload, 'rules')
    ? new Date().toISOString()
    : resolved.parameters.updatedAt || null;

  const nextEntry = {
    links: nextLinks,
    rules: {
      ...resolved.rules,
      codeParametersUpdatedAt: nextCodeParametersUpdatedAt
    },
    updatedAt: new Date().toISOString()
  };

  const nextRuntimeMap = {
    ...runtimeMap,
    [botId]: nextEntry
  };

  const nextConfig = {
    ...cfg,
    tradeBots: {
      ...(cfg.tradeBots && typeof cfg.tradeBots === 'object' ? cfg.tradeBots : {}),
      runtimeConfigs: nextRuntimeMap
    }
  };

  await saveWorkspaceWorkflowConfig(workspaceId, nextConfig);
  return {
    workspaceId,
    botId,
    takeProfit: summarizeTakeProfitRules(nextEntry.rules),
    parameters: {
      ...resolved.parameters,
      updatedAt: nextEntry.rules.codeParametersUpdatedAt
    },
    ...nextEntry
  };
}

function assertZipFilename(filename) {
  const name = String(filename || '').trim().toLowerCase();
  if (!name.endsWith('.zip')) {
    throw httpError('Only .zip bot bundles are supported for upload', 400);
  }
}

async function runBuildAndPersistVersion({ bot, version, zipPath, autoPublish = false }) {
  let buildResult;
  try {
    buildResult = await buildVersion({
      botId: bot.id,
      versionId: version.id,
      zipPath
    });
  } catch (error) {
    const rejected = await prisma.botVersion.update({
      where: { id: version.id },
      data: {
        status: 'rejected',
        notes: mergeVersionNotes(version.notes, {
          build: {
            status: 'rejected',
            reasons: [error?.message || 'Build failed']
          }
        })
      }
    });
    return {
      version: rejected,
      buildResult: {
        status: 'rejected',
        reasons: [error?.message || 'Build failed']
      }
    };
  }

  if (buildResult.status !== 'approved') {
    const rejected = await prisma.botVersion.update({
      where: { id: version.id },
      data: {
        status: 'rejected',
        notes: mergeVersionNotes(version.notes, {
          build: {
            status: 'rejected',
            reasons: buildResult.reasons || []
          }
        })
      }
    });
    return { version: rejected, buildResult };
  }

  const nextStatus = autoPublish ? 'published' : 'approved';
  const approved = await prisma.botVersion.update({
    where: { id: version.id },
    data: {
      status: nextStatus,
      imageRef: buildResult.imageRef || null,
      signedDigest: buildResult.signedDigest || null,
      sbomRef: buildResult.sbomRef || null,
      notes: mergeVersionNotes(version.notes, {
        build: {
          status: nextStatus,
          scanRef: buildResult.scanRef || null
        }
      })
    }
  });

  await prisma.bot.update({
    where: { id: bot.id },
    data: { latestVersionId: approved.id }
  });

  return { version: approved, buildResult };
}

export async function uploadTradeBotVersion({
  workspaceId,
  botId,
  language,
  entrypoint,
  userNotes,
  autoPublish = false,
  file
}) {
  if (!file?.buffer || !file?.size) {
    throw httpError('Bot ZIP file is required', 400);
  }

  const bot = await assertBotInWorkspace(workspaceId, botId);
  const normalizedLanguage = normalizeBotLanguage(language);
  assertZipFilename(file.originalname);

  const version = await prisma.botVersion.create({
    data: {
      botId: bot.id,
      status: 'draft',
      notes: stringifyVersionNotes({
        language: normalizedLanguage,
        entrypoint: entrypoint || null,
        originalFilename: file.originalname || null,
        uploadSizeBytes: file.size || null,
        uploadedAt: new Date().toISOString(),
        userNotes: userNotes || null
      })
    }
  });

  const { zipPath } = storagePathsForVersion(version.id);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, file.buffer);

  const { version: finalizedVersion, buildResult } = await runBuildAndPersistVersion({
    bot,
    version,
    zipPath,
    autoPublish
  });

  return {
    botId: bot.id,
    version: presentBotVersion(finalizedVersion),
    build: buildResult
  };
}

export async function createTradeBotInstance(workspaceId, botId, payload) {
  const bot = await assertBotInWorkspace(workspaceId, botId);
  const exchangeAccount = await assertExchangeAccountInWorkspace(workspaceId, payload.exchangeAccountId);

  const resolvedVersionId = payload.botVersionId || bot.latestVersionId;
  if (!resolvedVersionId) {
    throw httpError('No bot version available. Upload a bot bundle first.', 400);
  }

  const version = await prisma.botVersion.findFirst({
    where: {
      id: resolvedVersionId,
      botId: bot.id
    }
  });
  if (!version) {
    throw httpError('Bot version not found for this bot', 404);
  }
  if (!['approved', 'published', 'built', 'scanned'].includes(String(version.status || '').toLowerCase())) {
    throw httpError('Bot version must be approved or published before creating an instance', 400);
  }

  const instance = await prisma.botInstance.create({
    data: {
      botId: bot.id,
      botVersionId: version.id,
      workspaceId,
      exchangeAccountId: exchangeAccount.id,
      symbol: String(payload.symbol || '').toUpperCase(),
      direction: String(payload.direction || 'both').toLowerCase(),
      leverage: Number(payload.leverage || 1),
      maxDailyLossPct: Number(payload.maxDailyLossPct || 5),
      takeProfitPct: Number(payload.takeProfitPct || 1),
      slAtrMult: Number(payload.slAtrMult || 1.5),
      useLimitEntries: payload.useLimitEntries !== undefined ? Boolean(payload.useLimitEntries) : true,
      minNotional: Number(payload.minNotional || 1),
      status: normalizeInstanceStatus(payload.status)
    },
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    }
  });
  return presentBotInstance(instance);
}

export async function listTradeBotInstances(workspaceId, botId) {
  await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId
    },
    orderBy: { createdAt: 'desc' },
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    }
  });
  const instanceIds = instances.map((instance) => instance.id);
  const { orderCountsByInstance, runCountsByInstance, guardrailCountsByInstance } = await collectInstanceAggregates(
    instanceIds
  );
  return instances.map((instance) =>
    presentBotInstance(instance, {
      orderCount: orderCountsByInstance.get(instance.id) || 0,
      runCount: runCountsByInstance.get(instance.id) || 0,
      guardrailCount: guardrailCountsByInstance.get(instance.id) || 0
    })
  );
}

function buildInstanceControlPatch(instance, action) {
  const normalizedStatus = normalizeInstanceStatus(instance.status);
  const normalizedAction = normalizeInstanceControlAction(action);
  const now = new Date();

  if (normalizedAction === 'start' || normalizedAction === 'resume') {
    if (normalizedStatus === 'running') return null;
    return {
      status: 'running',
      startedAt: now,
      stoppedAt: null,
      lastError: null
    };
  }

  if (normalizedAction === 'pause') {
    if (normalizedStatus !== 'running') {
      throw httpError('Only running instances can be paused', 409);
    }
    return {
      status: 'paused'
    };
  }

  if (normalizedAction === 'stop') {
    if (normalizedStatus === 'stopped') return null;
    return {
      status: 'stopped',
      stoppedAt: now
    };
  }

  return {
    status: 'running',
    startedAt: now,
    stoppedAt: null,
    lastError: null
  };
}

export async function controlTradeBotInstance(workspaceId, botId, instanceId, action) {
  await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const instance = await assertBotInstanceInWorkspace(workspaceId, botId, instanceId);
  const patch = buildInstanceControlPatch(instance, action);
  if (!patch) {
    return presentBotInstance(instance);
  }

  const updated = await prisma.botInstance.update({
    where: { id: instance.id },
    data: patch,
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    }
  });

  return presentBotInstance(updated);
}

async function removeWorkflowArtifactsForBot(workspaceId, botId) {
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const nodeId = createWorkflowNodeId(botId);
  const currentRules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const currentCustomNodes = Array.isArray(cfg.customNodes) ? cfg.customNodes : [];
  const currentRuntimeMap = extractRuntimeConfigMap(cfg);

  const nextRules = currentRules.filter((rule) => rule?.source?.id !== nodeId && rule?.destination?.id !== nodeId);
  const nextCustomNodes = currentCustomNodes.filter((node) => node?.id !== nodeId);
  const nextRuntimeMap = {
    ...currentRuntimeMap
  };
  const hadRuntime = Object.prototype.hasOwnProperty.call(nextRuntimeMap, botId);
  if (hadRuntime) {
    delete nextRuntimeMap[botId];
  }

  const changed =
    nextRules.length !== currentRules.length ||
    nextCustomNodes.length !== currentCustomNodes.length ||
    hadRuntime;

  if (!changed) {
    return;
  }

  const nextConfig = {
    ...cfg,
    rules: nextRules,
    customNodes: nextCustomNodes,
    tradeBots: {
      ...(cfg.tradeBots && typeof cfg.tradeBots === 'object' ? cfg.tradeBots : {}),
      runtimeConfigs: nextRuntimeMap
    }
  };
  await saveWorkspaceWorkflowConfig(workspaceId, nextConfig);
}

export async function deleteTradeBot(workspaceId, botId) {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      name: true,
      workspaceId: true
    }
  });

  if (!bot || bot.workspaceId !== workspaceId) {
    throw httpError('Trade bot not found', 404);
  }

  const [activeRentals, instances] = await Promise.all([
    prisma.rental.count({
      where: {
        botId,
        status: 'active'
      }
    }),
    prisma.botInstance.findMany({
      where: { botId },
      select: {
        id: true,
        workspaceId: true
      }
    })
  ]);

  if (activeRentals > 0) {
    throw httpError('Cannot delete bot while active rentals exist', 409);
  }

  const externalInstances = instances.filter((instance) => instance.workspaceId !== workspaceId);
  if (externalInstances.length > 0) {
    throw httpError('Cannot delete bot while external workspace instances exist', 409);
  }

  const instanceIds = instances.map((instance) => instance.id);

  const deleted = await prisma.$transaction(async (tx) => {
    const deletedRentals = await tx.rental.deleteMany({
      where: { botId }
    });

    let deletedInstances = 0;
    if (instanceIds.length > 0) {
      await Promise.all([
        tx.guardrailEvent.deleteMany({ where: { botInstanceId: { in: instanceIds } } }),
        tx.botRun.deleteMany({ where: { botInstanceId: { in: instanceIds } } }),
        tx.signal.deleteMany({ where: { botInstanceId: { in: instanceIds } } }),
        tx.position.deleteMany({ where: { botInstanceId: { in: instanceIds } } }),
        tx.order.deleteMany({ where: { botInstanceId: { in: instanceIds } } })
      ]);

      const removedInstances = await tx.botInstance.deleteMany({
        where: { id: { in: instanceIds } }
      });
      deletedInstances = removedInstances.count;
    }

    await tx.bot.update({
      where: { id: botId },
      data: { latestVersionId: null }
    });

    const deletedVersions = await tx.botVersion.deleteMany({
      where: { botId }
    });

    await tx.bot.delete({
      where: { id: botId }
    });

    return {
      rentals: deletedRentals.count,
      instances: deletedInstances,
      versions: deletedVersions.count
    };
  });

  await removeWorkflowArtifactsForBot(workspaceId, botId);

  return {
    success: true,
    botId,
    name: bot.name,
    deleted
  };
}

export async function controlTradeBot(workspaceId, botId, action) {
  const normalizedAction = normalizeBotControlAction(action);

  if (normalizedAction === 'delete') {
    return deleteTradeBot(workspaceId, botId);
  }

  await assertBotInWorkspace(workspaceId, botId, { allowRented: true });

  const now = new Date();
  let where = {
    workspaceId,
    botId
  };
  let data = null;

  if (normalizedAction === 'pause') {
    where = {
      ...where,
      status: 'running'
    };
    data = {
      status: 'paused'
    };
  } else if (normalizedAction === 'resume') {
    where = {
      ...where,
      status: 'paused'
    };
    data = {
      status: 'running',
      startedAt: now,
      stoppedAt: null,
      lastError: null
    };
  } else if (normalizedAction === 'stop') {
    where = {
      ...where,
      status: { in: ['running', 'paused', 'error'] }
    };
    data = {
      status: 'stopped',
      stoppedAt: now
    };
  } else {
    data = {
      status: 'running',
      startedAt: now,
      stoppedAt: null,
      lastError: null
    };
  }

  const updateResult = await prisma.botInstance.updateMany({
    where,
    data
  });

  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId
    },
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return {
    botId,
    action: normalizedAction,
    updated: updateResult.count,
    totalInstances: instances.length,
    instances: instances.map((instance) => presentBotInstance(instance))
  };
}

export async function listTradeBotOrders(workspaceId, botId, filters = {}) {
  await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId,
      ...(filters.instanceId ? { id: filters.instanceId } : {})
    },
    select: { id: true, symbol: true, status: true }
  });
  const instanceIds = instances.map((instance) => instance.id);
  if (!instanceIds.length) {
    return { total: 0, items: [] };
  }

  const items = await prisma.order.findMany({
    where: {
      botInstanceId: { in: instanceIds },
      ...(filters.symbol ? { symbol: String(filters.symbol).toUpperCase() } : {}),
      ...(filters.status ? { status: String(filters.status) } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: asPositiveInt(filters.limit, DEFAULT_LIST_LIMIT)
  });

  const instanceMap = new Map(instances.map((instance) => [instance.id, instance]));
  return {
    total: items.length,
    items: items.map((item) => ({
      id: item.id,
      botInstanceId: item.botInstanceId,
      instance: instanceMap.get(item.botInstanceId) || null,
      venue: item.venue,
      symbol: item.symbol,
      side: item.side,
      type: item.type,
      status: item.status,
      venueOrderId: item.venueOrderId || null,
      error: item.error || null,
      price: toPlainDecimal(item.price),
      qty: toPlainDecimal(item.qty),
      quoteSpend: toPlainDecimal(item.quoteSpend),
      qtyRaw: toPlainDecimal(item.qtyRaw),
      qtyFinal: toPlainDecimal(item.qtyFinal),
      refPrice: toPlainDecimal(item.refPrice),
      minNotional: toPlainDecimal(item.minNotional),
      stepSize: toPlainDecimal(item.stepSize),
      riskMode: item.riskMode || null,
      riskValue: toPlainDecimal(item.riskValue),
      slPrice: toPlainDecimal(item.slPrice),
      tpPrice: toPlainDecimal(item.tpPrice),
      sizingStatus: item.sizingStatus || null,
      sizingRejectReason: item.sizingRejectReason || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  };
}

export async function getTradeBotMonitoring(workspaceId, botId, filters = {}) {
  const bot = await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const workflowConfig = await getWorkspaceWorkflowConfig(workspaceId);
  const runtimeMap = extractRuntimeConfigMap(workflowConfig);
  const runtimeEntry = runtimeMap[bot.id] && typeof runtimeMap[bot.id] === 'object' ? runtimeMap[bot.id] : {};
  const runtimeRules = normalizeRuntimeRules(runtimeEntry.rules || null);
  const takeProfit = summarizeTakeProfitRules(runtimeRules);

  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId,
      ...(filters.instanceId ? { id: filters.instanceId } : {})
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      symbol: true,
      status: true,
      startedAt: true,
      stoppedAt: true,
      lastError: true
    }
  });
  const instanceIds = instances.map((instance) => instance.id);
  if (!instanceIds.length) {
    return {
      summary: {
        running: 0,
        paused: 0,
        stopped: 0,
        error: 0
      },
      takeProfit,
      runs: [],
      guardrailEvents: [],
      positions: []
    };
  }

  const limit = asPositiveInt(filters.limit, DEFAULT_LIST_LIMIT);
  const [runs, guardrailEvents, positions] = await Promise.all([
    prisma.botRun.findMany({
      where: { botInstanceId: { in: instanceIds } },
      orderBy: { startedAt: 'desc' },
      take: limit
    }),
    prisma.guardrailEvent.findMany({
      where: { botInstanceId: { in: instanceIds } },
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    prisma.position.findMany({
      where: { botInstanceId: { in: instanceIds } },
      orderBy: { openedAt: 'desc' },
      take: limit
    })
  ]);

  const summary = instances.reduce(
    (acc, instance) => {
      const key = normalizeInstanceStatus(instance.status);
      acc[key] += 1;
      return acc;
    },
    { running: 0, paused: 0, stopped: 0, error: 0 }
  );

  return {
    summary,
    takeProfit,
    instances,
    runs: runs.map((run) => ({
      id: run.id,
      botInstanceId: run.botInstanceId,
      status: run.status,
      error: run.error || null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      metrics: run.metricsJson || null
    })),
    guardrailEvents: guardrailEvents.map((event) => ({
      id: event.id,
      botInstanceId: event.botInstanceId,
      type: event.type,
      detail: event.detail || null,
      createdAt: event.createdAt
    })),
    positions: positions.map((position) => ({
      id: position.id,
      botInstanceId: position.botInstanceId,
      symbol: position.symbol,
      side: position.side,
      entryPrice: toPlainDecimal(position.entryPrice),
      qty: toPlainDecimal(position.qty),
      pnl: toPlainDecimal(position.pnl),
      openedAt: position.openedAt,
      closedAt: position.closedAt
    }))
  };
}

export async function getTradeBotWorkflowLink(workspaceId, botId) {
  const bot = await assertBotInWorkspace(workspaceId, botId, { allowRented: true });
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const nodeId = createWorkflowNodeId(bot.id);
  const customNodes = Array.isArray(cfg.customNodes) ? cfg.customNodes : [];
  const node = customNodes.find((entry) => entry?.id === nodeId) || null;
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const linkedRules = rules.filter((rule) => rule?.source?.id === nodeId);

  return {
    workflowNodeId: nodeId,
    linked: Boolean(node),
    node,
    linkedRuleCount: linkedRules.length,
    linkedRules,
    workflowConfigVersion: cfg.version || 1
  };
}

function addDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function presentMarketplacePlan(plan) {
  return {
    id: plan.id,
    workspaceId: plan.workspaceId,
    name: plan.name,
    cpuMilli: plan.cpuMilli,
    memMiB: plan.memMiB,
    priceMonthly: plan.priceMonthly,
    active: Boolean(plan.active)
  };
}

function presentRental(rental) {
  return {
    id: rental.id,
    botId: rental.botId,
    renterWorkspaceId: rental.renterWorkspaceId,
    planId: rental.planId,
    exchangeAccountId: rental.exchangeAccountId,
    botInstanceId: rental.botInstanceId || null,
    status: rental.status,
    revenueShareBps: rental.revenueShareBps,
    createdAt: rental.createdAt,
    expiresAt: rental.expiresAt,
    bot: rental.bot
      ? {
          id: rental.bot.id,
          workspaceId: rental.bot.workspaceId,
          name: rental.bot.name,
          kind: rental.bot.kind,
          description: rental.bot.description || null,
          latestVersionId: rental.bot.latestVersionId || null,
          createdAt: rental.bot.createdAt,
          updatedAt: rental.bot.updatedAt
        }
      : null,
    plan: rental.plan ? presentMarketplacePlan(rental.plan) : null,
    exchangeAccount: rental.exchangeAccount
      ? {
          id: rental.exchangeAccount.id,
          workspaceId: rental.exchangeAccount.workspaceId,
          name: rental.exchangeAccount.name,
          venue: rental.exchangeAccount.venue,
          isSandbox: rental.exchangeAccount.isSandbox,
          createdAt: rental.exchangeAccount.createdAt,
          updatedAt: rental.exchangeAccount.updatedAt
        }
      : null,
    instance: rental.instance ? presentBotInstance(rental.instance) : null
  };
}

export async function listMarketBots(_workspaceId) {
  const bots = await prisma.bot.findMany({
    where: { latestVersionId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    include: {
      workspace: {
        select: { id: true, name: true }
      }
    }
  });
  if (!bots.length) return [];

  const latestVersionIds = Array.from(
    new Set(
      bots
        .map((bot) => bot.latestVersionId)
        .filter(Boolean)
    )
  );
  const [versions, plans] = await Promise.all([
    prisma.botVersion.findMany({
      where: {
        id: { in: latestVersionIds },
        status: { in: ['published', 'approved'] }
      },
      select: {
        id: true,
        status: true,
        createdAt: true
      }
    }),
    prisma.plan.findMany({
      where: {
        workspaceId: { in: Array.from(new Set(bots.map((bot) => bot.workspaceId))) },
        active: true
      },
      orderBy: [{ priceMonthly: 'asc' }, { name: 'asc' }]
    })
  ]);
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const plansByWorkspace = new Map();
  plans.forEach((plan) => {
    if (!plansByWorkspace.has(plan.workspaceId)) {
      plansByWorkspace.set(plan.workspaceId, []);
    }
    plansByWorkspace.get(plan.workspaceId).push(plan);
  });

  return bots
    .filter((bot) => bot.latestVersionId && versionsById.has(bot.latestVersionId))
    .map((bot) => {
      const latestVersion = versionsById.get(bot.latestVersionId);
      return {
        id: bot.id,
        name: bot.name,
        description: bot.description || null,
        workspace: {
          id: bot.workspace.id,
          name: bot.workspace.name
        },
        publishedAt: latestVersion?.createdAt || null,
        updatedAt: bot.updatedAt,
        versionId: bot.latestVersionId,
        plans: (plansByWorkspace.get(bot.workspaceId) || []).map((plan) => presentMarketplacePlan(plan))
      };
    });
}

async function ensureWorkspaceRuntimeConfigForBot({
  workspaceId,
  bot,
  exchangeAccountId = null,
  symbol = null
}) {
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const runtimeMap = extractRuntimeConfigMap(cfg);
  const current = runtimeMap[bot.id] && typeof runtimeMap[bot.id] === 'object' ? runtimeMap[bot.id] : {};
  const currentLinks = normalizeRuntimeLink(current.links || null);
  const defaultRules = getDefaultRuntimeRulesForBot(bot, { symbol });
  const mergedRules = mergeRuntimeRulesWithDefaults(defaultRules, normalizeRuntimeRules(current.rules || null));
  const hydratedRules = hydrateRuntimeRulesWithCodeSource(mergedRules, bot);
  const resolved = resolveRuntimeCodeParameters(hydratedRules);

  const nowIso = new Date().toISOString();
  const nextEntry = {
    links: {
      ...currentLinks,
      exchangeAccountId: currentLinks.exchangeAccountId || exchangeAccountId || null,
      updatedAt: nowIso
    },
    rules: {
      ...resolved.rules,
      codeParametersUpdatedAt: resolved.parameters.updatedAt || current?.rules?.codeParametersUpdatedAt || nowIso
    },
    updatedAt: nowIso
  };

  const nextRuntimeMap = {
    ...runtimeMap,
    [bot.id]: nextEntry
  };

  const nextConfig = {
    ...cfg,
    tradeBots: {
      ...(cfg.tradeBots && typeof cfg.tradeBots === 'object' ? cfg.tradeBots : {}),
      runtimeConfigs: nextRuntimeMap
    }
  };

  await saveWorkspaceWorkflowConfig(workspaceId, nextConfig);
}

export async function rentMarketBot(workspaceId, botId, payload = {}) {
  const [workspace, bot, exchangeAccount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true }
    }),
    prisma.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        workspaceId: true,
        latestVersionId: true
      }
    }),
    prisma.exchangeAccount.findFirst({
      where: {
        id: payload.exchangeAccountId,
        workspaceId
      }
    })
  ]);

  if (!workspace) throw httpError('Workspace not found', 404);
  if (!bot?.latestVersionId) throw httpError('Bot is not published in marketplace', 404);
  if (!exchangeAccount) throw httpError('Exchange account not found in workspace', 404);

  const requestedSymbol = String(payload.symbol || '')
    .trim()
    .toUpperCase();
  const defaultSymbol = isMexcMacdBollingerBot(bot) || isArnLimitOnlyBot(bot) ? 'BTCUSDC' : 'BTCUSDT';
  const symbol = normalizeTradingSymbol(requestedSymbol || defaultSymbol, defaultSymbol);

  const [version, plan] = await Promise.all([
    prisma.botVersion.findFirst({
      where: {
        id: bot.latestVersionId,
        botId: bot.id,
        status: { in: ['published', 'approved'] }
      }
    }),
    prisma.plan.findFirst({
      where: {
        id: payload.planId,
        workspaceId: bot.workspaceId,
        active: true
      }
    })
  ]);
  if (!version) throw httpError('Bot latest version is not published', 400);
  if (!plan) throw httpError('Selected plan is not available for this marketplace bot', 404);

  const instance = await prisma.botInstance.create({
    data: {
      botId: bot.id,
      botVersionId: version.id,
      workspaceId,
      exchangeAccountId: exchangeAccount.id,
      symbol: symbol || 'BTCUSDT',
      direction: 'both',
      leverage: 1,
      maxDailyLossPct: 5,
      takeProfitPct: 1,
      slAtrMult: 1.5,
      useLimitEntries: true,
      minNotional: 1,
      status: 'stopped'
    }
  });

  const rental = await prisma.rental.create({
    data: {
      botId: bot.id,
      renterWorkspaceId: workspaceId,
      planId: plan.id,
      exchangeAccountId: exchangeAccount.id,
      botInstanceId: instance.id,
      status: 'active',
      expiresAt: addDays(new Date(), 30)
    }
  });

  await ensureWorkspaceRuntimeConfigForBot({
    workspaceId,
    bot,
    exchangeAccountId: exchangeAccount.id,
    symbol
  });

  return {
    rentalId: rental.id,
    instanceId: instance.id
  };
}

export async function listWorkspaceRentals(workspaceId) {
  const rentals = await prisma.rental.findMany({
    where: {
      renterWorkspaceId: workspaceId
    },
    orderBy: { createdAt: 'desc' },
    include: {
      bot: true,
      plan: true,
      exchangeAccount: true,
      instance: {
        include: {
          exchange: {
            select: {
              id: true,
              name: true,
              venue: true,
              isSandbox: true
            }
          }
        }
      }
    }
  });
  return rentals.map((rental) => presentRental(rental));
}
