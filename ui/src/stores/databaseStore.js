import { reactive, computed } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import * as dbApi from '../services/databaseApi.js';

export const databaseStore = reactive({
  loading: false,
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  search: '',
  status: '', // '', 'active', 'pending'
  usage: { usedGb: 0, quotaGb: 0, count: 0 },
  modals: { create: false, upgradeForId: '' },
  selectedId: ''
});

export const derived = {
  usageText: computed(() => {
    const u = databaseStore.usage;
    if (!u.quotaGb) return '0 GB / 0 GB used across 0 DBs';
    return `${u.usedGb} GB / ${u.quotaGb} GB used across ${u.count} DBs`;
  }),
  usagePercent: computed(() => {
    const u = databaseStore.usage;
    return u.quotaGb ? Math.min(100, Math.round((u.usedGb / u.quotaGb) * 100)) : 0;
  })
};

function recomputeUsage() {
  const items = databaseStore.items || [];
  const used = items.reduce((sum, d) => sum + (d.usedGb || 0), 0);
  const quota = items.reduce((sum, d) => sum + (d.sizeGb || 0), 0);
  databaseStore.usage = { usedGb: used, quotaGb: quota, count: items.length };
}

export async function loadDatabases() {
  databaseStore.loading = true;
  try {
    const res = await dbApi.listDatabases({
      page: databaseStore.page,
      pageSize: databaseStore.pageSize,
      search: databaseStore.search,
      status: databaseStore.status
    });
    if (res && Array.isArray(res.items)) {
      databaseStore.items = res.items;
      databaseStore.total = Number(res.total || res.items.length);
    } else if (Array.isArray(res)) {
      databaseStore.items = res;
      databaseStore.total = res.length;
    } else {
      databaseStore.items = [];
      databaseStore.total = 0;
    }
  } catch (e) {
    console.warn('[databaseStore] Failed to load databases', e?.message || e);
    databaseStore.items = [];
    databaseStore.total = 0;
  } finally {
    recomputeUsage();
    databaseStore.loading = false;
  }
}

export async function createDatabase({ name, sizeGb }) {
  try {
    const payload = { name: name || 'My First DB', sizeGb: sizeGb || 100 };
    const created = await dbApi.createDatabase(payload);
    if (created) {
      databaseStore.items.unshift(created);
      databaseStore.total += 1;
      recomputeUsage();
    }
  } catch (e) {
    console.error('[databaseStore] Create failed', e?.message || e);
    throw e;
  }
}

export function setSearch(term) {
  databaseStore.search = term || '';
}

export function setStatusFilter(status) {
  databaseStore.status = status || '';
}

export function selectDatabase(id) {
  databaseStore.selectedId = id || '';
}

export async function upgradePlan(id, plan) {
  try {
    const updated = await dbApi.upgradeDatabase(id, plan);
    const idx = databaseStore.items.findIndex((d) => d.id === id);
    if (idx !== -1 && updated) {
      databaseStore.items[idx] = { ...databaseStore.items[idx], ...updated };
      recomputeUsage();
    }
  } catch (e) {
    console.error('[databaseStore] Upgrade failed', e?.message || e);
    throw e;
  }
}

export async function deleteDatabase(id) {
  try {
    await dbApi.deleteDatabase(id);
    databaseStore.items = databaseStore.items.filter((d) => d.id !== id);
    databaseStore.total = Math.max(0, databaseStore.total - 1);
    if (databaseStore.selectedId === id) databaseStore.selectedId = '';
    recomputeUsage();
  } catch (e) {
    console.error('[databaseStore] Delete failed', e?.message || e);
    throw e;
  }
}

export async function renameDatabase(id, name) {
  try {
    const updated = await dbApi.renameDatabase(id, name);
    const idx = databaseStore.items.findIndex((d) => d.id === id);
    if (idx !== -1 && updated) {
      databaseStore.items[idx] = { ...databaseStore.items[idx], ...updated };
    }
  } catch (e) {
    console.error('[databaseStore] Rename failed', e?.message || e);
    throw e;
  }
}
