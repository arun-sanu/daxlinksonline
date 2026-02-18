import { randomUUID } from 'crypto';

const DEFAULT_HEARTBEAT_MS = 20_000;
const parsedHeartbeatMs = Number(process.env.INTEGRATIONS_STREAM_HEARTBEAT_MS);
const HEARTBEAT_MS =
  Number.isFinite(parsedHeartbeatMs) && parsedHeartbeatMs >= 5_000 ? parsedHeartbeatMs : DEFAULT_HEARTBEAT_MS;
const streamsByWorkspace = new Map();

function writeSse(res, event, payload) {
  if (!res || res.writableEnded || res.destroyed) return false;
  const data = JSON.stringify(payload || {});
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${data}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function removeClient(workspaceId, clientId) {
  const bucket = streamsByWorkspace.get(workspaceId);
  if (!bucket) return;
  bucket.delete(clientId);
  if (bucket.size === 0) {
    streamsByWorkspace.delete(workspaceId);
  }
}

export function openIntegrationsStream(workspaceId, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const clientId = randomUUID();
  const client = { id: clientId, workspaceId, res };
  const bucket = streamsByWorkspace.get(workspaceId) || new Map();
  bucket.set(clientId, client);
  streamsByWorkspace.set(workspaceId, bucket);

  const cleanup = () => {
    clearInterval(heartbeatHandle);
    removeClient(workspaceId, clientId);
  };

  const heartbeatHandle = setInterval(() => {
    if (!client.res || client.res.writableEnded || client.res.destroyed) {
      cleanup();
      return;
    }
    try {
      client.res.write(': heartbeat\n\n');
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);

  writeSse(res, 'connected', {
    workspaceId,
    connectedAt: new Date().toISOString()
  });

  return {
    id: clientId,
    send(event, payload) {
      const ok = writeSse(res, event, payload);
      if (!ok) cleanup();
      return ok;
    },
    close() {
      cleanup();
    }
  };
}

export function publishIntegrationsEvent(workspaceId, event, payload) {
  const bucket = streamsByWorkspace.get(workspaceId);
  if (!bucket || bucket.size === 0) return 0;

  let delivered = 0;
  for (const client of bucket.values()) {
    const ok = writeSse(client.res, event, payload);
    if (ok) {
      delivered += 1;
      continue;
    }
    removeClient(workspaceId, client.id);
  }
  return delivered;
}

export function countIntegrationStreams(workspaceId) {
  if (!workspaceId) {
    let total = 0;
    for (const bucket of streamsByWorkspace.values()) {
      total += bucket.size;
    }
    return total;
  }
  return streamsByWorkspace.get(workspaceId)?.size || 0;
}
