'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyThread, exorcismReason, cleanSubject, spokenName, parseAddress } = require('../src/gmail/haunt');
const { NOW, ME, message, thread } = require('./fixtures');

const opts = { minAgeDays: 3, maxAgeDays: 180 };
const classify = (t) => classifyThread(t, [ME], NOW, opts);

test('an unanswered human email becomes a ghost', () => {
  const ghost = classify(thread('t1', [message({ from: 'Sarah Lee <sarah@acme.com>', subject: 'Re: invoice for March', daysAgo: 41 })]));
  assert.deepEqual(ghost, {
    threadId: 't1',
    from: { name: 'Sarah Lee', email: 'sarah@acme.com' },
    name: 'Sarah',
    subject: 'invoice for March',
    receivedAt: NOW - 41 * 24 * 60 * 60 * 1000,
    ageDays: 41,
  });
});

test('a thread you replied to last does not haunt', () => {
  const t = thread('t2', [
    message({ from: 'Sarah <sarah@acme.com>', daysAgo: 10 }),
    message({ from: `Me <${ME}>`, daysAgo: 9, labels: ['SENT'] }),
  ]);
  assert.deepEqual(classify(t), { skip: 'replied' });
});

test('SENT label counts as yours even from an alias', () => {
  const t = thread('t3', [message({ from: 'Sarah <sarah@acme.com>', daysAgo: 10 }), message({ from: 'alias@other.com', daysAgo: 9, labels: ['SENT'] })]);
  assert.deepEqual(classify(t), { skip: 'replied' });
});

test('drafts are ignored when deciding who spoke last', () => {
  const t = thread('t4', [
    message({ from: 'Sarah <sarah@acme.com>', daysAgo: 10 }),
    message({ from: ME, daysAgo: 1, labels: ['DRAFT'] }),
  ]);
  assert.equal(classify(t).threadId, 't4');
});

test('a reply that came back to you haunts again', () => {
  const t = thread('t5', [
    message({ from: 'Sarah <sarah@acme.com>', subject: 'Lunch?', daysAgo: 20 }),
    message({ from: ME, daysAgo: 19, labels: ['SENT'] }),
    message({ from: 'Sarah <sarah@acme.com>', subject: 'Re: Lunch?', daysAgo: 12 }),
  ]);
  const ghost = classify(t);
  assert.equal(ghost.ageDays, 12);
  assert.equal(ghost.subject, 'Lunch?');
});

test('newsletters and robots are not unfinished business', () => {
  const cases = [
    { from: 'News <news@shop.com>', headers: { 'List-Unsubscribe': '<mailto:x@shop.com>' } },
    { from: 'Team <team@app.com>', headers: { Precedence: 'bulk' } },
    { from: 'Robot <robot@app.com>', headers: { 'Auto-Submitted': 'auto-generated' } },
    { from: 'GitHub <noreply@github.com>' },
    { from: 'do-not-reply@bank.com' },
    { from: 'notifications@service.io' },
  ];
  for (const c of cases) {
    assert.deepEqual(classify(thread('x', [message({ ...c, daysAgo: 10 })])), { skip: 'automated' }, c.from);
  }
});

test('Auto-Submitted: no is a human', () => {
  const t = thread('t6', [message({ from: 'Bo <bo@x.com>', daysAgo: 5, headers: { 'Auto-Submitted': 'no' } })]);
  assert.equal(classify(t).name, 'Bo');
});

test('age window: too fresh and too old are skipped', () => {
  assert.deepEqual(classify(thread('a', [message({ from: 'a@b.com', daysAgo: 1 })])), { skip: 'too-fresh' });
  assert.deepEqual(classify(thread('b', [message({ from: 'a@b.com', daysAgo: 400 })])), { skip: 'too-old' });
});

test('archived threads do not haunt', () => {
  assert.deepEqual(classify(thread('c', [message({ from: 'a@b.com', daysAgo: 9, labels: [] })])), { skip: 'not-in-inbox' });
});

test('exorcism: reply, archive, or still waiting', () => {
  const waiting = thread('e', [message({ from: 'a@b.com', daysAgo: 9 })]);
  assert.equal(exorcismReason(waiting, [ME]), null);

  const replied = thread('e', [message({ from: 'a@b.com', daysAgo: 9 }), message({ from: ME, daysAgo: 0, labels: ['SENT'] })]);
  assert.equal(exorcismReason(replied, [ME]), 'replied');

  const archived = thread('e', [message({ from: 'a@b.com', daysAgo: 9, labels: ['IMPORTANT'] })]);
  assert.equal(exorcismReason(archived, [ME]), 'archived');

  const trashed = thread('e', [message({ from: 'a@b.com', daysAgo: 9, labels: ['TRASH'] })]);
  assert.equal(exorcismReason(trashed, [ME]), 'archived');
});

test('cleanSubject strips prefixes, links and addresses', () => {
  assert.equal(cleanSubject('Re: RE: Fwd: Invoice'), 'Invoice');
  assert.equal(cleanSubject('FW[2]: quick question'), 'quick question');
  assert.equal(cleanSubject('See https://x.com/a?b=c now'), 'See now');
  assert.equal(cleanSubject('ping a.person@corp.com please'), 'ping please');
  assert.equal(cleanSubject(''), '');
  const long = cleanSubject('word '.repeat(40));
  assert.ok(long.length <= 81 && long.endsWith('…'));
});

test('spokenName picks a first name a ghost would say', () => {
  assert.equal(spokenName(parseAddress('"Sarah Lee" <s@x.com>')), 'Sarah');
  assert.equal(spokenName(parseAddress('"Lee, Sarah" <s@x.com>')), 'Sarah');
  assert.equal(spokenName(parseAddress('jordan.smith@x.com')), 'Jordan');
});
