import crypto from 'crypto';

// 32-byte base64-encoded key (e.g., from a secrets manager)
const b64 = process.env.KMS_KEY || '';
const MASTER_KEY = b64 ? Buffer.from(b64, 'base64') : null;

function ensureKey() {
  if (!MASTER_KEY || MASTER_KEY.length !== 32) {
    throw new Error('KMS_KEY is not set or invalid (expected 32-byte base64)');
  }
}

export function encrypt(text) {
  ensureKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as [iv | tag | ciphertext] to be self-contained
  return { data: Buffer.concat([iv, tag, ciphertext]), iv };
}

export function decrypt(blob) {
  ensureKey();
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ciphertext = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
  decipher.setAuthTag(tag);
  const part = decipher.update(ciphertext);
  const final = Buffer.concat([part, decipher.final()]);
  return final.toString('utf8');
}

