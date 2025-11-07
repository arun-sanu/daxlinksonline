import { getConfig } from './config.js';
import { getAuthToken } from './apiClient.js';

function ensureBaseUrl() {
  const cfg = getConfig();
  if (!cfg.apiBaseUrl) throw new Error('API base URL not configured');
  return cfg.apiBaseUrl.replace(/\/$/, '');
}

async function http(path, options = {}) {
  const base = ensureBaseUrl();
  const controller = new AbortController();
  const cfg = getConfig();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs || 10000);
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getAuthToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { ...options, headers, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Request failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function listDatabases({ page = 1, pageSize = 10, search = '', status = '' } = {}) {
  const qs = new URLSearchParams();
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  if (search) qs.set('q', search);
  if (status) qs.set('status', status);
  return http(`/admin/databases?${qs.toString()}`, { method: 'GET' });
}

export async function getDatabase(id) {
  return http(`/admin/databases/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function createDatabase(payload) {
  return http('/admin/databases', { method: 'POST', body: JSON.stringify(payload) });
}

export async function upgradeDatabase(id, plan) {
  return http(`/admin/databases/${encodeURIComponent(id)}/upgrade`, {
    method: 'POST',
    body: JSON.stringify({ plan })
  });
}

export async function listWebhooks(id) {
  return http(`/admin/databases/${encodeURIComponent(id)}/webhooks`, { method: 'GET' });
}

export async function createWebhook(id, payload) {
  return http(`/admin/databases/${encodeURIComponent(id)}/webhooks`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function exportCsv(id, params = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return http(`/admin/databases/${encodeURIComponent(id)}/export?${qs.toString()}`, { method: 'GET' });
}

export async function deleteDatabase(id) {
  const base = ensureBaseUrl();
  const cfg = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs || 10000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/admin/databases/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
      signal: controller.signal
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`Delete failed (${res.status}): ${text}`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

export async function renameDatabase(id, name) {
  const base = ensureBaseUrl();
  const cfg = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs || 10000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/admin/databases/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Rename failed (${res.status}): ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}
