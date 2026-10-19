'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Everything the app stores lives in one folder, so `npm run uninstall-haunt`
// can remove all of it.
const dataDir = process.env.UB_DATA_DIR || path.join(os.homedir(), '.unfinished-business');

const paths = {
  dataDir,
  token: path.join(dataDir, 'token.json'),
  voiceCache: path.join(dataDir, 'voice-cache'),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

module.exports = { ...paths, ensureDir };
