// Default exchange catalog for the UI. Used as a fallback
// when the backend bootstrap does not provide `availableExchanges`.
// Keep this list in sync with backend/src/services/dashboardService.js
export const DEFAULT_EXCHANGES = [
  { id: 'okx', name: 'OKX', tagline: 'Unified margin + derivatives', icon: '🪐', iconUrl: '/assets/okx.svg', regions: ['Global'], latency: '35 ms', requiresPassphrase: true },
  { id: 'bybit', name: 'Bybit', tagline: 'Institutions & pro traders', icon: '🚀', iconUrl: '/assets/bybit.svg', regions: ['Global'], latency: '42 ms', requiresPassphrase: false },
  { id: 'binance', name: 'Binance', tagline: 'Spot + futures liquidity leader', icon: '🟡', iconUrl: '/assets/binance.svg', regions: ['Global'], latency: '28 ms', requiresPassphrase: false },
  { id: 'mexc', name: 'MEXC', tagline: 'Deep liquidity altcoin venue', icon: '🌊', iconUrl: '/assets/mexc.svg', regions: ['Global'], latency: '40 ms', requiresPassphrase: false },
  { id: 'kucoin', name: 'KuCoin', tagline: 'Spot and futures for long-tail assets', icon: '🟢', iconUrl: '/assets/kucoin.svg', regions: ['Global'], latency: '41 ms', requiresPassphrase: false },
  { id: 'huobi', name: 'Huobi', tagline: 'Established venue with deep liquidity', icon: '🔥', regions: ['Global'], latency: '43 ms', requiresPassphrase: false },
  { id: 'phemex', name: 'Phemex', tagline: 'Derivatives with competitive fees', icon: '💠', iconUrl: '/assets/phemex.svg', regions: ['Global'], latency: '47 ms', requiresPassphrase: false },
  { id: 'bitget', name: 'Bitget', tagline: 'Copy trading automation', icon: '🧩', iconUrl: '/assets/bitget.svg', regions: ['Global'], latency: '39 ms', requiresPassphrase: true },
  { id: 'blofin', name: 'Blofin', tagline: 'Institutional custodial exchange', icon: '🏦', iconUrl: '/assets/blofin.svg', regions: ['Global'], latency: '44 ms', requiresPassphrase: false },
  {
    id: 'zerodha',
    name: 'Zerodha Kite',
    tagline: 'India NSE/BSE equities & derivatives via Kite Connect',
    icon: '🪁',
    iconUrl: '/assets/zerodha.svg',
    regions: ['India'],
    latency: '90 ms',
    credentials: {
      passphrase: {
        label: 'Request token',
        placeholder: 'kiteconnect request_token',
        helper: 'Complete Kite Connect login, copy the request_token query param, and paste it here so DaxLinks can mint access+refresh tokens.'
      }
    },
    setupGuide: {
      title: 'Kite Connect workflow',
      summary: 'Kite Connect requires a one-time request_token that is immediately exchanged for daily access_token and refresh_token pairs. DaxLinks encrypts the resulting tokens and refreshes them when sessions expire.',
      steps: [
        'Create a Kite Connect app at https://developers.kite.trade/apps and enable order placement.',
        'Set the redirect URL to your DaxLinks callback (e.g. https://daxlinks.online/oauth/zerodha/callback) so the request_token returns to your workspace.',
        'Open https://kite.trade/connect/login?api_key={{apiKey}}&v=3, finish Zerodha login, and grab the request_token value from the redirected URL.',
        'Paste the request token below, click Connect, then Test — DaxLinks exchanges it for access_token, public_token, and refresh_token automatically.'
      ],
      docs: [
        { label: 'Kite Connect docs', href: 'https://kite.trade/docs/connect/v3/' },
        { label: 'Official JS SDK on GitHub', href: 'https://github.com/zerodha/kiteconnectjs' }
      ],
      loginUrlTemplate: 'https://kite.trade/connect/login?api_key={{apiKey}}&v=3'
    }
  }
];
