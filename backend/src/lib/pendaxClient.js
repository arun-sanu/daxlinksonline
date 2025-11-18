import { decrypt } from './kms.js';
import { placeSandboxOrder } from './pendax.js';

function b64ToBuf(s) {
  try {
    return Buffer.from(String(s || ''), 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

export async function getPendaxClient(exchangeAccount) {
  if (!exchangeAccount) throw new Error('Missing exchange account');
  // Decrypt credentials from base64-encoded blobs
  const apiKey = exchangeAccount.apiKeyEnc ? decrypt(b64ToBuf(exchangeAccount.apiKeyEnc)) : '';
  const apiSecret = exchangeAccount.apiSecretEnc ? decrypt(b64ToBuf(exchangeAccount.apiSecretEnc)) : '';
  const passphrase = exchangeAccount.passphraseEnc ? decrypt(b64ToBuf(exchangeAccount.passphraseEnc)) : undefined;

  // TODO: return real Pendax client when wiring SDK + broker
  return {
    placeOrder: async ({ symbol, side, type, price, qty, idempotencyKey }) => {
      return placeSandboxOrder({ venue: exchangeAccount.venue || 'sandbox', symbol, side, type, price, qty, idempotencyKey });
    }
  };
}

