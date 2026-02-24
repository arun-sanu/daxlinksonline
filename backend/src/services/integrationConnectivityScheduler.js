import { prisma } from '../utils/prisma.js';
import { testIntegration } from './integrationService.js';
import { publishIntegrationsEvent } from './integrationRealtimeService.js';

const AUTO_TEST_SUCCESS_EVENT = 'integration.auto.test.succeeded';
const AUTO_TEST_FAILED_EVENT = 'integration.auto.test.failed';
const AUTO_TEST_EVENTS = [AUTO_TEST_SUCCESS_EVENT, AUTO_TEST_FAILED_EVENT];
const DEFAULT_PER_DAY = 5;
const DEFAULT_TICK_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_MINUTES = 12;
const DEFAULT_STARTUP_DELAY_MS = 20 * 1000;
const RANDOM_SALT = 'daxlinks-integration-auto-test-v1';

let schedulerHandle = null;
let schedulerRunning = false;

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toUtcMinuteOfDay(date = new Date()) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function hashStringToSeed(input) {
  let hash = 2166136261;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDailyRandomSlots(integrationId, dayKey, count = DEFAULT_PER_DAY) {
  const desiredCount = Math.min(24, Math.max(1, parsePositiveInt(count, DEFAULT_PER_DAY)));
  const seed = hashStringToSeed(`${integrationId}:${dayKey}:${RANDOM_SALT}`);
  const random = mulberry32(seed);
  const slots = new Set();
  while (slots.size < desiredCount) {
    slots.add(Math.floor(random() * 1440));
  }
  return Array.from(slots).sort((a, b) => a - b);
}

function getDayOffsetKey(date = new Date(), days = 0) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return utcDateKey(shifted);
}

function toSlotMarker(dayKey, minute) {
  return `${dayKey}|${String(minute).padStart(4, '0')}`;
}

function extractSlotMarker(detail) {
  const match = /auto_slot=([0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9]{4})/.exec(String(detail || ''));
  return match ? match[1] : null;
}

function formatMinuteLabel(minute) {
  const hh = Math.floor(minute / 60)
    .toString()
    .padStart(2, '0');
  const mm = (minute % 60).toString().padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

function getDueSlotReferences(now = new Date(), lookbackMinutes = DEFAULT_LOOKBACK_MINUTES) {
  const refs = [];
  const currentMinute = toUtcMinuteOfDay(now);
  const lookback = Math.max(1, parsePositiveInt(lookbackMinutes, DEFAULT_LOOKBACK_MINUTES));
  const todayKey = utcDateKey(now);
  const yesterdayKey = getDayOffsetKey(now, -1);

  for (let minute = Math.max(0, currentMinute - lookback); minute <= currentMinute; minute += 1) {
    refs.push({ dayKey: todayKey, minute });
  }

  if (currentMinute < lookback) {
    const spill = lookback - currentMinute;
    for (let minute = Math.max(0, 1440 - spill); minute <= 1439; minute += 1) {
      refs.push({ dayKey: yesterdayKey, minute });
    }
  }

  return refs;
}

export async function runScheduledIntegrationConnectivityChecks(options = {}) {
  const now = options?.now instanceof Date ? options.now : new Date();
  const perDay = parsePositiveInt(options?.perDay ?? process.env.INTEGRATION_AUTO_TESTS_PER_DAY, DEFAULT_PER_DAY);
  const lookbackMinutes = parsePositiveInt(
    options?.lookbackMinutes ?? process.env.INTEGRATION_AUTO_TESTS_LOOKBACK_MINUTES,
    DEFAULT_LOOKBACK_MINUTES
  );
  const dueRefs = getDueSlotReferences(now, lookbackMinutes);
  if (!dueRefs.length) {
    return { checked: 0, triggered: 0, skipped: 0 };
  }

  const dueByDay = new Map();
  for (const ref of dueRefs) {
    const bucket = dueByDay.get(ref.dayKey) || new Set();
    bucket.add(ref.minute);
    dueByDay.set(ref.dayKey, bucket);
  }
  const dayKeys = Array.from(dueByDay.keys()).sort();
  const dayStart = new Date(`${dayKeys[0]}T00:00:00.000Z`);

  const integrations = await prisma.integration.findMany({
    where: {
      status: { not: 'paused' },
      credentials: { some: {} }
    },
    select: {
      id: true,
      workspaceId: true,
      exchange: true,
      status: true
    }
  });
  if (!integrations.length) {
    return { checked: 0, triggered: 0, skipped: 0 };
  }

  const existingEvents = await prisma.credentialEvent.findMany({
    where: {
      integrationId: { in: integrations.map((integration) => integration.id) },
      eventType: { in: AUTO_TEST_EVENTS },
      createdAt: { gte: dayStart, lte: now }
    },
    select: {
      integrationId: true,
      detail: true
    }
  });

  const seenMarkersByIntegration = new Map();
  for (const event of existingEvents) {
    const marker = extractSlotMarker(event.detail);
    if (!marker) continue;
    const bucket = seenMarkersByIntegration.get(event.integrationId) || new Set();
    bucket.add(marker);
    seenMarkersByIntegration.set(event.integrationId, bucket);
  }

  let checked = 0;
  let triggered = 0;
  let skipped = 0;

  for (const integration of integrations) {
    checked += 1;
    const seenMarkers = seenMarkersByIntegration.get(integration.id) || new Set();
    const dueMarkers = [];

    for (const dayKey of dayKeys) {
      const dueMinutes = dueByDay.get(dayKey);
      if (!dueMinutes || dueMinutes.size === 0) continue;
      const scheduledSlots = buildDailyRandomSlots(integration.id, dayKey, perDay);
      for (const minute of scheduledSlots) {
        if (!dueMinutes.has(minute)) continue;
        const marker = toSlotMarker(dayKey, minute);
        if (seenMarkers.has(marker)) continue;
        dueMarkers.push({ marker, minute });
      }
    }

    if (!dueMarkers.length) {
      skipped += 1;
      continue;
    }

    for (const due of dueMarkers) {
      triggered += 1;
      const result = await testIntegration(integration.workspaceId, integration.id, {
        source: 'auto',
        slotMarker: due.marker
      });
      seenMarkers.add(due.marker);

      publishIntegrationsEvent(integration.workspaceId, 'integration.auto-test.report', {
        generatedAt: new Date().toISOString(),
        integrationId: integration.id,
        exchange: integration.exchange,
        status: result?.status || 'error',
        error: result?.error || null,
        slotMarker: due.marker,
        scheduledAt: formatMinuteLabel(due.minute)
      });
    }
  }

  return { checked, triggered, skipped };
}

export function startIntegrationConnectivityScheduler(options = {}) {
  if (schedulerHandle) {
    return { enabled: true, stop: stopIntegrationConnectivityScheduler };
  }

  const envEnabled = String(process.env.INTEGRATION_AUTO_TESTS_ENABLED || 'true').toLowerCase() !== 'false';
  const enabled = options.enabled ?? (envEnabled && process.env.NODE_ENV !== 'test');
  if (!enabled) {
    console.log('[integration:auto-test] disabled');
    return { enabled: false, stop: stopIntegrationConnectivityScheduler };
  }

  const intervalMs = parsePositiveInt(options.intervalMs ?? process.env.INTEGRATION_AUTO_TESTS_INTERVAL_MS, DEFAULT_TICK_MS);
  const startupDelayMs = parsePositiveInt(
    options.startupDelayMs ?? process.env.INTEGRATION_AUTO_TESTS_STARTUP_DELAY_MS,
    DEFAULT_STARTUP_DELAY_MS
  );

  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const summary = await runScheduledIntegrationConnectivityChecks();
      if (summary.triggered > 0) {
        console.log('[integration:auto-test] checks completed', summary);
      }
    } catch (error) {
      console.error('[integration:auto-test] run failed', error?.message || error);
    } finally {
      schedulerRunning = false;
    }
  };

  schedulerHandle = setInterval(() => {
    void tick();
  }, intervalMs);
  setTimeout(() => {
    void tick();
  }, startupDelayMs);
  console.log('[integration:auto-test] started', {
    intervalMs,
    perDay: parsePositiveInt(process.env.INTEGRATION_AUTO_TESTS_PER_DAY, DEFAULT_PER_DAY)
  });

  return { enabled: true, stop: stopIntegrationConnectivityScheduler };
}

export function stopIntegrationConnectivityScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  schedulerRunning = false;
}

