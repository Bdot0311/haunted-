#!/usr/bin/env node
'use strict';

// Command-line twin of the app's "Undo everything" button. See src/uninstall.js.
// Your credentials.json and config.json stay unless you pass --all.

const { loadConfig } = require('../src/config');
const { uninstall } = require('../src/uninstall');

uninstall(loadConfig(), { all: process.argv.includes('--all') })
  .then((steps) => {
    for (const step of steps) console.log(step);
    console.log('The house is clean. 🕯️');
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
