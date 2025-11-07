import { prisma } from '../utils/prisma.js';

export async function getFlags() {
  const rows = await prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  return rows;
}

export async function setFlag(key, { enabled, description, audience, rolloutPercent, rules } = {}) {
  const data = {};
  if (enabled !== undefined) data.enabled = Boolean(enabled);
  if (description !== undefined) data.description = description;
  if (audience !== undefined) data.audience = audience;
  if (rolloutPercent !== undefined) data.rolloutPercent = Math.max(0, Math.min(100, Number(rolloutPercent)));
  if (rules !== undefined) data.rules = rules;
  const row = await prisma.featureFlag.upsert({
    where: { key },
    create: { key, ...data },
    update: data
  });
  return row;
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) % 100;
}

export async function evaluateFlag(key, { userId, workspaceId } = {}) {
  const row = await prisma.featureFlag.findUnique({ where: { key } });
  if (!row) return { key, enabled: false, reason: 'not_found' };
  // If explicitly enabled and no rules, it's on
  if (row.enabled && (!row.rolloutPercent || row.rolloutPercent === 0) && !row.audience && !row.rules) {
    return { key, enabled: true, reason: 'enabled' };
  }
  // Rules-based targeting (simple equals on known fields)
  const ctx = { userId: userId || '', workspaceId: workspaceId || '' };
  const rules = row.rules && Array.isArray(row.rules.conditions) ? row.rules.conditions : null;
  if (rules && rules.length) {
    const ok = rules.every((cond) => {
      if (!cond) return false;
      const field = String(cond.field || '').trim();
      const op = String(cond.op || 'equals').toLowerCase();
      const value = String(cond.value ?? '');
      const left = String(ctx[field] ?? '');
      if (op === 'equals') return left === value;
      if (op === 'not_equals') return left !== value;
      return false;
    });
    if (ok) return { key, enabled: true, reason: 'rules' };
  }
  // Audience targeting
  const aud = row.audience || {};
  if (aud.userIds && Array.isArray(aud.userIds) && userId && aud.userIds.includes(userId)) {
    return { key, enabled: true, reason: 'audience_user' };
  }
  if (aud.workspaceIds && Array.isArray(aud.workspaceIds) && workspaceId && aud.workspaceIds.includes(workspaceId)) {
    return { key, enabled: true, reason: 'audience_workspace' };
  }
  // Percentage rollout
  const seed = userId || workspaceId || 'global';
  const pct = row.rolloutPercent || 0;
  if (pct > 0) {
    const bucket = simpleHash(`${key}:${seed}`);
    if (bucket < pct) return { key, enabled: true, reason: `rollout_${pct}` };
  }
  return { key, enabled: Boolean(row.enabled), reason: 'fallback' };
}
