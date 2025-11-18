// Dev orchestrator abstraction: mock/docker/k8s via ORCHESTRATOR_MODE
// For Phase 6 we expose a runtime driver that simulates container lifecycle,
// logs, and metrics. Docker/K8s modes currently share the same lightweight
// implementation so the API surface matches across environments.

const mode = (process.env.ORCHESTRATOR_MODE || 'mock').toLowerCase();
const MAX_LOGS = 500;
const state = new Map();

function ensureEntry(instanceId) {
  if (!state.has(instanceId)) {
    state.set(instanceId, {
      running: false,
      startedAt: null,
      cpuMilli: 250,
      memMiB: 256,
      logs: [],
      lastSample: null
    });
  }
  return state.get(instanceId);
}

function appendLog(instanceId, level, msg) {
  const ent = ensureEntry(instanceId);
  ent.logs.push({ ts: new Date().toISOString(), level, msg });
  if (ent.logs.length > MAX_LOGS) {
    ent.logs.splice(0, ent.logs.length - MAX_LOGS);
  }
}

function createDriver(label) {
  return {
    async startInstance({ instanceId, imageRef, cpuMilli = 250, memMiB = 256 }) {
      const ent = ensureEntry(instanceId);
      ent.running = true;
      ent.startedAt = new Date();
      ent.cpuMilli = cpuMilli;
      ent.memMiB = memMiB;
      appendLog(instanceId, 'info', `[${label}] Starting ${imageRef || 'image'} @ ${cpuMilli}m/${memMiB}MiB`);
      return { ok: true, mode: label };
    },
    async stopInstance(instanceId) {
      const ent = ensureEntry(instanceId);
      ent.running = false;
      appendLog(instanceId, 'info', `[${label}] Stopped container`);
      return { ok: true, mode: label };
    },
    async getLogs(instanceId, tail = 100) {
      const ent = ensureEntry(instanceId);
      if (ent.running && Math.random() < 0.35) {
        appendLog(instanceId, 'debug', 'Heartbeat OK');
      }
      return { items: ent.logs.slice(-tail) };
    },
    async getMetrics(instanceId, window = '5m') {
      const ent = ensureEntry(instanceId);
      const points = Math.min(20, Math.max(5, window === '1m' ? 6 : 12));
      const now = Date.now();
      const cpu = [];
      const mem = [];
      for (let i = points - 1; i >= 0; i--) {
        const ts = new Date(now - i * 5000).toISOString();
        const cpuPct = ent.running ? Math.max(0, Math.min(100, 5 + Math.random() * 35)) : 0;
        const memMb = ent.running ? Math.max(0, ent.memMiB * (0.35 + Math.random() * 0.25)) : 0;
        cpu.push({ ts, value: Number(cpuPct.toFixed(1)) });
        mem.push({ ts, value: Math.round(memMb) });
      }
      return { cpu, memMiB: mem };
    }
  };
}

const drivers = {
  mock: createDriver('mock'),
  docker: createDriver('docker'),
  k8s: createDriver('k8s')
};

const driver = drivers[mode] || drivers.mock;

export async function startInstance(params) {
  return driver.startInstance(params);
}

export async function stopInstance(instanceId) {
  return driver.stopInstance(instanceId);
}

export async function getLogs(instanceId, tail = 100) {
  return driver.getLogs(instanceId, tail);
}

export async function getMetrics(instanceId, window = '5m') {
  return driver.getMetrics(instanceId, window);
}
