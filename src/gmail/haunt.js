'use strict';

// Pure rules for deciding which Gmail threads are "unfinished business".
// Input is a thread as returned by threads.get?format=metadata.

const DAY_MS = 24 * 60 * 60 * 1000;

const AUTOMATED_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?|alerts?)([._+-]|@)/i;

function header(message, name) {
  const headers = (message.payload && message.payload.headers) || [];
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : '';
}

function parseAddress(value) {
  if (!value) return { name: '', email: '' };
  const angle = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) return { name: angle[1].trim(), email: angle[2].trim().toLowerCase() };
  return { name: '', email: value.trim().toLowerCase() };
}

function hasLabel(message, label) {
  return (message.labelIds || []).includes(label);
}

function realMessages(thread) {
  return (thread.messages || [])
    .filter((m) => !hasLabel(m, 'DRAFT'))
    .sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
}

function isFromMe(message, myEmails) {
  if (hasLabel(message, 'SENT')) return true;
  const { email } = parseAddress(header(message, 'From'));
  return myEmails.includes(email);
}

function isAutomated(message) {
  if (header(message, 'List-Unsubscribe') || header(message, 'List-Id')) return true;
  if (/^(bulk|list|junk)$/i.test(header(message, 'Precedence').trim())) return true;
  const autoSubmitted = header(message, 'Auto-Submitted').trim();
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true;
  const { email } = parseAddress(header(message, 'From'));
  return AUTOMATED_SENDER.test(email);
}

function cleanSubject(subject) {
  let s = (subject || '').replace(/\s+/g, ' ').trim();
  // Drop any number of reply/forward prefixes: "Re: Fwd: RE:" -> "".
  while (/^(re|fwd?|fw|aw|sv)\s*(\[\d+\])?\s*:\s*/i.test(s)) {
    s = s.replace(/^(re|fwd?|fw|aw|sv)\s*(\[\d+\])?\s*:\s*/i, '');
  }
  // URLs and addresses read terribly aloud and are the most identifying bits.
  s = s.replace(/https?:\/\/\S+/gi, '').replace(/\S+@\S+\.\S+/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 80) s = s.slice(0, 80).replace(/\s+\S*$/, '') + '…';
  return s;
}

function spokenName(from) {
  const name = from.name.replace(/["']/g, '').trim();
  if (name) {
    // "Lee, Sarah" -> "Sarah"; "Sarah Lee" -> "Sarah".
    const first = name.includes(',') ? name.split(',')[1].trim().split(/\s+/)[0] : name.split(/\s+/)[0];
    if (first) return first;
  }
  const local = (from.email.split('@')[0] || 'someone').split(/[._+-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// Returns a ghost description, or { skip: reason } when the thread should not haunt.
function classifyThread(thread, myEmails, now, { minAgeDays, maxAgeDays }) {
  const messages = realMessages(thread);
  if (messages.length === 0) return { skip: 'empty' };
  if (!messages.some((m) => hasLabel(m, 'INBOX'))) return { skip: 'not-in-inbox' };

  const last = messages[messages.length - 1];
  if (isFromMe(last, myEmails)) return { skip: 'replied' };
  if (isAutomated(last)) return { skip: 'automated' };

  const receivedAt = Number(last.internalDate);
  const ageDays = Math.floor((now - receivedAt) / DAY_MS);
  if (ageDays < minAgeDays) return { skip: 'too-fresh' };
  if (ageDays > maxAgeDays) return { skip: 'too-old' };

  const from = parseAddress(header(last, 'From'));
  const firstSubject = header(messages[0], 'Subject') || header(last, 'Subject');
  return {
    threadId: thread.id,
    from,
    name: spokenName(from),
    subject: cleanSubject(firstSubject),
    receivedAt,
    ageDays,
  };
}

// One ghost per person: their oldest unanswered thread, carrying how many
// threads from them are waiting. Once that one is dealt with, the next scan
// sends their next-oldest. Sorted oldest (most haunting) first.
function onePerSender(ghosts) {
  const bySender = new Map();
  for (const ghost of ghosts) {
    const key = ghost.from.email;
    const current = bySender.get(key);
    if (!current) bySender.set(key, { ...ghost, count: 1 });
    else {
      const count = current.count + 1;
      bySender.set(key, ghost.ageDays > current.ageDays ? { ...ghost, count } : { ...current, count });
    }
  }
  return [...bySender.values()].sort((a, b) => b.ageDays - a.ageDays);
}

// 'replied' | 'archived' | null. A thread is laid to rest only by real action:
// you answered it, or it left your inbox (archived, trashed or deleted).
function exorcismReason(thread, myEmails) {
  const messages = realMessages(thread);
  if (messages.length === 0) return 'archived';
  if (isFromMe(messages[messages.length - 1], myEmails)) return 'replied';
  if (!messages.some((m) => hasLabel(m, 'INBOX'))) return 'archived';
  return null;
}

module.exports = {
  classifyThread,
  exorcismReason,
  onePerSender,
  cleanSubject,
  spokenName,
  parseAddress,
  isAutomated,
  DAY_MS,
};
