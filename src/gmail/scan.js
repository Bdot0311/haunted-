'use strict';

const { classifyThread, exorcismReason, onePerSender } = require('./haunt');

const METADATA_HEADERS = ['From', 'Subject', 'Date', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted'];
const MAX_THREADS = 250;
const CONCURRENCY = 8;

async function myAddresses(gmail) {
  const profile = await gmail.getProfile();
  const emails = new Set([profile.emailAddress.toLowerCase()]);
  try {
    const { sendAs = [] } = await gmail.listSendAs();
    for (const alias of sendAs) emails.add(alias.sendAsEmail.toLowerCase());
  } catch {
    // Aliases are a nicety; the primary address is enough to tell replies apart.
  }
  return [...emails];
}

function searchQuery({ minAgeDays, maxAgeDays }) {
  return [
    'in:inbox',
    '-in:chats',
    '-category:promotions',
    '-category:social',
    '-category:updates',
    '-category:forums',
    `older_than:${minAgeDays}d`,
    `newer_than:${maxAgeDays}d`,
  ].join(' ');
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function listCandidateIds(gmail, config) {
  const ids = [];
  let pageToken;
  do {
    const page = await gmail.listThreads({ q: searchQuery(config), maxResults: 100, pageToken });
    for (const t of page.threads || []) ids.push(t.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_THREADS);
  return ids.slice(0, MAX_THREADS);
}

// Returns { ghosts, skipped } where ghosts are sorted oldest (most haunting) first.
async function scanInbox(gmail, config, now = Date.now()) {
  const myEmails = await myAddresses(gmail);
  const ids = await listCandidateIds(gmail, config);
  const threads = await mapLimit(ids, CONCURRENCY, (id) => gmail.getThread(id, METADATA_HEADERS));

  const ignored = new Set((config.ignoredSenders || []).map((e) => e.toLowerCase()));
  const unanswered = [];
  const skipped = {};
  for (const thread of threads) {
    let result = classifyThread(thread, myEmails, now, config);
    if (!result.skip && ignored.has(result.from.email)) result = { skip: 'ignored' };
    if (result.skip) skipped[result.skip] = (skipped[result.skip] || 0) + 1;
    else unanswered.push(result);
  }
  return { ghosts: onePerSender(unanswered), skipped, myEmails };
}

// 'replied' | 'archived' | 'deleted' | null (still unfinished).
async function checkExorcism(gmail, threadId, myEmails) {
  try {
    return exorcismReason(await gmail.getThread(threadId, ['From']), myEmails);
  } catch (err) {
    const status = err.response ? err.response.status : err.status;
    if (status === 404) return 'deleted';
    throw err;
  }
}

module.exports = { scanInbox, checkExorcism, searchQuery, myAddresses };
