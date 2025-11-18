import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildVersion, storagePathsForVersion } from '../src/builder/build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

test('malicious import is rejected with reason', async () => {
  const versionId = 'ver_malicious';
  const { zipPath } = storagePathsForVersion(versionId);
  fs.copyFileSync(path.join(fixturesDir, 'malicious.zip'), zipPath);
  try {
    const result = await buildVersion({ botId: 'bot_reject', versionId, zipPath });
    assert.equal(result.status, 'rejected');
    assert(result.reasons.some((r) => r.toLowerCase().includes('subprocess')));
  } catch (err) {
    console.error('malicious import test failed', err);
    throw err;
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
});

test('valid stub builds and returns image ref', async () => {
  const versionId = 'ver_valid';
  const { zipPath, sbomPath, scanPath } = storagePathsForVersion(versionId);
  fs.copyFileSync(path.join(fixturesDir, 'stub.zip'), zipPath);
  try {
    const result = await buildVersion({ botId: 'bot_valid', versionId, zipPath });
    assert.equal(result.status, 'approved');
    assert.ok(result.imageRef?.includes('bot_valid'));
    assert.ok(result.signedDigest?.startsWith('sha256:'));
    assert.ok(fs.existsSync(sbomPath));
    assert.ok(fs.existsSync(scanPath));
  } catch (err) {
    console.error('valid build test failed', err);
    throw err;
  } finally {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(sbomPath, { force: true });
    fs.rmSync(scanPath, { force: true });
  }
});

