import bcrypt from 'bcryptjs';
import { prisma } from '../src/utils/prisma.js';
import { ensureTrialWebhook } from '../src/services/tradingviewService.js';
import { maskCredential, createCredentialReference } from '../src/services/workspaceService.js';
import { encrypt } from '../src/lib/kms.js';

async function main() {
  const existing = await prisma.workspace.findFirst();
  if (existing) {
    console.log('Workspace already exists, skipping seed.');
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: 'Demo Operator',
      email: 'operator@compendium.finance',
      passwordHash: await bcrypt.hash('pendax-demo-password', 12),
      role: 'superadmin',
      isSuperAdmin: true,
      emailVerified: true
    }
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Compendium Trading Desk',
      slug: 'compendium',
      planTier: 'Professional',
      teamSize: '6-15',
      primaryUseCase: 'execution',
      region: 'amer',
      ownerId: user.id
    }
  });

  const integration = await prisma.integration.create({
    data: {
      workspaceId: workspace.id,
      exchange: 'okx',
      environment: 'paper',
      apiKeyMasked: maskCredential('okx-demo-key'),
      passphraseMasked: maskCredential('demo-pass'),
      credentialRef: createCredentialReference('okx-demo-secret'),
      rateLimit: 5,
      bandwidth: '1.2 Mbps',
      status: 'active',
      lastTestedAt: new Date()
    }
  });

  // Encrypt credentials in dev too (fallback only if KMS_KEY not configured)
  try {
    const encKey = encrypt('okx-demo-key');
    const encSecret = encrypt('okx-demo-secret');
    const encPass = encrypt('demo-pass');
    await prisma.integrationCredential.create({
      data: {
        integrationId: integration.id,
        apiKey: encKey.data,
        apiSecret: encSecret.data,
        passphrase: encPass.data,
        iv: encKey.iv
      }
    });
  } catch (e) {
    // Fallback for first-run without KMS_KEY
    await prisma.integrationCredential.create({
      data: {
        integrationId: integration.id,
        apiKey: Buffer.from('okx-demo-key', 'utf8'),
        apiSecret: Buffer.from('okx-demo-secret', 'utf8'),
        passphrase: Buffer.from('demo-pass', 'utf8'),
        iv: Buffer.alloc(12)
      }
    });
  }

  await prisma.webhook.create({
    data: {
      workspaceId: workspace.id,
      name: 'TradingView Alerts',
      url: 'https://example.com/hooks/tradingview',
      method: 'POST',
      signingSecretRef: createCredentialReference('dummy-secret'),
      events: ['signal.triggered', 'signal.cleared'],
      active: true
    }
  });

  // Ensure trial webhook details for the demo user
  await ensureTrialWebhook(user.id);

  await prisma.adminSession.create({
    data: {
      workspaceId: workspace.id,
      location: 'Frankfurt, DE',
      device: 'Dashboard • Chrome',
      ip: '185.12.62.4'
    }
  });

  console.log('Seed data created successfully.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
