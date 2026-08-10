import { getConfig } from './config.js';

const config = getConfig();
let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
}

export function getAuthToken() {
  return authToken;
}

export function clearAuthToken() {
  authToken = null;
}

function ensureBaseUrl() {
  if (!config.apiBaseUrl) {
    throw new Error('API base URL is not configured. Set window.__DAXLINKS_CONFIG__.apiBaseUrl');
  }
}

function getAuthBaseUrl() {
  ensureBaseUrl();
  try {
    const replaced = config.apiBaseUrl.replace(/\/api\/v1(?=\/|$)/, '/api/auth');
    if (replaced !== config.apiBaseUrl) {
      const url = new URL(replaced);
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    }
    const fallback = new URL(config.apiBaseUrl);
    const trimmedPath = fallback.pathname.replace(/\/$/, '');
    const basePath = trimmedPath.endsWith('/api') ? `${trimmedPath}/auth` : `${trimmedPath}/api/auth`;
    fallback.pathname = basePath;
    fallback.search = '';
    fallback.hash = '';
    return fallback.toString().replace(/\/$/, '');
  } catch (error) {
    throw new Error(`Failed to resolve auth endpoint: ${error?.message || error}`);
  }
}

function ensureWorkspaceId() {
  if (!config.workspaceId) {
    throw new Error('workspaceId is not configured. Set window.__DAXLINKS_CONFIG__.workspaceId');
  }
  return config.workspaceId;
}

async function request(path, options = {}) {
  ensureBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    // Attach bearer from in-memory or storage if present
    try {
      const tokenFromStorage = (!authToken && typeof window !== 'undefined')
        ? (window.__appAuthToken__ || window.localStorage?.getItem('daxlinksToken') || window.localStorage?.getItem('authToken'))
        : null;
      const tokenEffective = authToken || tokenFromStorage;
      if (tokenEffective && !headers.Authorization) {
        headers.Authorization = `Bearer ${tokenEffective}`;
      }
    } catch {}
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      headers,
      signal: controller.signal,
      ...options
    });
    if (response.status === 401) {
      // Centralized 401 handling: redirect to Account login page (hash router)
      try {
        if (typeof window !== 'undefined') {
          const current = window.location.hash?.replace(/^#/, '') || '';
          const returnParam = current && current !== '/account' ? (`?return=${encodeURIComponent(current)}`) : '';
          window.location.hash = `#/account${returnParam}`;
        }
      } catch {}
      throw new Error('Unauthorized');
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`API request failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchInitialData() {
  const workspaceId = ensureWorkspaceId();
  return request(`/dashboard/${encodeURIComponent(workspaceId)}/bootstrap`, { method: 'GET' });
}

export async function registerAccount(payload) {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function loginAccount(payload) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function portalLogin(payload) {
  return request('/portal/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function fetchCurrentUser() {
  return request('/auth/me', { method: 'GET' });
}

export async function requestPasswordReset(payload) {
  return request('/auth/forgot', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function resetPassword(payload) {
  return request('/auth/reset', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function initiateGoogleSignIn({ callbackUrl, disableRedirect = false } = {}) {
  const authBaseUrl = getAuthBaseUrl();
  const response = await fetch(`${authBaseUrl}/sign-in/social`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      provider: 'google',
      callbackURL: callbackUrl,
      errorCallbackURL: callbackUrl,
      newUserCallbackURL: callbackUrl,
      disableRedirect
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google sign-in failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function submitRegistration(payload) {
  const body = {
    name: payload.organization || payload.fullName || 'DaxLinks Workspace',
    slug: payload.slug || undefined,
    planTier: payload.plan || 'Professional',
    teamSize: payload.teamSize || '1-5',
    primaryUseCase: payload.useCase || 'signals',
    region: payload.region || 'amer',
    adminLocation: payload.adminLocation || 'Unknown',
    adminDevice: payload.adminDevice || 'Dashboard',
    adminIp: payload.adminIp || '127.0.0.1'
  };
  return request('/workspaces', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function triggerIntegrationTest(profileId) {
  const workspaceId = ensureWorkspaceId();
  return request(`/integrations/${encodeURIComponent(workspaceId)}/${encodeURIComponent(profileId)}/test`, {
    method: 'POST'
  });
}

export async function createWebhook(payload) {
  const workspaceId = ensureWorkspaceId();
  const body = {
    name: payload.name,
    url: payload.url,
    method: payload.method || 'POST',
    signingSecret: payload.secret || undefined,
    events: payload.events && payload.events.length ? payload.events : undefined,
    event: payload.event || undefined,
    active: payload.active ?? true
  };
  return request(`/webhooks/${encodeURIComponent(workspaceId)}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function listWebhooks(workspaceIdParam) {
  const workspaceId = workspaceIdParam || ensureWorkspaceId();
  return request(`/webhooks/${encodeURIComponent(workspaceId)}`, { method: 'GET' });
}

// Toggle a webhook by id for current workspace

export async function createIntegration(payload) {
  const workspaceId = ensureWorkspaceId();
  const body = {
    exchange: payload.exchange,
    environment: payload.environment || 'paper',
    apiKey: payload.apiKey,
    apiSecret: payload.apiSecret,
    passphrase: payload.passphrase || undefined,
    label: payload.label || undefined,
    description: payload.description || undefined,
    rateLimit: payload.rateLimit ? Number(payload.rateLimit) : undefined,
    bandwidth: payload.bandwidth || undefined
  };
  return request(`/integrations/${encodeURIComponent(workspaceId)}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function toggleWebhook(webhookId, active) {
  const workspaceId = ensureWorkspaceId();
  return request(`/webhooks/${encodeURIComponent(workspaceId)}/${encodeURIComponent(webhookId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active })
  });
}

// DNS: availability and registration
export async function dnsCheckAvailable(name) {
  return request(`/dns/available/${encodeURIComponent(name)}`, { method: 'GET' });
}

export async function dnsRegister({ subdomain, ip }) {
  return request('/dns/register', {
    method: 'POST',
    body: JSON.stringify({ subdomain, ip })
  });
}

export async function dnsListMine() {
  return request('/dns/mine', { method: 'GET' });
}

export async function dnsDelete(id) {
  return request(`/dns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Admin: Databases
export async function adminListDatabases() {
  return request('/admin/databases', { method: 'GET' });
}

export async function adminCreateDatabase(payload) {
  return request('/admin/databases', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function adminRotateDatabase(dbId) {
  return request(`/admin/databases/${encodeURIComponent(dbId)}/rotate`, {
    method: 'POST'
  });
}

export async function adminDeleteDatabase(dbId) {
  return request(`/admin/databases/${encodeURIComponent(dbId)}`, {
    method: 'DELETE'
  });
}

export async function fetchAvailableExchanges() {
  return request('/integrations/meta/exchanges', { method: 'GET' });
}

export async function fetchIntegrations() {
  const workspaceId = ensureWorkspaceId();
  return request(`/integrations/${encodeURIComponent(workspaceId)}`, { method: 'GET' });
}

export async function renameIntegration(integrationId, label) {
  const workspaceId = ensureWorkspaceId();
  return request(`/integrations/${encodeURIComponent(workspaceId)}/${encodeURIComponent(integrationId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ label })
  });
}

export async function updateIntegration(integrationId, patch) {
  const workspaceId = ensureWorkspaceId();
  return request(`/integrations/${encodeURIComponent(workspaceId)}/${encodeURIComponent(integrationId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch || {})
  });
}
