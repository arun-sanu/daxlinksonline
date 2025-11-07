import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { handleListIncidents, handleGetIncident, handleCreateIncident, handleUpdateIncident, handleAddIncidentNote } from '../../controllers/adminIncidentsController.js';

export const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', handleListIncidents);
router.get('/:incidentId', handleGetIncident);
router.post('/', handleCreateIncident);
router.patch('/:incidentId', handleUpdateIncident);
router.post('/:incidentId/notes', handleAddIncidentNote);

