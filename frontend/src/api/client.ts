const RUNTIME_BASE = (typeof window !== 'undefined' ? (window as any).__DAXLINKS_CONFIG__?.apiBase : '') || '';
const ENV_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE || '';
const DEFAULT_BASE = import.meta.env.PROD ? 'https://api.daxlinksonline.link' : '';

function normalizeBase(base: string) {
  return base ? base.replace(/\/$/, '') : '';
}

export function getApiBase(): string {
  return normalizeBase(RUNTIME_BASE || ENV_BASE || DEFAULT_BASE);
}

function dedupeApiPrefixes(base: string, path: string): string {
  let next = path;
  const pairs: Array<{ baseSuffix: string; pathPrefix: string }> = [
    { baseSuffix: '/api/v1', pathPrefix: '/api/v1' },
    { baseSuffix: '/api/v1', pathPrefix: '/v1' },
    { baseSuffix: '/api', pathPrefix: '/api' }
  ];

  for (const pair of pairs) {
    if (!base.endsWith(pair.baseSuffix)) continue;
    if (next === pair.pathPrefix) return '';
    if (next.startsWith(`${pair.pathPrefix}/`)) {
      return next.slice(pair.pathPrefix.length);
    }
  }

  return next;
}

export function withApiBase(path: string | URL): string | URL {
  if (typeof path !== 'string') return path;
  if (path.startsWith('http')) return path;
  const base = getApiBase();
  const cleaned = path.startsWith('/') ? path : `/${path}`;
  if (!base) return cleaned;
  const deduped = dedupeApiPrefixes(base, cleaned);
  return `${base}${deduped}`;
}
