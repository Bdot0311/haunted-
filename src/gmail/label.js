'use strict';

// The opt-in "👻 haunted" label. This is the app's only write to Gmail, and
// `npm run uninstall-haunt` removes it from every thread and deletes it.

async function findLabel(gmail, name) {
  const { labels = [] } = await gmail.listLabels();
  return labels.find((l) => l.name === name) || null;
}

async function ensureLabel(gmail, name) {
  const existing = await findLabel(gmail, name);
  if (existing) return existing.id;
  const created = await gmail.createLabel({
    name,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  });
  return created.id;
}

async function tagThread(gmail, threadId, labelId) {
  await gmail.modifyThread(threadId, { addLabelIds: [labelId] });
}

async function untagThread(gmail, threadId, labelId) {
  await gmail.modifyThread(threadId, { removeLabelIds: [labelId] });
}

// Returns how many threads were untagged, or -1 if the label did not exist.
async function removeLabelEverywhere(gmail, name) {
  const label = await findLabel(gmail, name);
  if (!label) return -1;
  let count = 0;
  let pageToken;
  do {
    const page = await gmail.listThreads({ labelIds: label.id, maxResults: 100, pageToken });
    for (const t of page.threads || []) {
      await untagThread(gmail, t.id, label.id);
      count++;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  await gmail.deleteLabel(label.id);
  return count;
}

module.exports = { ensureLabel, tagThread, untagThread, removeLabelEverywhere, findLabel };
