import fs from 'fs';
import path from 'path';

let cached = null;
let lastLoad = 0;
const RELOAD_MS = 5 * 60 * 1000; // reload from file at most every 5 min

function parseEnvIps() {
  const raw = process.env.TRADINGVIEW_IPS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getIpsFilePath() {
  return process.env.TRADINGVIEW_IPS_FILE || path.join(process.cwd(), 'backend', '.cache', 'tradingview_ips.json');
}

function loadFileIps() {
  try {
    const file = getIpsFilePath();
    if (!fs.existsSync(file)) return [];
    const buf = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(buf);
    if (Array.isArray(arr)) return arr.map((s) => String(s)).filter(Boolean);
  } catch {}
  return [];
}

function loadIps() {
  const envIps = parseEnvIps();
  const fileIps = loadFileIps();
  return Array.from(new Set([...envIps, ...fileIps]));
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function matchCidr(ip, cidr) {
  const [block, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const blockInt = ipv4ToInt(block);
  if (ipInt === null || blockInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (blockInt & mask);
}

export function isAllowedIp(ip) {
  const now = Date.now();
  if (!cached || now - lastLoad > RELOAD_MS) {
    cached = loadIps();
    lastLoad = now;
  }
  if (!cached || cached.length === 0) return false;
  // Exact or CIDR
  for (const entry of cached) {
    if (entry.includes('/')) {
      if (matchCidr(ip, entry)) return true;
    } else if (entry === ip) {
      return true;
    }
  }
  return false;
}

export function getAllowedIps() {
  if (!cached) cached = loadIps();
  return cached.slice();
}

