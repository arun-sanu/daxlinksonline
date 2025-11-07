import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/utils/prisma.js';

async function main() {
  const seeds = [
    { key: 'ui.experimental.constellation', enabled: true, description: 'Animated constellation backgrounds in UI' },
    { key: 'beta.webhooks.replay', enabled: true, description: 'Enable webhook replay controls' },
    { key: 'auth.enforce.2fa', enabled: false, description: 'Require 2FA for all admins' }
  ];
  for (const f of seeds) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, update: { enabled: f.enabled, description: f.description }, create: f });
    console.log('Upserted flag', f.key);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });

