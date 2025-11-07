import { prisma } from '../utils/prisma.js';

export async function listIncidents({ status, severity, page = 1, pageSize = 50 } = {}) {
  const take = Math.max(1, Math.min(Number(pageSize) || 50, 200));
  const skip = Math.max(0, (Number(page) - 1) * take);
  const where = {};
  if (status) where.status = String(status);
  if (severity) where.severity = String(severity);
  const [rows, total] = await Promise.all([
    prisma.incident.findMany({ where, orderBy: { startedAt: 'desc' }, take, skip }),
    prisma.incident.count({ where })
  ]);
  return { rows, total, page, pageSize: take };
}

export async function getIncident(id) {
  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) {
    const e = new Error('Incident not found');
    e.status = 404;
    throw e;
  }
  const notes = await prisma.incidentNote.findMany({ where: { incidentId: id }, orderBy: { createdAt: 'asc' } });
  return { ...incident, notes };
}

export async function createIncident({ title, summary, severity = 'low', createdBy }) {
  const row = await prisma.incident.create({ data: { title, summary: summary || null, severity, createdBy } });
  return row;
}

export async function updateIncident(id, { title, summary, severity, status }) {
  const data = {};
  if (title !== undefined) data.title = title;
  if (summary !== undefined) data.summary = summary;
  if (severity !== undefined) data.severity = severity;
  if (status !== undefined) data.status = status;
  const row = await prisma.incident.update({ where: { id }, data });
  return row;
}

export async function addIncidentNote({ incidentId, userId, body }) {
  const note = await prisma.incidentNote.create({ data: { incidentId, userId, body } });
  return note;
}

