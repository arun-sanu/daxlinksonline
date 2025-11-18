import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Notification Preferences routes
 */
export const notifyPrefsRouter = Router();
notifyPrefsRouter.use(requireAuth);

notifyPrefsRouter.get("/", async (req, res) => {
  const pref = await prisma.notificationPreference.findUnique({ where: { userId: req.user.id } });
  res.json({ ok: true, pref });
});

notifyPrefsRouter.put("/", async (req, res) => {
  const data = req.body || {};
  const pref = await prisma.notificationPreference.upsert({
    where: { userId: req.user.id },
    update: data,
    create: { userId: req.user.id, ...data }
  });
  res.json({ ok: true, pref });
});

