'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { OAuth2Client } = require('google-auth-library');
const paths = require('../paths');

const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
// Only requested when you opt into the "👻 haunted" label. Lets the app add and
// remove that one label; the app never sends, deletes or edits mail.
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

function scopesFor(config) {
  return config.applyLabel ? [MODIFY] : [READONLY];
}

function readClientSecrets(credentialsPath) {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `No Google OAuth client found at ${credentialsPath}.\n` +
        'Create a "Desktop app" OAuth client in Google Cloud (Gmail API enabled),\n' +
        'download its JSON and save it there, or point UB_CREDENTIALS at it.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const secrets = raw.installed || raw.web;
  if (!secrets || !secrets.client_id) throw new Error(`${credentialsPath} is not an OAuth client file.`);
  return secrets;
}

function readToken() {
  if (!fs.existsSync(paths.token)) return null;
  return JSON.parse(fs.readFileSync(paths.token, 'utf8'));
}

function saveToken(token) {
  paths.ensureDir(paths.dataDir);
  fs.writeFileSync(paths.token, JSON.stringify(token, null, 2), { mode: 0o600 });
}

function tokenCovers(token, scopes) {
  const granted = (token.scope || '').split(/\s+/);
  // gmail.modify is a superset of gmail.readonly.
  return scopes.every((s) => granted.includes(s) || (s === READONLY && granted.includes(MODIFY)));
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

// Runs the installed-app loopback flow: a one-shot server on 127.0.0.1 catches
// Google's redirect, so the code never leaves this machine.
async function signIn(secrets, scopes, open) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const client = new OAuth2Client(secrets.client_id, secrets.client_secret, redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = Math.random().toString(36).slice(2);

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const gotCode = url.searchParams.get('code');
      if (error || !gotCode || url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Sign-in failed. You can close this tab.');
        reject(new Error(`Google sign-in failed: ${error || 'missing code or bad state'}`));
        return;
      }
      res
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<body style="background:#000;color:#ccc;font:16px monospace;padding:3em">They know where you live now. You can close this tab.</body>');
      resolve(gotCode);
    });
    console.log('Opening Google sign-in in your browser…\nIf it does not open, visit:\n' + authUrl);
    open(authUrl);
  }).finally(() => server.close());

  const { tokens } = await client.getToken({ code, codeVerifier });
  return tokens;
}

async function getAuthClient(config, { open = openInBrowser, interactive = true } = {}) {
  const secrets = readClientSecrets(config.credentialsPath);
  const scopes = scopesFor(config);
  let token = readToken();

  if (!token || !tokenCovers(token, scopes)) {
    if (!interactive) {
      throw new Error('Gmail sign-in needed for these permissions. Run `npm run scan` with the same settings first.');
    }
    token = await signIn(secrets, scopes, open);
    saveToken(token);
  }

  const client = new OAuth2Client(secrets.client_id, secrets.client_secret);
  client.setCredentials(token);
  // Persist refreshed access tokens, keeping the refresh token we already have.
  client.on('tokens', (fresh) => saveToken({ ...readToken(), ...fresh }));
  return client;
}

async function revoke(config) {
  const token = readToken();
  if (!token) return false;
  const secrets = readClientSecrets(config.credentialsPath);
  const client = new OAuth2Client(secrets.client_id, secrets.client_secret);
  await client.revokeToken(token.refresh_token || token.access_token);
  return true;
}

module.exports = { getAuthClient, revoke, readToken, tokenCovers, READONLY, MODIFY };
