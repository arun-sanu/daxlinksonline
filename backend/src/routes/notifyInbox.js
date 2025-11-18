import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const notifyInboxRouter = Router();
notifyInboxRouter.use(requireAuth);

// GET /api/v1/notify/inbox?limit=50&since=<ISO>
notifyInboxRouter.get("/inbox", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);
  const since = req.query.since ? new Date(String(req.query.since)) : null;

  const events = await prisma.notificationEvent.findMany({
    where: {
      userId: req.user.id,
      ...(since ? { createdAt: { gte: since } } : {})
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  const ids = events.map((e) => e.id);
  const deliveries = ids.length
    ? await prisma.notificationDelivery.findMany({
        where: { eventId: { in: ids } },
        orderBy: { createdAt: "desc" }
      })
    : [];
  const latestByEvent = new Map();
  for (const d of deliveries) if (!latestByEvent.has(d.eventId)) latestByEvent.set(d.eventId, d);

  const items = events.map((e) => {
    const d = latestByEvent.get(e.id);
    const p = e.payload || {};
    return {
      id: e.id,
      title: p.title || (e.topic || "Alert").toUpperCase(),
      body: [
        p.pair && `Pair: ${p.pair}`,
        p.botName && `Bot: ${p.botName}${p.botId ? ` (${p.botId})` : ""}`,
        p.side && `Side: ${p.side}`,
        p.qty != null && `Qty: ${p.qty}`,
        p.price != null && `Price: ${p.price}`,
        p.pnlPct != null && `PnL: ${p.pnlPct}%`,
        p.walletBalance != null && `Wallet: ${p.walletBalance}`
      ]
        .filter(Boolean)
        .join(" · "),
      ts: e.createdAt,
      status: d?.status || "SENT",
      channel: d?.channel || null
    };
  });

  res.json({ ok: true, items });
});

