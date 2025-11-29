import { Router } from 'express';
import { handleListWorkflowEvents, applyWorkflow, simulateRouting, listExecutions, handleGetWorkflowConfig, handleListNodes, handleCreateNode } from '../../controllers/workflowController.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard as workspaceGuard } from '../../middleware/workspaceGuard.js';

export const router = Router();

router.get('/events', requireAuth, handleListWorkflowEvents);
router.get('/config', requireAuth, workspaceGuard, handleGetWorkflowConfig);
router.get('/nodes', requireAuth, workspaceGuard, handleListNodes);
router.post('/nodes', requireAuth, workspaceGuard, handleCreateNode);
router.post('/apply', requireAuth, workspaceGuard, applyWorkflow);
router.post('/simulate', requireAuth, workspaceGuard, simulateRouting);
router.get('/executions', requireAuth, workspaceGuard, listExecutions);
router.get('/executions/timeline', requireAuth, workspaceGuard, listExecutions);
