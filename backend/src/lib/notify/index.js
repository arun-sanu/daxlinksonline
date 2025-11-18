/**
 * High-level Notification API
 * - Persists events and deliveries
 * - Chooses channel per policy
 * - Adapts payloads to channels
 */
import { prisma } from "../../utils/prisma.js";
import { sendTelegram } from "./adapters/telegram.js";
import { initFcm, sendAndroid } from "./adapters/androidPush.js";
import { topicAllowed, chooseChannel } from "./policyEngine.js";
import { toAndroidData, toTelegramText } from "./render.js";
import crypto from "node:crypto";

const memDedupe = new Map();
const TTL = 60_000; // 60 seconds in-memory dedupe

function dedupe(key) {
  const now = Date.now();
  const last = memDedupe.get(key);
  if (last && now - last < TTL) return true;
  memDedupe.set(key, now);
  return false;
}

/**
 * Publish a domain event for a user and dispatch notification if allowed.
 * @param {string} userId
 * @param {string} topic
 * @param {Record<string, any>} payload
 */
export async function notifyEvent(userId, topic, payload) {
  const evt = await prisma.notificationEvent.create({
    data: { userId, topic, payload }
  });

  const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!topicAllowed(topic, prefs)) {
    await record(evt.id, "ANDROID", "SUPPRESSED", null, "pref_off");
    return { ok: true, suppressed: true };
  }

  const key = crypto.createHash("sha1").update(`${userId}|${topic}|${JSON.stringify(payload)}`).digest("hex");
  if (dedupe(key)) {
    await record(evt.id, "ANDROID", "SUPPRESSED", null, "dedupe");
    return { ok: true, suppressed: true };
  }

  const devices = await prisma.device.findMany({ where: { userId, status: "ACTIVE" } });
  const telegramChatId = await getTelegramChatId(userId);
  const channel = chooseChannel({ hasAndroid: devices.length > 0, hasTelegram: !!telegramChatId, preferred: prefs?.preferred });

  if (channel === "ANDROID") {
    initFcm();
    const tokens = devices.map((d) => d.fcmToken);
    const res = await sendAndroid(tokens, toAndroidData(topic, payload));
    await record(evt.id, "ANDROID", "SENT", null, res.failed ? `failed:${res.failed}` : null);
    if (res.sent === 0 && telegramChatId) {
      const text = toTelegramText(topic, payload);
      const tg = await sendTelegram(telegramChatId, payload.title || "Alert", text);
      await record(evt.id, "TELEGRAM", tg.ok ? "SENT" : "FAILED", tg.id, tg.error || null);
    }
    return { ok: true };
  }

  if (channel === "TELEGRAM" && telegramChatId) {
    const text = toTelegramText(topic, payload);
    const tg = await sendTelegram(telegramChatId, payload.title || "Alert", text);
    await record(evt.id, "TELEGRAM", tg.ok ? "SENT" : "FAILED", tg.id, tg.error || null);
    return { ok: tg.ok };
  }

  await record(evt.id, "ANDROID", "SUPPRESSED", null, "no_contact");
  return { ok: true, suppressed: true };
}

async function record(eventId, channel, status, providerMessageId, errorText) {
  await prisma.notificationDelivery.create({
    data: { eventId, channel, status, providerMessageId, errorText, lastAttemptAt: new Date() }
  });
}

async function getTelegramChatId(_userId) {
  // Implement lookup via user profile or a linkage table in future.
  // Temporary fallback to default chat for admin testing:
  return process.env.TELEGRAM_DEFAULT_CHAT_ID || null;
}

