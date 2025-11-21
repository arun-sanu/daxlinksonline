import kiteconnectPkg from 'kiteconnect';

const { KiteConnect } = kiteconnectPkg || {};
if (!KiteConnect) {
  throw new Error('kiteconnect dependency is missing. Run `npm install kiteconnect`.');
}

const DEFAULT_EXCHANGE = 'NSE';
const EXCHANGE_CODES = new Set(['NSE', 'BSE', 'NFO', 'BFO', 'CDS', 'BCD', 'MCX']);
const PRODUCT_CODES = new Set(['CNC', 'MIS', 'NRML', 'CO', 'BO']);
const VARIETY_MAP = new Map([
  ['regular', 'regular'],
  ['amo', 'amo'],
  ['iceberg', 'iceberg'],
  ['auction', 'auction'],
  ['co', 'co']
]);
const VALIDITY_MAP = new Map([
  ['day', 'DAY'],
  ['ioc', 'IOC'],
  ['ttl', 'TTL']
]);
const TOKEN_ERROR_TYPES = new Set(['TokenException', 'TokenError', 'NetworkException']);
const ZERODHA_ALIASES = new Set(['zerodha', 'kite', 'kiteconnect', 'kite-connect']);

function parseSecretBlob(blob) {
  if (!blob) return {};
  if (typeof blob === 'object') return blob;
  const text = String(blob).trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Continue
  }
  return { requestToken: text };
}

function sanitizeSymbol(input) {
  if (!input) return '';
  return String(input).toUpperCase().replace(/\s+/g, '');
}

function parseInstrument(params = {}) {
  const raw = params.raw || {};
  const explicitExchange = sanitizeSymbol(params.exchange || raw.exchange || raw.segment);
  const primarySymbol = params.symbol || raw.symbol || raw.ticker || raw.instrument;
  const normalizedSymbol = sanitizeSymbol(primarySymbol);
  let exchange = DEFAULT_EXCHANGE;
  let tradingsymbol = normalizedSymbol;

  if (normalizedSymbol.includes(':')) {
    const [prefix, rest] = normalizedSymbol.split(':');
    if (EXCHANGE_CODES.has(prefix)) {
      exchange = prefix;
      tradingsymbol = rest || '';
    }
  } else if (EXCHANGE_CODES.has(explicitExchange)) {
    exchange = explicitExchange;
  }

  if (!tradingsymbol) {
    tradingsymbol = normalizedSymbol;
  }

  return { exchange, tradingsymbol };
}

function deriveQuantity(amount, raw = {}) {
  const qtyCandidates = [amount, raw.amount, raw.qty, raw.quantity, raw.size];
  for (const candidate of qtyCandidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) {
      return Math.max(1, Math.floor(num));
    }
  }
  return null;
}

function deriveProduct(raw = {}, fallbackExchange = DEFAULT_EXCHANGE) {
  const preferred = sanitizeSymbol(raw.product || raw.kiteProduct || raw.positionType);
  if (PRODUCT_CODES.has(preferred)) return preferred;
  if (fallbackExchange === 'NFO' || fallbackExchange === 'BFO') return 'NRML';
  return 'MIS';
}

function deriveValidity(raw = {}) {
  const preferred = sanitizeSymbol(raw.validity || raw.time_in_force || raw.tif);
  if (VALIDITY_MAP.has(preferred.toLowerCase())) {
    return VALIDITY_MAP.get(preferred.toLowerCase());
  }
  return 'DAY';
}

function deriveVariety(raw = {}, client) {
  const preferred = sanitizeSymbol(raw.variety || raw.orderVariety || raw.variety_type);
  if (VARIETY_MAP.has(preferred.toLowerCase())) {
    const key = VARIETY_MAP.get(preferred.toLowerCase());
    return client[`VARIETY_${key.toUpperCase()}`] || client.VARIETY_REGULAR;
  }
  return client.VARIETY_REGULAR;
}

function deriveTriggerPrice(raw = {}, fallback) {
  const candidates = [raw.trigger_price, raw.triggerPrice, raw.stop_price, raw.stopPrice, fallback];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) {
      return Number(num.toFixed(2));
    }
  }
  return undefined;
}

function buildTag(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 20);
}

function isTokenError(error) {
  const type = error?.data?.error_type || error?.error_type;
  if (type && TOKEN_ERROR_TYPES.has(type)) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('token') || message.includes('session') || message.includes('auth');
}

export function isZerodhaExchange(value) {
  if (!value) return false;
  return ZERODHA_ALIASES.has(String(value).toLowerCase());
}

export class ZerodhaExchange {
  constructor(options = {}) {
    if (!options.apiKey || !options.apiSecret) {
      throw new Error('Zerodha API key and secret are required');
    }
    this.apiKey = options.apiKey.trim();
    this.apiSecret = options.apiSecret.trim();
    const secretState = parseSecretBlob(options.passphrase);
    this.requestToken = secretState.requestToken || secretState.request_token || null;
    this.accessToken = secretState.accessToken || secretState.access_token || options.accessToken || null;
    this.refreshToken = secretState.refreshToken || secretState.refresh_token || null;
    this.publicToken = secretState.publicToken || secretState.public_token || null;
    this.generatedAt = secretState.generatedAt || secretState.generated_at || null;
    this.client = new KiteConnect({ api_key: this.apiKey, access_token: this.accessToken || undefined });
  }

  async ensureSession() {
    if (this.accessToken) {
      this.client.setAccessToken(this.accessToken);
      return { access_token: this.accessToken };
    }
    if (this.refreshToken) {
      return this.refreshSession();
    }
    if (this.requestToken) {
      return this.initializeSession();
    }
    throw new Error('Zerodha request token is required. Launch the Kite Connect login and paste the request_token before testing.');
  }

  async initializeSession() {
    if (!this.requestToken) {
      throw new Error('Request token missing; re-run the Kite Connect login flow.');
    }
    const session = await this.client.generateSession(this.requestToken, this.apiSecret);
    this.applySession(session, { clearRequestToken: true });
    return session;
  }

  async refreshSession() {
    if (!this.refreshToken) {
      if (this.requestToken) {
        return this.initializeSession();
      }
      throw new Error('Refresh token missing; please relink Zerodha to mint a new session.');
    }
    const session = await this.client.renewAccessToken(this.refreshToken, this.apiSecret);
    this.applySession(session, { clearRequestToken: false });
    return session;
  }

  applySession(session, { clearRequestToken }) {
    if (!session) return;
    this.accessToken = session.access_token || null;
    this.refreshToken = session.refresh_token || this.refreshToken;
    this.publicToken = session.public_token || this.publicToken;
    this.generatedAt = session.login_time || new Date().toISOString();
    if (this.accessToken) {
      this.client.setAccessToken(this.accessToken);
    }
    if (clearRequestToken) {
      this.requestToken = null;
    }
  }

  async callWithSession(op) {
    await this.ensureSession();
    try {
      return await op();
    } catch (error) {
      if (isTokenError(error)) {
        await this.refreshSession();
        return op();
      }
      throw error;
    }
  }

  async testConnectivity() {
    const profile = await this.callWithSession(() => this.client.getProfile());
    return { id: profile?.user_id, name: profile?.user_name };
  }

  async submitSignal(params = {}) {
    const raw = params.raw || {};
    const instrument = parseInstrument({ symbol: params.symbol, exchange: params.exchange, raw });
    if (!instrument.tradingsymbol) {
      throw new Error('Zerodha tradingsymbol is required. Provide a symbol such as NSE:INFY.');
    }
    const quantity = deriveQuantity(params.amount, raw);
    if (!quantity) {
      throw new Error('Quantity is required to place Zerodha orders. Include amount/qty in your alert payload.');
    }
    const transactionType =
      String(params.side || raw.side || '').toLowerCase() === 'sell'
        ? this.client.TRANSACTION_TYPE_SELL
        : this.client.TRANSACTION_TYPE_BUY;
    const inferredType = String(params.type || raw.type || '').toLowerCase();
    let orderType = this.client.ORDER_TYPE_MARKET;
    if (inferredType === 'limit') orderType = this.client.ORDER_TYPE_LIMIT;
    else if (inferredType === 'sl' || inferredType === 'stop') orderType = this.client.ORDER_TYPE_SL;
    else if (inferredType === 'slm' || inferredType === 'stop_market') orderType = this.client.ORDER_TYPE_SLM;
    else if (params.price) orderType = this.client.ORDER_TYPE_LIMIT;
    const price = orderType === this.client.ORDER_TYPE_MARKET ? undefined : Number(params.price);
    const triggerPrice = deriveTriggerPrice(raw, raw.triggerPrice);
    const payload = {
      exchange: instrument.exchange,
      tradingsymbol: instrument.tradingsymbol,
      transaction_type: transactionType,
      quantity,
      order_type: orderType,
      product: deriveProduct(raw, instrument.exchange),
      validity: deriveValidity(raw),
      price: Number.isFinite(price) ? Number(price) : undefined,
      trigger_price: triggerPrice,
      disclosed_quantity: Number(raw.disclosed_quantity || raw.disclosedQuantity) || undefined,
      variety: deriveVariety(raw, this.client),
      tag: buildTag(params.clientOrderId || raw.clientOrderId || raw.tag)
    };
    if (!payload.price) delete payload.price;
    if (!payload.trigger_price) delete payload.trigger_price;
    if (!payload.disclosed_quantity) delete payload.disclosed_quantity;
    if (!payload.tag) delete payload.tag;
    const { variety } = payload;
    delete payload.variety;
    return this.callWithSession(() => this.client.placeOrder(variety, payload));
  }

  exportCredentialState() {
    if (!this.accessToken && !this.refreshToken && !this.requestToken) {
      return null;
    }
    const payload = {
      type: 'kite-connect',
      requestToken: this.requestToken || undefined,
      accessToken: this.accessToken || undefined,
      refreshToken: this.refreshToken || undefined,
      publicToken: this.publicToken || undefined,
      generatedAt: this.generatedAt || new Date().toISOString()
    };
    return { passphrase: JSON.stringify(payload) };
  }
}

export function createZerodhaExchange(options) {
  return new ZerodhaExchange(options);
}
