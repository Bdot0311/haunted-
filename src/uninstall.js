'use strict';

// Undo everything Unfinished Business ever did:
//  1. remove the "👻 haunted" label from every thread and delete it (if it exists)
//  2. revoke the app's Google access
//  3. delete the stored token, voice key and cached voice audio
// credentials.json and config.json stay unless `all` is set.
// Returns a list of human-readable steps that were taken.

const fs = require('node:fs');
const paths = require('./paths');
const { getAuthClient, readToken, tokenCovers, revoke, MODIFY } = require('./gmail/auth');
const { createGmail } = require('./gmail/client');
const { removeLabelEverywhere } = require('./gmail/label');

async function uninstall(config, { all = false } = {}) {
  const steps = [];
  const token = readToken();

  if (token && tokenCovers(token, [MODIFY])) {
    const gmail = createGmail(await getAuthClient({ ...config, applyLabel: true }, { interactive: false }));
    const removed = await removeLabelEverywhere(gmail, config.labelName);
    steps.push(removed < 0 ? 'No haunted label found.' : `Removed "${config.labelName}" from ${removed} thread(s) and deleted the label.`);
  } else {
    steps.push('The app never had permission to label mail, so there is no label to remove.');
  }

  if (token) {
    try {
      await revoke(config);
      steps.push('Revoked Google access.');
    } catch (err) {
      steps.push(`Could not revoke access automatically (${err.message}). Remove it at https://myaccount.google.com/permissions`);
    }
  }

  const targets = all ? [paths.dataDir] : [paths.token, paths.voiceKey, paths.voiceCache];
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  steps.push(all ? `Deleted ${paths.dataDir}.` : 'Deleted stored sign-in, voice key and voice cache.');
  return steps;
}

module.exports = { uninstall };
