/**
 * Notification dispatcher worker placeholder.
 * Future: consume BullMQ queues here.
 */

export async function startNotificationWorker() {
  // For now, synchronous dispatch from notifyEvent; no queue loop yet.
  console.log("[notify] worker started");
}

