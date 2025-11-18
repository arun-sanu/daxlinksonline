export type GuardrailEventType = 'signature_ok' | 'signature_fail' | 'rate_limit' | 'guardrail_violation' | 'loss_cap';

export type VenueMeta = {
  priceTick?: number;
  qtyStep?: number;
  minNotional?: number;
  maxOrderQty?: number;
};

export class GuardrailError extends Error {
  guardrailCode: string;
  status?: number;
  constructor(message: string, code?: string, status?: number);
}

export declare function roundPriceQty(meta: VenueMeta | undefined, price?: number, qty?: number): { price: number | undefined; qty: number | undefined };
export declare function assertVenueFilters(meta: VenueMeta | undefined, minNotional: number | undefined, price?: number, qty?: number): boolean;
export declare function assertDailyLossCap(botInstanceId: string): Promise<void>;
export declare function recordGuardrailEvent(botInstanceId: string, type: GuardrailEventType, detail?: string | null): Promise<void>;
export declare function logSignatureEvent(botInstanceId: string, ok: boolean, detail?: string | null): Promise<void>;
export declare function logRateLimitEvent(botInstanceId: string, detail?: string | null): Promise<void>;
export declare function logGuardrailViolation(botInstanceId: string, detail?: string | null): Promise<void>;
