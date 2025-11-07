import dotenv from 'dotenv';
dotenv.config();

import { createServer } from './app.js';

const port = Number(process.env.PORT || 4000);

async function main() {
  const app = await createServer();
  app.listen(port, () => {
    console.log(`DaxLinks API listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
