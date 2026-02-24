import dotenv from 'dotenv';
dotenv.config();
import { loadEnvOrExit } from './lib/envRuntime.js';

import { createServer } from './app.js';
import { startNotificationWorker } from './workers/notificationDispatcher.js';
import { startIntegrationConnectivityScheduler } from './services/integrationConnectivityScheduler.js';
import './jobs/forwarderProcessor.js';
import './jobs/executeOrderProcessor.js';

const port = Number(process.env.PORT || 4000);

async function main() {
  // Validate required environment variables early
  loadEnvOrExit();
  const app = await createServer();
  const integrationScheduler = startIntegrationConnectivityScheduler();
  if (process.env.FEATURE_NOTIFICATIONS === 'true') {
    // Safe no-op unless future worker loop is added
    startNotificationWorker().catch((e) => console.error('[notify] worker failed', e));
  }
  const server = app.listen(port, () => {
    console.log(`DaxLinks API listening on http://localhost:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`[server] received ${signal}, shutting down`);
    try {
      integrationScheduler?.stop?.();
    } catch (error) {
      console.warn('[server] failed to stop integration scheduler', error?.message || error);
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
