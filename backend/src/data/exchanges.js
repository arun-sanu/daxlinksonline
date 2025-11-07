// Canonical list of supported exchanges and UI metadata
export const AVAILABLE_EXCHANGES = [
  { id: 'okx', name: 'OKX', tagline: 'Unified margin + derivatives', icon: '🪐', regions: ['Global'], latency: '35 ms', requiresPassphrase: true },
  { id: 'bybit', name: 'Bybit', tagline: 'Institutions & pro traders', icon: '🚀', regions: ['Global'], latency: '42 ms', requiresPassphrase: false },
  { id: 'binance', name: 'Binance', tagline: 'Spot + futures liquidity leader', icon: '🟡', iconUrl: '/assets/binance.svg', regions: ['Global'], latency: '28 ms', requiresPassphrase: false },
  { id: 'mexc', name: 'MEXC', tagline: 'Deep liquidity altcoin venue', icon: '🌊', regions: ['Global'], latency: '40 ms', requiresPassphrase: false },
  { id: 'kucoin', name: 'KuCoin', tagline: 'Spot and futures for long-tail assets', icon: '🟢', regions: ['Global'], latency: '41 ms', requiresPassphrase: false },
  { id: 'huobi', name: 'Huobi', tagline: 'Established venue with deep liquidity', icon: '🔥', regions: ['Global'], latency: '43 ms', requiresPassphrase: false },
  { id: 'phemex', name: 'Phemex', tagline: 'Derivatives with competitive fees', icon: '💠', regions: ['Global'], latency: '47 ms', requiresPassphrase: false },
  { id: 'bitget', name: 'Bitget', tagline: 'Copy trading automation', icon: '🧩', regions: ['Global'], latency: '39 ms', requiresPassphrase: true },
  { id: 'blofin', name: 'Blofin', tagline: 'Institutional custodial exchange', icon: '🏦', regions: ['Global'], latency: '44 ms', requiresPassphrase: false }
];
