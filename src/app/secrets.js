'use strict';

// The ElevenLabs key, kept encrypted on disk with the OS keychain
// (Electron safeStorage), so it never sits in a plain-text file.

const fs = require('node:fs');
const { safeStorage } = require('electron');
const paths = require('../paths');

function loadVoiceKey() {
  if (!fs.existsSync(paths.voiceKey) || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(fs.readFileSync(paths.voiceKey));
  } catch {
    return '';
  }
}

function saveVoiceKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain is not available.');
  paths.ensureDir(paths.dataDir);
  fs.writeFileSync(paths.voiceKey, safeStorage.encryptString(key.trim()), { mode: 0o600 });
}

function clearVoiceKey() {
  fs.rmSync(paths.voiceKey, { force: true });
}

module.exports = { loadVoiceKey, saveVoiceKey, clearVoiceKey };
