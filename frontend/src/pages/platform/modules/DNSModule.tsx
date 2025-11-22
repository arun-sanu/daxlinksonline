import { useEffect, useMemo, useRef, useState } from 'react';

type Availability = { available: boolean; name: string } | null;
type DnsRecord = { id: string; host: string; url: string; ip: string | null; cloudflareId: string };

const zones = [
  { host: 'hooks.daxlinksonline.link', type: 'CNAME', target: 'router.edge.daxlinksonline.link', status: 'Healthy' },
  { host: 'ops.daxlinksonline.link', type: 'A', target: '35.188.12.42', status: 'Healthy' },
  { host: 'ws.daxlinksonline.link', type: 'SRV', target: 'wss://router.daxlinksonline.link:443', status: 'Degraded' }
];

const failoverTargets = [
  { label: 'Primary', value: 'fra.edge.daxlinksonline.link' },
  { label: 'Secondary', value: 'sin.edge.daxlinksonline.link' },
  { label: 'Emergency', value: 'nyc.edge.daxlinksonline.link' }
];

const workflow = [
  'Draft record updates and request peer review.',
  'Validate propagation with automated dig checks.',
  'Record change tickets for audit and rollback tracking.'
];

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (window as any).__appAuthToken__ || localStorage.getItem('authToken') || localStorage.getItem('daxlinksToken') || null;
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getBaseDomain() {
  if (typeof window !== 'undefined') {
    const fromGlobal = (window as any).__DAXLINKS_CONFIG__?.baseDomain || (window as any).__APP_CONFIG__?.baseDomain;
    if (fromGlobal) return fromGlobal;
  }
  return 'daxlinksonline.link';
}

function runConfetti(canvas: HTMLCanvasElement | null) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);
  const colors = ['#ffffff', '#89d8ff', '#6B6BF7', '#A78BFA', '#00ff9d'];
  const N = Math.min(120, Math.floor((w * h) / 20000));
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * w,
    y: -10 - Math.random() * 40,
    vx: (Math.random() - 0.5) * 2.0,
    vy: 2 + Math.random() * 2.2,
    size: 3 + Math.random() * 3,
    color: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2
  }));
  let raf: number;
  let life = 0;
  const maxLife = 1800; // ~3s
  const step = () => {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > h + 20) {
        p.y = -10;
        p.x = Math.random() * w;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
    life += 16;
    if (life < maxLife) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export default function DNSModule() {
  const baseDomain = useMemo(() => getBaseDomain(), []);
  const [subdomain, setSubdomain] = useState('');
  const [ip, setIp] = useState('');
  const [availability, setAvailability] = useState<Availability>(null);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');
  const [myRecords, setMyRecords] = useState<DnsRecord[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    fetchMine();
  }, []);

  useEffect(() => {
    if (!subdomain.trim()) {
      setAvailability(null);
      return;
    }
    const name = subdomain.trim().toLowerCase();
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      setError('');
      try {
        const res = await fetch(`/api/v1/dns/available/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error('Availability check failed');
        const data = await res.json();
        if (!cancelled) setAvailability(data);
      } catch (e: any) {
        if (!cancelled) setAvailability(null);
        if (!cancelled) setError(e?.message || 'Failed to check availability');
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [subdomain]);

  useEffect(() => {
    if (!showConfetti) return;
    const stop = runConfetti(confettiCanvas.current);
    const timer = setTimeout(() => {
      stop();
      setShowConfetti(false);
    }, 2200);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [showConfetti]);

  async function fetchMine() {
    setLoadingMine(true);
    setError('');
    try {
      const res = await fetch('/api/v1/dns/mine', { headers: { ...authHeaders() }, credentials: 'include' });
      if (res.status === 401) {
        setMyRecords([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to load DNS records');
      const data = await res.json();
      setMyRecords(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load DNS records');
    } finally {
      setLoadingMine(false);
    }
  }

  async function registerDns() {
    setError('');
    setResultUrl('');
    setRegistering(true);
    try {
      const res = await fetch('/api/v1/dns/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ subdomain: subdomain.trim().toLowerCase(), ip: ip.trim() })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || 'Registration failed');
      }
      setResultUrl(payload?.url || '');
      setShowConfetti(true);
      fetchMine();
    } catch (e: any) {
      setError(e?.message || 'Failed to register DNS');
    } finally {
      setRegistering(false);
    }
  }

  async function deleteRec(id: string) {
    setDeleting((prev) => ({ ...prev, [id]: true }));
    setError('');
    try {
      const res = await fetch(`/api/v1/dns/${id}`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
        credentials: 'include'
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || payload?.message || 'Failed to delete record');
      }
      setMyRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      setError(e?.message || 'Failed to delete record');
    } finally {
      setDeleting((prev) => ({ ...prev, [id]: false }));
    }
  }

  const availabilityTone = availability
    ? availability.available
      ? { text: 'Available', color: '#00D4AA' }
      : { text: 'Taken', color: '#ef4444' }
    : null;

  return (
    <div className="dns-shell space-y-10 max-w-5xl">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="dns-chip">Infrastructure</span>
          <span className="dns-chip dns-chip--ghost dns-chip--pulse">Edge aligned</span>
        </div>
        <h1 className="text-3xl font-semibold text-main sm:text-4xl">DNS &amp; routing</h1>
        <p className="max-w-3xl text-sm muted-text">
          Keep webhook ingress, API callbacks, and operator dashboards resolvable in every region. Manage records, health checks, and
          failover targets from a single console.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <article className="dns-card dns-card--grid space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-main">Active zones</h2>
            <span className="dns-token">Aligned</span>
          </div>
          <table className="w-full text-sm text-gray-300">
            <thead className="text-left text-[11px] uppercase tracking-[0.18em] text-gray-500">
              <tr>
                <th className="pb-2">Hostname</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Target</th>
                <th className="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.host} className="border-t border-white/5 align-middle">
                  <td className="py-3 font-semibold text-main">{zone.host}</td>
                  <td className="py-3">{zone.type}</td>
                  <td className="py-3 text-gray-400">{zone.target}</td>
                  <td className="py-3 text-right text-xs uppercase tracking-[0.18em]" style={{ color: zone.status === 'Healthy' ? 'var(--primary)' : undefined }}>
                    {zone.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <aside className="dns-card dns-card--accent space-y-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-main">Cloudflare edge</p>
            <p className="text-xs" style={{ color: '#F3801A' }}>Always-on DDoS &amp; WAF protection</p>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-main">Failover policy</h3>
            <p className="text-xs muted-text">
              Ordered health checks with instant fallbacks. When latency breaches thresholds, traffic shifts to the next available region.
            </p>
            <div className="grid gap-2 text-xs muted-text">
              {failoverTargets.map((target) => (
                <div key={target.value} className="dns-row">
                  <span>{target.label}</span>
                  <span style={{ color: 'var(--primary)' }}>{target.value}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="dns-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-main">Change workflow</h2>
          <span className="dns-token dns-token--ghost">Minimal</span>
        </div>
        <ol className="dns-timeline text-sm muted-text">
          {workflow.map((step, idx) => (
            <li key={step} className="dns-timeline__item">
              <span className="dns-timeline__dot">{idx + 1}</span>
              <span className="text-main">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative dns-card space-y-4">
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <canvas ref={confettiCanvas} className="h-full w-full"></canvas>
          </div>
        )}
        <h2 className="text-lg font-semibold text-main">Custom domain</h2>
        <p className="text-sm muted-text">Create an A record under {baseDomain} to your public IP. Unproxied for direct control.</p>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <label className="text-xs uppercase tracking-[0.2em] muted-text">Subdomain</label>
            <div className="hero-input mt-1 flex items-center">
              <input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="mybot" />
              <span className="text-xs text-gray-500">.{baseDomain}</span>
            </div>
            <p className="mt-1 text-xs" style={availabilityTone ? { color: availabilityTone.color } : undefined}>
              {checking ? 'Checking…' : availabilityTone ? availabilityTone.text : '\u00a0'}
            </p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] muted-text">Public IP</label>
            <div className="hero-input mt-1">
              <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="167.99.12.45" />
            </div>
          </div>
          <div className="flex md:justify-end">
            <button
              type="button"
              className="btn btn-primary text-xs tracking-[0.2em] w-full md:w-auto"
              disabled={!(availability?.available && subdomain && ip) || registering}
              onClick={registerDns}
            >
              {registering ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
        {resultUrl && (
          <p className="text-sm" style={{ color: '#00D4AA' }}>
            Success — Use{' '}
            <a href={resultUrl} target="_blank" rel="noreferrer" className="underline">
              {resultUrl}
            </a>
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}
        <p className="text-xs muted-text">Real-time availability checks and instant Cloudflare A record creation.</p>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-main">Your Custom Subdomains</h3>
          {loadingMine && <p className="text-sm muted-text">Loading…</p>}
          {!loadingMine && !getAuthToken() && <p className="text-sm muted-text">Sign in to view your records.</p>}
          {!loadingMine && getAuthToken() && myRecords.length > 0 && (
            <table className="w-full text-xs muted-text">
              <thead className="text-left text-[11px] uppercase tracking-[0.2em] muted-text">
                <tr>
                  <th className="pb-2">Hostname</th>
                  <th className="pb-2">Target IP</th>
                  <th className="pb-2">Cloudflare ID</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {myRecords.map((rec) => (
                  <tr key={rec.id} className="border-t border-white/5">
                    <td className="py-3">
                      <a href={rec.url} target="_blank" rel="noreferrer" className="underline">
                        {rec.host}
                      </a>
                    </td>
                    <td className="py-3">{rec.ip || '—'}</td>
                    <td className="py-3">
                      <span className="truncate">{rec.cloudflareId}</span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        onClick={() => deleteRec(rec.id)}
                        disabled={Boolean(deleting[rec.id])}
                      >
                        {deleting[rec.id] ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loadingMine && getAuthToken() && myRecords.length === 0 && <p className="text-sm muted-text">No custom subdomains yet.</p>}
        </div>
      </section>
    </div>
  );
}
