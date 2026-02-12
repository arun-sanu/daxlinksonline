#!/usr/bin/env node
import dotenv from 'dotenv';

dotenv.config();

import { prisma } from '../src/utils/prisma.js';

function readArg(name, fallback = null) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWebhook({ url, host, contentType, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Host: host
    },
    body
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    payload
  };
}

async function main() {
  const subdomain = readArg('subdomain', process.env.TV_SUBDOMAIN || '');
  const secret = readArg('secret', process.env.TV_WEBHOOK_SECRET || '');
  const baseDomain = readArg('base-domain', process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link');
  const apiBase = readArg('api-base', process.env.TV_WEBHOOK_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`);

  if (!subdomain || !secret) {
    throw new Error('Usage: node scripts/sendTvWebhook.js --subdomain <prefix> --secret <secret> [--api-base <url>]');
  }

  const host = `${subdomain}.${baseDomain}`;
  const url = `${apiBase.replace(/\/+$/, '')}/webhook/tradingview?secret=${encodeURIComponent(secret)}`;
  const sample = {
    symbol: 'BTCUSDC',
    side: 'BUY',
    ts: Date.now()
  };

  console.log('Posting TradingView webhook samples...');
  console.log(`Target URL: ${url.replace(secret, '[redacted]')}`);
  console.log(`Host header: ${host}`);

  const jsonResponse = await postWebhook({
    url,
    host,
    contentType: 'application/json',
    body: JSON.stringify(sample)
  });
  console.log('\n[application/json] Response');
  console.log(JSON.stringify(jsonResponse, null, 2));

  const textResponse = await postWebhook({
    url,
    host,
    contentType: 'text/plain',
    body: JSON.stringify({ ...sample, ts: Date.now() })
  });
  console.log('\n[text/plain] Response');
  console.log(JSON.stringify(textResponse, null, 2));

  await sleep(600);

  const dns = await prisma.dnsRecord.findFirst({
    where: {
      subdomain,
      status: 'active'
    },
    select: { userId: true }
  });

  if (!dns) {
    console.log('\nNo active DNS record found for this subdomain.');
    return;
  }

  const latestAudit = await prisma.executionAudit.findFirst({
    where: { userId: dns.userId },
    orderBy: { receivedAt: 'desc' }
  });

  console.log('\nLatest ExecutionAudit row');
  console.log(
    JSON.stringify(
      latestAudit
        ? {
            id: latestAudit.id,
            receivedAt: latestAudit.receivedAt,
            tvTs: latestAudit.tvTs ? Number(latestAudit.tvTs) : null,
            symbol: latestAudit.symbol,
            side: latestAudit.side,
            status: latestAudit.status,
            errorMessage: latestAudit.errorMessage,
            qtyRounded: latestAudit.qtyRounded,
            mexcOrderId: latestAudit.mexcOrderId,
            mexcStatus: latestAudit.mexcStatus
          }
        : null,
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
