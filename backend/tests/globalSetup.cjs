const { execSync } = require('node:child_process');
const crypto = require('crypto');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function withSchema(urlString, schemaName) {
  const url = new URL(urlString);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

module.exports = async () => {
  const baseDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!baseDatabaseUrl) {
    throw new Error('DATABASE_URL or TEST_DATABASE_URL is required for Jest e2e tests');
  }

  const schema = process.env.TEST_DATABASE_SCHEMA || 'daxlinks_jest';
  const scopedDatabaseUrl = withSchema(baseDatabaseUrl, schema);
  process.env.DATABASE_URL = scopedDatabaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = '';
  process.env.TRADINGVIEW_IPS = '';
  process.env.TRADINGVIEW_IPS_FILE = '';
  process.env.TRADINGVIEW_AUTO_ROUTE_SINGLE_INTEGRATION = 'true';
  if (!process.env.KMS_KEY) {
    process.env.KMS_KEY = crypto.randomBytes(32).toString('base64');
  }

  const cwd = path.resolve(__dirname, '..');
  execSync('npx prisma db push --force-reset --skip-generate', {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: scopedDatabaseUrl
    }
  });
};
