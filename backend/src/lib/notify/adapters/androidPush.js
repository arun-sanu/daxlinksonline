/**
 * Android FCM adapter
 * Initializes firebase-admin using ADC or GOOGLE_APPLICATION_CREDENTIALS.
 */
import admin from "firebase-admin";

let ready = false;
export function initFcm() {
  if (!ready) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    ready = true;
  }
}

/**
 * Send data message to one or more Android device tokens.
 * @param {string[]} tokens
 * @param {Record<string,string>} data
 * @returns {Promise<{ok: boolean, sent: number, failed: number}>}
 */
export async function sendAndroid(tokens = [], data = {}) {
  if (!tokens.length) return { ok: true, sent: 0, failed: 0 };
  const res = await admin.messaging().sendEachForMulticast({
    tokens, data, android: { priority: "high" }
  });
  return { ok: true, sent: res.successCount, failed: res.failureCount };
}

