'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.UB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-voice-'));
const { hauntLine, exorcismLine, tier, spokenDays } = require('../src/voice/script');
const { speak, cachePath } = require('../src/voice/tts');

const ghost = { threadId: 'abc', name: 'Sarah', subject: 'invoice for March', ageDays: 41 };
const config = { voiceEnabled: true, voiceId: 'AeRdCCKzvd23BpJoofzx', voiceModel: 'eleven_multilingual_v2', elevenLabsApiKey: 'k' };

test('lines darken with age', () => {
  assert.equal(tier(3), 'fresh');
  assert.equal(tier(7), 'lingering');
  assert.equal(tier(30), 'ancient');
  assert.equal(spokenDays(1), 'one day');
});

test('hauntLine names the sender, subject and wait, and is stable per thread', () => {
  const line = hauntLine(ghost);
  assert.match(line, /Sarah/);
  assert.match(line, /invoice for March/);
  assert.match(line, /41 days/);
  assert.equal(hauntLine(ghost), line);
});

test('hauntLine copes with no subject', () => {
  const line = hauntLine({ ...ghost, subject: '' });
  assert.doesNotMatch(line, /undefined|\.\.\. \.\.\./);
});

test('exorcism lines differ for reply vs archive', () => {
  assert.match(exorcismLine(ghost, 'replied'), /rest/);
  assert.match(exorcismLine(ghost, 'archived'), /remember/);
});

test('speak calls ElevenLabs once per line and caches the mp3', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(Buffer.from('ID3fake-mp3'), { status: 200 });
  });

  const [a, b] = await Promise.all([speak('hello', config), speak('hello', config)]);
  assert.equal(a, b);
  assert.equal(fs.readFileSync(a, 'utf8'), 'ID3fake-mp3');
  await speak('hello', config);
  assert.equal(calls.length, 1);

  const { url, init } = calls[0];
  assert.match(url, /\/v1\/text-to-speech\/AeRdCCKzvd23BpJoofzx\?output_format=mp3_44100_128$/);
  assert.equal(init.headers['xi-api-key'], 'k');
  assert.deepEqual(JSON.parse(init.body).model_id, 'eleven_multilingual_v2');
});

test('speak surfaces API errors and caches nothing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"detail":"quota"}', { status: 401 }));
  await assert.rejects(speak('fails', config), /ElevenLabs TTS failed \(401\)/);
  assert.equal(fs.existsSync(cachePath('fails', config)), false);
});

test('voice off means no network at all', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('should not call'));
  assert.equal(await speak('quiet', { ...config, voiceEnabled: false }), null);
  assert.equal(fetch.mock.callCount(), 0);
});

test('a ghost carrying several threads says how many', () => {
  assert.match(hauntLine({ ...ghost, count: 63 }), /63 letters\.\.\. unanswered\.$/);
  assert.doesNotMatch(hauntLine({ ...ghost, count: 1 }), /letters/);
});
