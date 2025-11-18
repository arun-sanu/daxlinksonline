import { randomUUID } from 'crypto';

export function correlationId() {
  return function correlationMiddleware(req, res, next) {
    const incoming = typeof req.headers['x-correlation-id'] === 'string' ? req.headers['x-correlation-id'] : null;
    const id = incoming && incoming.length > 0 ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    res.locals.correlationId = id;
    next();
  };
}
