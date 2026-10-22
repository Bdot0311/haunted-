'use strict';

const crypto = require('node:crypto');

// What each ghost says. Longer silences earn colder lines. Ellipses give the
// TTS model room to breathe, which is most of the menace.

const LINES = {
  fresh: [
    ({ name, subject, days }) => `${name}... is waiting.${subject ? ` ${subject}.` : ''} ${days}.`,
    ({ name, subject }) => `${name} wrote to you...${subject ? ` ${subject}...` : ''} You saw it. Didn't you.`,
  ],
  lingering: [
    ({ name, subject, days }) => `${name} wrote to you ${days} ago...${subject ? ` ${subject}...` : ''} You never answered.`,
    ({ name, subject, days }) => `${days}...${subject ? ` ${subject}...` : ''} ${name} keeps checking. Every day.`,
  ],
  ancient: [
    ({ name, subject, days }) => `${days}... ${name} is still waiting...${subject ? ` ${subject}...` : ''} It's alright. We can wait too.`,
    ({ name, subject, days }) => `You left ${name} in the dark... ${days}...${subject ? ` ${subject}.` : ''} We haven't forgotten.`,
  ],
};

function spokenDays(days) {
  return days === 1 ? 'one day' : `${days} days`;
}

function tier(ageDays) {
  if (ageDays >= 30) return 'ancient';
  if (ageDays >= 7) return 'lingering';
  return 'fresh';
}

// Deterministic per thread, so the same ghost always says the same thing and
// its audio is only generated once.
function pick(list, seed) {
  const n = crypto.createHash('sha256').update(seed).digest().readUInt32BE(0);
  return list[n % list.length];
}

function hauntLine(ghost) {
  const line = pick(LINES[tier(ghost.ageDays)], ghost.threadId);
  const said = line({ name: ghost.name, subject: ghost.subject, days: spokenDays(ghost.ageDays) });
  return ghost.count > 1 ? `${said} ${ghost.count} letters... unanswered.` : said;
}

function exorcismLine(ghost, reason) {
  return reason === 'replied' ? `${ghost.name}... can rest now.` : `...Gone. But ${ghost.name} will remember.`;
}

module.exports = { hauntLine, exorcismLine, tier, spokenDays };
