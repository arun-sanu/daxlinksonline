import dotenv from 'dotenv';
dotenv.config();
import { loadEnvOrExit } from './lib/envRuntime.js';

import { createServer } from './app.js';
import { startNotificationWorker } from './workers/notificationDispatcher.js';
import { startSignalsWorker } from './jobs/workers/signals.worker.js';
import { startOrdersWorker } from './jobs/workers/orders.worker.js';
import { startBuildWorker } from './jobs/workers/build.worker.js';

const port = Number(process.env.PORT || 4000);

async function main() {
  // Validate required environment variables early
  loadEnvOrExit();
  const app = await createServer();
  if (process.env.FEATURE_NOTIFICATIONS === 'true') {
    // Safe no-op unless future worker loop is added
    startNotificationWorker().catch((e) => console.error('[notify] worker failed', e));
  }
  // Start trade-bot workers if Redis is configured
  if (process.env.REDIS_URL) {
    startSignalsWorker();
    startOrdersWorker();
    startBuildWorker();
  }
  app.listen(port, () => {
    console.log(`DaxLinks API listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
