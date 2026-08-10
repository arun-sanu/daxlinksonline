import { createExchange as pendaxCreateExchange } from '@compendiumfi/pendax/exchanges/exchange.js';
import { createZerodhaExchange, isZerodhaExchange } from './zerodhaExchange.js';

const EXCHANGE_MAP = new Map([
  ['okx', 'okx'],
  ['okex', 'okx'],
  ['bybit', 'bybit'],
  ['mexc', 'mexc'],
  ['binance', 'binance'],
  ['binance.com', 'binance'],
  ['huobi', 'huobi'],
  ['kucoin', 'kucoin'],
  ['bitget', 'bitget'],
  ['blofin', 'blofin'],
  ['phemex', 'phemex'],
  ['ftx', 'ftx'],
  ['ftxus', 'ftxus'],
  ['ftx-us', 'ftxus'],
  ['zerodha', 'zerodha'],
  ['kite', 'zerodha'],
  ['kiteconnect', 'zerodha'],
  ['kite-connect', 'zerodha']
]);

const TESTNET_ENVIRONMENTS = new Set(['paper', 'testnet', 'demo', 'sandbox']);
const SUPPORTED_EXCHANGES = Array.from(new Set(EXCHANGE_MAP.values())).sort();

function resolveExchangeId(exchange) {
  if (!exchange) {
    throw new Error('Exchange identifier is required');
  }
  const normalized = exchange.toLowerCase();
  if (!EXCHANGE_MAP.has(normalized)) {
    throw new Error(`Exchange "${exchange}" is not yet supported. Supported exchanges: ${SUPPORTED_EXCHANGES.join(', ')}`);
  }
  return EXCHANGE_MAP.get(normalized);
}

function buildPendaxOptions(options, exchangeId) {
  const resolved = exchangeId || resolveExchangeId(options.exchange);

  if (!options.apiKey || !options.apiSecret) {
    throw new Error('Missing API credentials');
  }

  const displayName = options.exchangeLabel || resolved.toUpperCase();
  const pendaxOptions = {
    exchange: resolved,
    exchangeLabel: displayName,
    apiKey: typeof options.apiKey === 'string' ? options.apiKey.trim() : options.apiKey,
    apiSecret: typeof options.apiSecret === 'string' ? options.apiSecret.trim() : options.apiSecret,
    authenticate: true
  };

  if (options.passphrase) {
    pendaxOptions.passphrase = typeof options.passphrase === 'string' ? options.passphrase.trim() : options.passphrase;
  }

  if (options.environment) {
    pendaxOptions.environment = options.environment;
    if (TESTNET_ENVIRONMENTS.has(options.environment.toLowerCase())) {
      pendaxOptions.testnet = true;
    }
  }

  return pendaxOptions;
}

export function createExchange(options = {}) {
  try {
    const exchangeId = resolveExchangeId(options.exchange);
    if (isZerodhaExchange(exchangeId)) {
      return createZerodhaExchange({ ...options, exchange: 'zerodha' });
    }
    const pendaxOptions = buildPendaxOptions(options, exchangeId);
    return pendaxCreateExchange(pendaxOptions);
  } catch (error) {
    const detail = typeof error === 'string' ? error : error?.message;
    const message = detail || 'Unknown Pendax initialization error';
    throw Object.assign(new Error(`Failed to initialize ${options.exchange ?? 'exchange'} adapter: ${message}`), {
      cause: error
    });
  }
}
