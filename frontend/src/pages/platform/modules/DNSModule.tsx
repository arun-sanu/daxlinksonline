import { useEffect, useMemo, useState } from 'react';
import { checkDnsAvailability, deleteDnsRecord, listMyDnsRecords, registerDnsRecord } from '../../../api/dns';
import type { DnsRecord } from '../../../api/types';

const BASE_DOMAIN = 'daxlinksonline.link';
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

type Availability = { available: boolean; name: string; reason?: string } | null;
type Toast = { message: string; tone: 'success' | 'error' };

function formatDate(input: string) {
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}

function fullDomain(name: string) {
  return `${name}.${BASE_DOMAIN}`;
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('active')) return { label: 'Active', className: 'text-emerald-300' };
  if (normalized.includes('pending')) return { label: 'Pending', className: 'text-amber-300' };
  if (normalized.includes('error')) return { label: 'Error', className: 'text-red-300' };
  return { label: status, className: 'text-gray-300' };
}

export default function DNSModule() {
  const [subdomain, setSubdomain] = useState('');
  const [ip, setIp] = useState('');
  const [availability, setAvailability] = useState<Availability>(null);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DnsRecord | null>(null);

  const clientValidation = useMemo(() => {
    if (!subdomain.trim()) return '';
    const normalized = subdomain.trim().toLowerCase();
    if (normalized.length < 3) return 'Min 3 characters required.';
    if (!SUBDOMAIN_REGEX.test(normalized)) return 'Use lowercase letters/numbers, hyphens allowed in the middle.';
    return '';
  }, [subdomain]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingRecords(true);
      setError('');
      try {
        const res = await listMyDnsRecords();
        if (mounted) setRecords(res);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load DNS records');
      } finally {
        if (mounted) setLoadingRecords(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!subdomain.trim()) {
      setAvailability(null);
      return;
    }
    const normalized = subdomain.trim().toLowerCase();
    if (clientValidation) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await checkDnsAvailability(normalized);
        if (!cancelled) setAvailability(res);
      } catch (e: any) {
        if (!cancelled) setAvailability(null);
        if (!cancelled) setError(e?.message || 'Availability check failed');
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [subdomain, clientValidation]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const canSubmit = availability?.available && !!ip.trim() && !registering;
  const helperText = clientValidation || (availability ? (availability.available ? 'Available' : availability.reason || 'Unavailable') : '');

  async function handleRegister() {
    if (clientValidation) {
      setError(clientValidation);
      return;
    }
    const name = subdomain.trim().toLowerCase();
    if (!name || !ip.trim()) return;
    setRegistering(true);
    setError('');
    try {
      await registerDnsRecord({ name, ip: ip.trim() });
      setToast({ message: `Added ${fullDomain(name)}`, tone: 'success' });
      setSubdomain('');
      setIp('');
      const refreshed = await listMyDnsRecords();
      setRecords(refreshed);
    } catch (e: any) {
      setError(e?.message || 'Failed to register DNS');
      setToast({ message: e?.message || 'Failed to register DNS', tone: 'error' });
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteDnsRecord(target.id);
      setRecords((prev) => prev.filter((r) => r.id !== target.id));
      setToast({ message: `Removed ${fullDomain(target.name)}`, tone: 'success' });
    } catch (e: any) {
      setToast({ message: e?.message || 'Delete failed', tone: 'error' });
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: 'Copied', tone: 'success' });
    } catch {
      setToast({ message: 'Copy failed', tone: 'error' });
    }
  }

  return (
    <div className="space-y-10">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-40 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.tone === 'success' ? 'bg-emerald-600/80 border-emerald-300/60 text-emerald-50' : 'bg-red-600/80 border-red-300/60 text-red-50'
          }`}
        >
          {toast.message}
        </div>
      )}

      <header className="space-y-2">
        <p className="section-label">DNS Management</p>
        <h1 className="text-3xl font-semibold text-main sm:text-4xl">Custom subdomains for your webhooks</h1>
        <p className="max-w-3xl text-sm muted-text">
          Request, validate, and delete A records under {BASE_DOMAIN}. Every change runs through the live DNS API and Cloudflare cleanup.
        </p>
      </header>

      <section className="card-shell space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-main">Request a new subdomain</p>
            <p className="text-xs muted-text">We debounce availability checks after you stop typing.</p>
          </div>
          <span className="dns-chip dns-chip--ghost text-xs uppercase tracking-[0.28em]">DMS</span>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-2 text-sm muted-text">
            Subdomain
            <div className="hero-input flex items-center">
              <input
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                placeholder="moneyplantbot1"
                aria-describedby="subdomain-help"
              />
              <span className="text-xs text-gray-500">.{BASE_DOMAIN}</span>
            </div>
            <span id="subdomain-help" className="text-xs" style={{ color: clientValidation ? '#f97316' : availability?.available ? '#34D399' : '#9CA3AF' }}>
              {checking ? 'Checking…' : helperText || 'Lowercase, numbers, hyphen (not at edges)'}
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm muted-text">
            Target IP
            <div className="hero-input">
              <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="167.99.12.45" />
            </div>
          </label>
          <button type="button" className="btn btn-primary w-full text-xs md:w-auto" disabled={!canSubmit} onClick={handleRegister}>
            {registering ? 'Saving…' : 'Add record'}
          </button>
        </div>
        {error && <p className="text-sm text-amber-300">{error}</p>}
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-main">Your DNS records</h2>
            <p className="text-xs muted-text">Active, pending, or errored records under {BASE_DOMAIN}.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => listMyDnsRecords().then(setRecords)}>
            Refresh
          </button>
        </div>
        {loadingRecords && <p className="text-sm muted-text">Loading records…</p>}
        {!loadingRecords && records.length === 0 && <p className="text-sm muted-text">No custom subdomains yet.</p>}
        {!loadingRecords && records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-gray-300">
              <thead className="text-left text-[11px] uppercase tracking-[0.2em] muted-text">
                <tr>
                  <th className="pb-2">Subdomain</th>
                  <th className="pb-2">Target IP</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => {
                  const tone = statusTone(rec.status);
                  const fqdn = fullDomain(rec.name);
                  return (
                    <tr key={rec.id} className="border-t border-white/5">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <a href={`https://${fqdn}`} target="_blank" rel="noreferrer" className="font-semibold text-main underline">
                            {fqdn}
                          </a>
                          <button type="button" className="btn btn-secondary btn-xxs" onClick={() => handleCopy(fqdn)}>
                            Copy
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-500">{rec.cloudflareId ? `Cloudflare: ${rec.cloudflareId}` : 'Pending Cloudflare ID'}</p>
                      </td>
                      <td className="py-3">{rec.ip || '—'}</td>
                      <td className="py-3">
                        <span className={tone.className}>{tone.label}</span>
                      </td>
                      <td className="py-3">{formatDate(rec.createdAt)}</td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button type="button" className="btn btn-secondary btn-xxs" onClick={() => handleCopy(fqdn)}>
                            Copy URL
                          </button>
                          <button type="button" className="btn btn-danger btn-xxs" onClick={() => setConfirmDelete(rec)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmDelete && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0b0c10] p-5 shadow-xl">
            <p className="text-lg font-semibold text-main">Delete DNS record</p>
            <p className="text-sm muted-text">
              Remove <span className="font-semibold text-main">{fullDomain(confirmDelete.name)}</span>? This also deletes the Cloudflare entry.
            </p>
            <div className="flex justify-end gap-3 text-sm">
              <button className="btn btn-secondary" type="button" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
