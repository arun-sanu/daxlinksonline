import { prisma } from '../src/utils/prisma.js';

const DEFAULT_WORKSPACE_ID = '1cf2ee51-ff24-4b38-a7a3-bd0a45a9d0ba';
const BOT_NAME = 'mexc-macd-bollinger-bot';
const LEGACY_BOT_NAMES = ['ARN - HVMS[MEXC]', 'mexc-macd-bollinger', 'mexc-macd-bb-bot'];
const PLAN_NAME = 'MEXC MACD Bollinger Starter';

function parseArg(key, fallback = '') {
  const match = process.argv.find((entry) => entry.startsWith(`--${key}=`));
  if (!match) return fallback;
  return match.slice(key.length + 3);
}

async function ensureBot(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true }
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  let bot = await prisma.bot.findFirst({
    where: {
      workspaceId,
      name: { in: [BOT_NAME, ...LEGACY_BOT_NAMES] }
    }
  });

  if (bot && bot.name !== BOT_NAME) {
    bot = await prisma.bot.update({
      where: { id: bot.id },
      data: { name: BOT_NAME }
    });
  }

  if (!bot) {
    bot = await prisma.bot.create({
      data: {
        workspaceId,
        name: BOT_NAME,
        kind: 'code',
        description:
          'MEXC spot strategy bot (MACD + Bollinger) with linked exchange runtime config, TP/SL risk controls, and backend trade reporting.'
      }
    });
  }

  let latestVersionId = bot.latestVersionId;
  if (!latestVersionId) {
    const version = await prisma.botVersion.create({
      data: {
        botId: bot.id,
        status: 'published',
        sdkVersion: 'python-asyncio-aiohttp',
        notes: JSON.stringify({
          language: 'python',
          entrypoint: 'python-bot/mexc_bot.py',
          originalFilename: 'mexc_bot.py',
          uploadedAt: new Date().toISOString(),
          userNotes: 'Managed marketplace listing for linked MEXC MACD+Bollinger bot'
        })
      }
    });
    latestVersionId = version.id;
    await prisma.bot.update({
      where: { id: bot.id },
      data: { latestVersionId }
    });
  }

  let plan = await prisma.plan.findFirst({
    where: {
      workspaceId,
      name: PLAN_NAME
    }
  });
  if (!plan) {
    plan = await prisma.plan.create({
      data: {
        workspaceId,
        name: PLAN_NAME,
        cpuMilli: 300,
        memMiB: 768,
        priceMonthly: 39,
        active: true
      }
    });
  } else if (!plan.active) {
    plan = await prisma.plan.update({
      where: { id: plan.id },
      data: { active: true }
    });
  }

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    botId: bot.id,
    latestVersionId,
    planId: plan.id
  };
}

async function main() {
  const workspaceId = parseArg('workspaceId', DEFAULT_WORKSPACE_ID);
  const result = await ensureBot(workspaceId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
