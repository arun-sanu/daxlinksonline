import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const SOURCE_URL = process.env.TRADINGVIEW_IPS_URL || '';
const OUT_FILE = process.env.TRADINGVIEW_IPS_FILE || path.join(process.cwd(), 'backend', '.cache', 'tradingview_ips.json');

function ensureDir(filepath) {
  const dir = path.dirname(filepath);
  fs.mkdirSync(dir, { recursive: true });
}

function extractIps(text) {
  const ips = new Set();
  const ipv4 = /\b(\d{1,3})(?:\.(\d{1,3})){3}\b/g; // basic IPv4
  const cidr = /\b(\d{1,3})(?:\.(\d{1,3})){3}\/\d{1,2}\b/g; // IPv4 CIDR
  for (const m of text.matchAll(cidr)) ips.add(m[0]);
  for (const m of text.matchAll(ipv4)) ips.add(m[0]);
  // filter invalid octets
  const valid = [...ips].filter((s) => {
    if (s.includes('/')) {
      const [base, bitsStr] = s.split('/');
      const bits = Number(bitsStr);
      if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
      const parts = base.split('.').map((x) => Number(x));
      return parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
    }
    const parts = s.split('.').map((x) => Number(x));
    return parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
  });
  return Array.from(new Set(valid));
}

async function main() {
  if (!SOURCE_URL) {
    console.log('TRADINGVIEW_IPS_URL not set; skipping update.');
    return;
  }
  const resp = await fetch(SOURCE_URL);
  const text = await resp.text();
  const ips = extractIps(text);
  if (ips.length === 0) {
    throw new Error('No IPs found in source');
  }
  ensureDir(OUT_FILE);
  fs.writeFileSync(OUT_FILE, JSON.stringify(ips, null, 2));
  console.log(`Updated TradingView IPs (${ips.length}) → ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

