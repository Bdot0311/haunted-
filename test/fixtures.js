'use strict';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const ME = 'me@example.com';

let nextId = 1;

function message({ from, subject = 'Hello', daysAgo, labels = ['INBOX'], headers = {} }) {
  return {
    id: `m${nextId++}`,
    labelIds: labels,
    internalDate: String(NOW - daysAgo * DAY),
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        ...Object.entries(headers).map(([name, value]) => ({ name, value })),
      ],
    },
  };
}

function thread(id, messages) {
  return { id, messages };
}

module.exports = { DAY, NOW, ME, message, thread };
