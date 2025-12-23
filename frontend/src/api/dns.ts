import type { DnsRecord } from './types';
import { withApiBase } from './client';

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken') || localStorage.getItem('daxlinksToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const url = withApiBase(input);
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
    ...init
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as any)?.error || (json as any)?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

export function checkDnsAvailability(name: string) {
  return request<{ available: boolean; name: string; reason?: string }>(`/api/v1/dns/available/${encodeURIComponent(name)}`);
}

export type RegisterDnsPayload = { subdomain: string; ip: string; name?: string };

export function registerDnsRecord(payload: RegisterDnsPayload) {
  const body = { subdomain: payload.subdomain, name: payload.name || payload.subdomain, ip: payload.ip };
  return request<DnsRecord>('/api/v1/dns/register', { method: 'POST', body: JSON.stringify(body) });
}

export async function listMyDnsRecords() {
  const res = await request<{ items?: DnsRecord[]; records?: DnsRecord[] } | DnsRecord[]>('/api/v1/dns/mine', { method: 'GET' });
  if (Array.isArray(res)) return res;
  return res.items || res.records || [];
}

export function deleteDnsRecord(id: string) {
  return request<void>(`/api/v1/dns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
