import { Router } from "express";
import { publish } from "../services/publisher.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Debug utilities for notifications
 */
export const notifyDebugRouter = Router();
notifyDebugRouter.use(requireAuth);

notifyDebugRouter.get("/telegram-test", async (req, res) => {
  await publish("bot.trade.executed", {
    userId: req.user.id,
    workspace: "metawave",
    pair: "BTC/USDC",
    botName: "ARN-001",
    botId: "b_7f3a",
    side: "LONG",
    qty: 0.015,
    price: 64200,
    fillPct: 100,
    fees: 0.32,
    pnlPct: 0.48,
    pnlQuote: 12.55,
    walletBalance: 3214.77,
    ts: new Date().toISOString()
  });
  res.json({ ok: true });
});

