import { Router } from 'express';
import {
  handleListWorkflowEvents,
  applyWorkflow,
  simulateRouting,
  listExecutions,
  handleGetWorkflowConfig,
  handleListNodes,
  handleCreateNode,
  handleControlWorkflow,
  handleDeleteWorkflow,
  handleControlWorkflowRule,
  handleDeleteWorkflowRule
} from '../../controllers/workflowController.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard as workspaceGuard } from '../../middleware/workspaceGuard.js';

export const router = Router();

router.get('/events', requireAuth, handleListWorkflowEvents);
router.get('/config', requireAuth, workspaceGuard, handleGetWorkflowConfig);
router.delete('/config', requireAuth, workspaceGuard, handleDeleteWorkflow);
router.post('/actions/:action', requireAuth, workspaceGuard, handleControlWorkflow);
router.get('/nodes', requireAuth, workspaceGuard, handleListNodes);
router.post('/nodes', requireAuth, workspaceGuard, handleCreateNode);
router.post('/rules/:ruleId/actions/:action', requireAuth, workspaceGuard, handleControlWorkflowRule);
router.delete('/rules/:ruleId', requireAuth, workspaceGuard, handleDeleteWorkflowRule);
router.post('/apply', requireAuth, workspaceGuard, applyWorkflow);
router.post('/simulate', requireAuth, workspaceGuard, simulateRouting);
router.get('/executions', requireAuth, workspaceGuard, listExecutions);
router.get('/executions/timeline', requireAuth, workspaceGuard, listExecutions);
