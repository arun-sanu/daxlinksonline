import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../utils/prisma.js';
import { deleteDnsRecordById } from '../services/dnsService.js';
import { sendMail } from '../lib/mailer.js';
import { renderTrialExpiryWarning } from '../emails/trialExpiryTemplate.js';

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

async function emailWarnings() {
  const now = new Date();
  const in24h = new Date(Date.now() + 24 * 3600 * 1000);
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      trialEndsAt: { gte: now, lte: in24h }
    },
    select: { id: true, email: true, name: true, webhookSubdomain: true, trialEndsAt: true }
  });
  for (const u of users) {
    try {
      const html = renderTrialExpiryWarning({ name: u.name, subdomain: u.webhookSubdomain, baseDomain: process.env.WEBHOOK_BASE_DOMAIN });
      await sendMail({ to: u.email, subject: 'Your webhook will stop in 24h — upgrade now', html, text: 'Your webhook will stop in 24h — upgrade now' });
    } catch (err) {
      console.error('Email warn failed', u.email, err?.message || err);
    }
  }
  console.log(`Warned ${users.length} user(s) of pending trial expiry.`);
}

async function deactivateExpired() {
  const now = new Date();
  const expired = await prisma.user.findMany({
    where: { isActive: true, trialEndsAt: { lt: now } },
    select: { id: true }
  });
  if (expired.length === 0) return console.log('No expired users.');
  const ids = expired.map((u) => u.id);
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
  console.log(`Deactivated ${ids.length} expired user(s).`);

  // Cleanup Cloudflare A records
  const records = await prisma.dnsRecord.findMany({ where: { userId: { in: ids } } });
  for (const rec of records) {
    try {
      await deleteDnsRecordById(rec.cloudflareId);
    } catch (err) {
      console.error('Cloudflare delete failed', rec.id, err?.message || err);
    }
  }
  await prisma.dnsRecord.deleteMany({ where: { userId: { in: ids } } });
  console.log(`Deleted ${records.length} DNS record(s).`);
}

async function main() {
  await emailWarnings();
  await deactivateExpired();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

