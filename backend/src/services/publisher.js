/**
 * Publisher helper for domain events -> notifications
 */
import { notifyEvent } from "../lib/notify/index.js";

/**
 * Publish a domain event for a specific user.
 * @param {string} topic
 * @param {{ userId: string } & Record<string, any>} payload
 */
export async function publish(topic, payload) {
  if (!payload?.userId) throw new Error("publish requires payload.userId");
  return notifyEvent(payload.userId, topic, payload);
}

