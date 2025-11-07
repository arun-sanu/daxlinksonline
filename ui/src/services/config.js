const DEFAULT_CONFIG = {
  apiBaseUrl: null,
  workspaceId: null,
  requestTimeoutMs: 8000,
  uiMode: 'client' // 'client' | 'admin'
};

export function getConfig() {
  const runtimeConfig = typeof window !== 'undefined' ? window.__DAXLINKS_CONFIG__ || {} : {};
  const normalized = {
    ...DEFAULT_CONFIG,
    ...runtimeConfig
  };
  if (normalized.workspaceId) {
    normalized.workspaceId = String(normalized.workspaceId);
  }
  return Object.freeze(normalized);
}
