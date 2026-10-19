#!/usr/bin/env node
'use strict';

// Undo everything Unfinished Business ever did:
//  1. remove the "👻 haunted" label from every thread and delete it (if it exists)
//  2. revoke the app's Google access
//  3. delete the stored token and cached voice audio
// Your credentials.json and config.json stay unless you pass --all.

const fs = require('node:fs');
const paths = require('../src/paths');
const { loadConfig } = require('../src/config');
const { getAuthClient, readToken, tokenCovers, revoke, MODIFY } = require('../src/gmail/auth');
const { createGmail } = require('../src/gmail/client');
const { removeLabelEverywhere } = require('../src/gmail/label');

async function main() {
  const all = process.argv.includes('--all');
  const config = loadConfig();
  const token = readToken();

  if (token && tokenCovers(token, [MODIFY])) {
    const gmail = createGmail(await getAuthClient({ ...config, applyLabel: true }, { interactive: false }));
    const removed = await removeLabelEverywhere(gmail, config.labelName);
    console.log(removed < 0 ? 'No haunted label found.' : `Removed "${config.labelName}" from ${removed} thread(s) and deleted the label.`);
  } else {
    console.log('The app never had permission to label mail, so there is no label to remove.');
  }

  if (token) {
    try {
      await revoke(config);
      console.log('Revoked Google access.');
    } catch (err) {
      console.log(`Could not revoke access automatically (${err.message}).\nRemove it at https://myaccount.google.com/permissions`);
    }
  }

  const targets = all ? [paths.dataDir] : [paths.token, paths.voiceCache];
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  console.log(all ? `Deleted ${paths.dataDir}.` : 'Deleted stored token and voice cache.');
  console.log('The house is clean. 🕯️');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
