import { getBootstrapData } from '../services/dashboardService.js';

export async function handleBootstrap(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    const requesterId = req.user?.id;
    const data = await getBootstrapData(workspaceId, requesterId);
    res.json(data);
  } catch (error) {
    next(error);
  }
}
