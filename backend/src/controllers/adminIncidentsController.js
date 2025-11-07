import { z } from 'zod';
import { listIncidents, getIncident, createIncident, updateIncident, addIncidentNote } from '../services/incidentsService.js';
import { recordAudit } from '../services/auditService.js';

export async function handleListIncidents(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(req.query.pageSize) || 50, 200));
    const status = req.query.status || undefined;
    const severity = req.query.severity || undefined;
    const result = await listIncidents({ status, severity, page, pageSize });
    res.json(result);
  } catch (err) { next(err); }
}

export async function handleGetIncident(req, res, next) {
  try {
    const row = await getIncident(req.params.incidentId);
    res.json(row);
  } catch (err) { next(err); }
}

const createSchema = z.object({
  title: z.string().min(3),
  summary: z.string().optional(),
  severity: z.enum(['low','medium','high','critical']).optional()
});

export async function handleCreateIncident(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const row = await createIncident({ ...body, createdBy: req.user.id });
    await recordAudit({ userId: req.user.id, action: 'incident.create', entityType: 'Incident', entityId: row.id, summary: row.title });
    res.status(201).json(row);
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}

const updateSchema = z.object({
  title: z.string().min(3).optional(),
  summary: z.string().optional(),
  severity: z.enum(['low','medium','high','critical']).optional(),
  status: z.enum(['open','ack','resolved']).optional()
});

export async function handleUpdateIncident(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const row = await updateIncident(req.params.incidentId, body);
    await recordAudit({ userId: req.user.id, action: 'incident.update', entityType: 'Incident', entityId: row.id, summary: `${row.status} ${row.severity}` });
    res.json(row);
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}

const noteSchema = z.object({ body: z.string().min(1) });

export async function handleAddIncidentNote(req, res, next) {
  try {
    const { body } = noteSchema.parse(req.body || {});
    const note = await addIncidentNote({ incidentId: req.params.incidentId, userId: req.user.id, body });
    await recordAudit({ userId: req.user.id, action: 'incident.note', entityType: 'Incident', entityId: req.params.incidentId, summary: body.slice(0, 64) });
    res.status(201).json(note);
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}

