import { prisma } from '../src/utils/prisma.js';

const DEFAULT_WORKSPACE_ID = '1cf2ee51-ff24-4b38-a7a3-bd0a45a9d0ba';
const BOT_NAME = 'ARN -S&SHCS [Orginal]';
const LEGACY_BOT_NAMES = ['moneyplantbot1-robot'];
const PLAN_NAME = 'ARN S&SHCS Original Starter';

function parseArg(key, fallback = '') {
  const match = process.argv.find((entry) => entry.startsWith(`--${key}=`));
  if (!match) return fallback;
  return match.slice(key.length + 3);
}

async function ensureArnSshcsOriginalBot(workspaceId) {
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
          'Pine-faithful ARN FastAPI bot with cooldown, EOD close, loss guardrail, and TP/SL execution controls.'
      }
    });
  }

  let latestVersionId = bot.latestVersionId;
  if (!latestVersionId) {
    const version = await prisma.botVersion.create({
      data: {
        botId: bot.id,
        status: 'published',
        sdkVersion: 'python-fastapi',
        notes: JSON.stringify({
          language: 'python',
          entrypoint: 'python-bot/arn_bot_service_pine_faithful.py',
          originalFilename: 'arn_bot_service_pine_faithful.py',
          uploadedAt: new Date().toISOString(),
          userNotes: 'Managed marketplace listing for ARN Pine-faithful strategy bot'
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
        priceMonthly: 59,
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
  const result = await ensureArnSshcsOriginalBot(workspaceId);
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
