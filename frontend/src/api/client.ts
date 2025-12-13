const RUNTIME_BASE = (typeof window !== 'undefined' ? (window as any).__DAXLINKS_CONFIG__?.apiBase : '') || '';
const ENV_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE || '';
const DEFAULT_BASE = import.meta.env.PROD ? 'https://api.daxlinksonline.link' : '';

function normalizeBase(base: string) {
  return base ? base.replace(/\/$/, '') : '';
}

export function getApiBase(): string {
  return normalizeBase(RUNTIME_BASE || ENV_BASE || DEFAULT_BASE);
}

export function withApiBase(path: string | URL): string | URL {
  if (typeof path !== 'string') return path;
  if (path.startsWith('http')) return path;
  const base = getApiBase();
  const cleaned = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleaned}`;
}
