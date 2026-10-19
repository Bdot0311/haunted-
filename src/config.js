'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./paths');

// "Nathaniel C - Suspense, British calm" on ElevenLabs.
const DEFAULT_VOICE_ID = 'AeRdCCKzvd23BpJoofzx';

const DEFAULTS = {
  // Path to the Google OAuth "Desktop app" client file you downloaded.
  credentialsPath: path.join(dataDir, 'credentials.json'),
  voiceId: DEFAULT_VOICE_ID,
  voiceModel: 'eleven_multilingual_v2',
  // Set to false to keep every subject line on your machine (no TTS calls).
  voiceEnabled: true,
  // A thread must have waited at least this long before it can haunt you.
  minAgeDays: 3,
  // ...and is ignored once it is older than this.
  maxAgeDays: 180,
  maxGhosts: 7,
  // How often the app re-checks Gmail for exorcisms and new ghosts.
  pollSeconds: 60,
  // Seconds between each new ghost appearing (the haunting builds slowly).
  spawnIntervalSeconds: 45,
  // Opt-in: tag haunted threads with a Gmail label. Needs the gmail.modify scope.
  applyLabel: false,
  labelName: '👻 haunted',
};

const ENV = {
  UB_CREDENTIALS: ['credentialsPath', String],
  UB_VOICE_ID: ['voiceId', String],
  UB_VOICE_MODEL: ['voiceModel', String],
  UB_VOICE: ['voiceEnabled', (v) => v !== 'off' && v !== '0' && v !== 'false'],
  UB_MIN_AGE_DAYS: ['minAgeDays', Number],
  UB_MAX_AGE_DAYS: ['maxAgeDays', Number],
  UB_MAX_GHOSTS: ['maxGhosts', Number],
  UB_POLL_SECONDS: ['pollSeconds', Number],
  UB_SPAWN_SECONDS: ['spawnIntervalSeconds', Number],
  UB_LABEL: ['applyLabel', (v) => v === '1' || v === 'true' || v === 'on'],
};

// Precedence: defaults < ~/.unfinished-business/config.json < environment.
function loadConfig(env = process.env) {
  let fileConfig = {};
  const file = path.join(dataDir, 'config.json');
  if (fs.existsSync(file)) {
    fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const config = { ...DEFAULTS, ...fileConfig };
  for (const [name, [key, parse]] of Object.entries(ENV)) {
    if (env[name] !== undefined && env[name] !== '') config[key] = parse(env[name]);
  }
  config.elevenLabsApiKey = env.ELEVENLABS_API_KEY || fileConfig.elevenLabsApiKey || '';
  return config;
}

module.exports = { loadConfig, DEFAULTS, DEFAULT_VOICE_ID };
