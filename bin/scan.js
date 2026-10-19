#!/usr/bin/env node
'use strict';

// Signs in (first run only) and lists the threads that would haunt you.
// Read-only: nothing in Gmail changes. Pass --json for machine output and
// --speak to pre-generate each ghost's voice line into the local cache.

const { loadConfig } = require('../src/config');
const { getAuthClient } = require('../src/gmail/auth');
const { createGmail } = require('../src/gmail/client');
const { scanInbox } = require('../src/gmail/scan');
const { hauntLine } = require('../src/voice/script');
const { speak } = require('../src/voice/tts');

async function main() {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();
  const gmail = createGmail(await getAuthClient(config));
  const { ghosts, skipped, myEmails } = await scanInbox(gmail, config);

  if (args.has('--json')) {
    console.log(JSON.stringify({ ghosts, skipped }, null, 2));
    return;
  }

  console.log(`\nInbox of ${myEmails[0]}`);
  console.log(`Ignored: ${Object.entries(skipped).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}\n`);
  if (ghosts.length === 0) {
    console.log('No unfinished business. The house is quiet... for now.');
    return;
  }

  const shown = ghosts.slice(0, config.maxGhosts);
  for (const g of shown) {
    console.log(`👻 ${String(g.ageDays).padStart(3)}d  ${g.name.padEnd(14)} ${g.subject || '(no subject)'}`);
    console.log(`       "${hauntLine(g)}"`);
    if (args.has('--speak')) console.log(`       ${await speak(hauntLine(g), config)}`);
  }
  if (ghosts.length > shown.length) console.log(`\n…and ${ghosts.length - shown.length} more waiting their turn.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
