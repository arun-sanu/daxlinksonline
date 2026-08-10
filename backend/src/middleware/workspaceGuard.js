import { prisma } from '../utils/prisma.js';

// Ensures the requester has access to the target workspace
export async function guard(req, res, next) {
  try {
    const { workspaceId } = req.params || {};
    if (!workspaceId || !req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // This app models ownership via Workspace.ownerId (no members relation in schema)
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId }
    });

    if (!ws || (ws.ownerId && ws.ownerId !== req.user.id)) {
      return res.status(403).json({ error: 'Not your workspace' });
    }

    req.workspace = ws;
    next();
  } catch (err) {
    next(err);
  }
}

