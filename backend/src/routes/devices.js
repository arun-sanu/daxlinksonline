import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Device registration and token lifecycle routes.
 */
export const devicesRouter = Router();
devicesRouter.use(requireAuth);

devicesRouter.post("/register", async (req, res) => {
  const { fcmToken, appVersion, sdkInt, model, workspaceId } = req.body || {};
  if (!fcmToken) return res.status(400).json({ error: "fcmToken required" });
  const device = await prisma.device.upsert({
    where: { userId_fcmToken: { userId: req.user.id, fcmToken } },
    update: { appVersion, sdkInt, model, status: "ACTIVE", lastSeenAt: new Date(), workspaceId },
    create: { userId: req.user.id, fcmToken, appVersion, sdkInt, model, platform: "ANDROID", status: "ACTIVE", workspaceId }
  });
  await prisma.pushTokenHistory.create({ data: { deviceId: device.id, fcmToken } });
  res.json({ ok: true, deviceId: device.id });
});

devicesRouter.post("/refresh-token", async (req, res) => {
  const { oldToken, newToken } = req.body || {};
  if (!oldToken || !newToken) return res.status(400).json({ error: "tokens required" });
  const dev = await prisma.device.findFirst({ where: { userId: req.user.id, fcmToken: oldToken, status: "ACTIVE" } });
  if (!dev) return res.json({ ok: true });
  await prisma.pushTokenHistory.updateMany({
    where: { deviceId: dev.id, fcmToken: oldToken, invalidatedAt: null },
    data: { invalidatedAt: new Date() }
  });
  await prisma.device.update({ where: { id: dev.id }, data: { fcmToken: newToken, updatedAt: new Date() } });
  await prisma.pushTokenHistory.create({ data: { deviceId: dev.id, fcmToken: newToken } });
  res.json({ ok: true });
});

devicesRouter.post("/revoke", async (req, res) => {
  const { fcmToken } = req.body || {};
  await prisma.device.updateMany({ where: { userId: req.user.id, fcmToken }, data: { status: "REVOKED" } });
  res.json({ ok: true });
});

