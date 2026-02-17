import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBotLanguage,
  normalizeInstanceControlAction,
  parseVersionNotes,
  stringifyVersionNotes
} from '../src/services/tradeBotsService.js';

test('normalizeBotLanguage maps aliases to canonical values', () => {
  assert.equal(normalizeBotLanguage('python'), 'python');
  assert.equal(normalizeBotLanguage('Py'), 'python');
  assert.equal(normalizeBotLanguage('golang'), 'go');
  assert.equal(normalizeBotLanguage('go'), 'go');
  assert.equal(normalizeBotLanguage('c++'), 'cpp');
  assert.equal(normalizeBotLanguage('CPP'), 'cpp');
  assert.equal(normalizeBotLanguage('c'), 'c');
  assert.equal(normalizeBotLanguage('java'), 'java');
});

test('normalizeBotLanguage rejects unsupported languages', () => {
  assert.throws(() => normalizeBotLanguage('rust'), /Unsupported bot language/);
});

test('normalizeInstanceControlAction normalizes valid lifecycle actions', () => {
  assert.equal(normalizeInstanceControlAction('start'), 'start');
  assert.equal(normalizeInstanceControlAction(' Pause '), 'pause');
  assert.equal(normalizeInstanceControlAction('STOP'), 'stop');
  assert.equal(normalizeInstanceControlAction('restart'), 'restart');
});

test('normalizeInstanceControlAction rejects unsupported lifecycle actions', () => {
  assert.throws(() => normalizeInstanceControlAction('resume'), /Unsupported bot instance action/);
});

test('parseVersionNotes supports json and plain text', () => {
  const parsedJson = parseVersionNotes('{"language":"python","entrypoint":"main.py"}');
  assert.equal(parsedJson.language, 'python');
  assert.equal(parsedJson.entrypoint, 'main.py');

  const parsedPlain = parseVersionNotes('legacy plain notes');
  assert.equal(parsedPlain.userNotes, 'legacy plain notes');
});

test('stringifyVersionNotes round-trips metadata', () => {
  const encoded = stringifyVersionNotes({
    language: 'go',
    entrypoint: 'cmd/main.go',
    originalFilename: 'bot.zip'
  });
  const decoded = parseVersionNotes(encoded);
  assert.equal(decoded.language, 'go');
  assert.equal(decoded.entrypoint, 'cmd/main.go');
  assert.equal(decoded.originalFilename, 'bot.zip');
});
