'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const paths = require('../paths');

const API = 'https://api.elevenlabs.io/v1/text-to-speech';

// Tuned for a low, steady delivery rather than theatrical swings.
const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true };

const inFlight = new Map();

function cachePath(text, { voiceId, voiceModel }) {
  const key = crypto.createHash('sha256').update(`${voiceId}\n${voiceModel}\n${text}`).digest('hex');
  return path.join(paths.voiceCache, `${key}.mp3`);
}

async function generate(text, config, file) {
  const headers = { 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
  if (config.elevenLabsApiKey) headers['xi-api-key'] = config.elevenLabsApiKey;
  const res = await fetch(`${API}/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, model_id: config.voiceModel, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  paths.ensureDir(paths.voiceCache);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

// Returns the path of an mp3 for this line, generating it at most once.
// Returns null when voice is disabled.
async function speak(text, config) {
  if (!config.voiceEnabled) return null;
  const file = cachePath(text, config);
  if (fs.existsSync(file)) return file;
  if (!inFlight.has(file)) {
    inFlight.set(file, generate(text, config, file).finally(() => inFlight.delete(file)));
  }
  return inFlight.get(file);
}

module.exports = { speak, cachePath };
