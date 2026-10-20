'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanInbox, checkExorcism, searchQuery } = require('../src/gmail/scan');
const { removeLabelEverywhere } = require('../src/gmail/label');
const { NOW, ME, message, thread } = require('./fixtures');

const config = { minAgeDays: 3, maxAgeDays: 180 };

function fakeGmail(threads) {
  const byId = new Map(threads.map((t) => [t.id, t]));
  return {
    getProfile: async () => ({ emailAddress: 'Me@Example.com' }),
    listSendAs: async () => ({ sendAs: [{ sendAsEmail: 'alias@example.com' }] }),
    listThreads: async ({ q }) => {
      assert.equal(q, searchQuery(config));
      return { threads: threads.map((t) => ({ id: t.id })) };
    },
    getThread: async (id) => {
      if (!byId.has(id)) throw Object.assign(new Error('nope'), { response: { status: 404 } });
      return byId.get(id);
    },
  };
}

test('scanInbox returns only unfinished threads, oldest first', async () => {
  const gmail = fakeGmail([
    thread('newer', [message({ from: 'Ana <ana@x.com>', daysAgo: 5 })]),
    thread('older', [message({ from: 'Bo <bo@x.com>', daysAgo: 60 })]),
    thread('mine', [message({ from: 'Cy <cy@x.com>', daysAgo: 9 }), message({ from: 'alias@example.com', daysAgo: 8 })]),
    thread('promo', [message({ from: 'deals@shop.com', daysAgo: 9, headers: { 'List-Unsubscribe': '<x>' } })]),
  ]);
  const { ghosts, skipped, myEmails } = await scanInbox(gmail, config, NOW);
  assert.deepEqual(ghosts.map((g) => g.threadId), ['older', 'newer']);
  assert.deepEqual(skipped, { replied: 1, automated: 1 });
  assert.deepEqual(myEmails, [ME, 'alias@example.com']);
});

test('searchQuery keeps to the inbox and skips Gmail bulk categories', () => {
  const q = searchQuery(config);
  for (const part of ['in:inbox', '-category:promotions', 'older_than:3d', 'newer_than:180d']) assert.ok(q.includes(part), part);
});

test('checkExorcism treats a vanished thread as deleted', async () => {
  const gmail = fakeGmail([thread('here', [message({ from: 'a@x.com', daysAgo: 9 })])]);
  assert.equal(await checkExorcism(gmail, 'here', [ME]), null);
  assert.equal(await checkExorcism(gmail, 'gone', [ME]), 'deleted');
});

test('removeLabelEverywhere untags every page then deletes the label', async () => {
  const modified = [];
  let deleted = null;
  const gmail = {
    listLabels: async () => ({ labels: [{ id: 'L1', name: '👻 haunted' }] }),
    listThreads: async ({ pageToken }) =>
      pageToken ? { threads: [{ id: 'c' }] } : { threads: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' },
    modifyThread: async (id, body) => modified.push([id, body]),
    deleteLabel: async (id) => (deleted = id),
  };
  assert.equal(await removeLabelEverywhere(gmail, '👻 haunted'), 3);
  assert.deepEqual(modified.map(([id]) => id), ['a', 'b', 'c']);
  assert.deepEqual(modified[0][1], { removeLabelIds: ['L1'] });
  assert.equal(deleted, 'L1');
  assert.equal(await removeLabelEverywhere({ listLabels: async () => ({ labels: [] }) }, '👻 haunted'), -1);
});
