import type { ExchangeAccount } from '@prisma/client';
import { decrypt } from './kms.js';
import { placeSandboxOrder } from './pendax.js';

export type PendaxOrderPayload = {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP';
  price?: number;
  qty: number;
  idempotencyKey?: string;
};

export type PendaxOrderResponse = {
  id: string | null;
  venue: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP';
  price?: number;
  qty: number;
  idempotencyKey?: string | null;
  status?: string;
};

export interface PendaxClient {
  placeOrder(order: PendaxOrderPayload): Promise<PendaxOrderResponse>;
}

export type GetPendaxClient = (exchangeAccount: ExchangeAccount) => Promise<PendaxClient>;

function b64ToBuf(raw?: string | null): Buffer {
  try {
    return Buffer.from(String(raw ?? ''), 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Hydrates a Pendax client for a specific exchange account by decrypting the
 * credential blobs that are managed via Vault/KMS.
 *
 * Note: the runtime implementation for Node lives in pendaxClient.js; keep the
 * logic mirrored to ensure TS-aware tooling has the same contract.
 */
export async function getPendaxClient(exchangeAccount: ExchangeAccount): Promise<PendaxClient> {
  if (!exchangeAccount) {
    throw new Error('Missing exchange account');
  }

  const apiKey = exchangeAccount.apiKeyEnc ? decrypt(b64ToBuf(exchangeAccount.apiKeyEnc)) : '';
  const apiSecret = exchangeAccount.apiSecretEnc ? decrypt(b64ToBuf(exchangeAccount.apiSecretEnc)) : '';
  const passphrase = exchangeAccount.passphraseEnc ? decrypt(b64ToBuf(exchangeAccount.passphraseEnc)) : undefined;

  void apiKey;
  void apiSecret;
  void passphrase;

  return {
    async placeOrder({ symbol, side, type, price, qty, idempotencyKey }: PendaxOrderPayload): Promise<PendaxOrderResponse> {
      return placeSandboxOrder({
        venue: exchangeAccount.venue || 'sandbox',
        symbol,
        side,
        type,
        price,
        qty,
        idempotencyKey
      });
    }
  };
}
