export interface BrokerOrderPayload {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP';
  price?: number;
  qty: number;
  idempotencyKey: string;
}

export { router, preflightValidateOrder, ensureInstanceScope } from './broker.js';
