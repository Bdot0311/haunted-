'use strict';

// Minimal Gmail REST wrapper over an authorized google-auth-library client.

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

function createGmail(auth) {
  async function call(method, path, { params, body } = {}) {
    const res = await auth.request({ url: BASE + path + query(params), method, data: body });
    return res.data;
  }

  return {
    getProfile: () => call('GET', '/profile'),
    listSendAs: () => call('GET', '/settings/sendAs'),
    listThreads: (params) => call('GET', '/threads', { params }),
    getThread: (id, metadataHeaders) =>
      call('GET', `/threads/${encodeURIComponent(id)}`, { params: { format: 'metadata', metadataHeaders } }),
    modifyThread: (id, body) => call('POST', `/threads/${encodeURIComponent(id)}/modify`, { body }),
    listLabels: () => call('GET', '/labels'),
    createLabel: (body) => call('POST', '/labels', { body }),
    deleteLabel: (id) => call('DELETE', `/labels/${encodeURIComponent(id)}`),
  };
}

module.exports = { createGmail };
