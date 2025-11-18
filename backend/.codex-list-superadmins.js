import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  try {
    const admins = await prisma.user.findMany({
      where: { isSuperAdmin: true },
      select: { id: true, email: true, name: true, role: true, isSuperAdmin: true, createdAt: true, updatedAt: true }
    });
    console.log(JSON.stringify(admins, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
