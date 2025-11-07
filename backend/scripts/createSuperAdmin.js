#!/usr/bin/env node
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (!value) continue;
    const normalizedKey = key.replace(/^--/, '');
    result[normalizedKey] = value;
  }
  return result;
}

async function main() {
  const { email, password, name = 'Super Admin' } = parseArgs();
  if (!email || !password) {
    console.error('Usage: npm run create:super-admin -- --email=user@example.com --password=StrongPassword [--name="Name"]');
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        passwordHash,
        role: 'superadmin',
        isSuperAdmin: true,
        emailVerified: true
      }
    });
    console.log(`Updated existing user ${normalizedEmail} to super admin.`);
  } else {
    await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        role: 'superadmin',
        isSuperAdmin: true,
        emailVerified: true
      }
    });
    console.log(`Created new super admin ${normalizedEmail}.`);
  }
}

main()
  .catch((error) => {
    console.error('Failed to create super admin:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
