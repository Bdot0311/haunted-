'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, shell, dialog, nativeImage } = require('electron');
const paths = require('../paths');
const { loadConfig } = require('../config');
const { getAuthClient, isSignedIn, readClientSecrets } = require('../gmail/auth');
const { createGmail } = require('../gmail/client');
const { scanInbox, checkExorcism, myAddresses } = require('../gmail/scan');
const { ensureLabel, tagThread, untagThread } = require('../gmail/label');
const { hauntLine, exorcismLine } = require('../voice/script');
const { speak } = require('../voice/tts');
const { loadVoiceKey, saveVoiceKey, clearVoiceKey } = require('./secrets');
const { uninstall } = require('../uninstall');

const KILL_SWITCH = 'CommandOrControl+Alt+Shift+G';
const RESCAN_EVERY_POLLS = 5;
const HELP_URL = 'https://github.com/Bdot0311/haunted-#setup-macos';

const config = loadConfig();
let gmail = null;
let myEmails = [];
let control;
let overlay;
let tray;
let labelId = null;
let haunting = false;
let banished = false;
let voiceError = null;

const queue = []; // ghosts waiting to appear
const active = new Map(); // threadId -> ghost on screen
const laidToRest = new Set(); // exorcised this session; never re-summoned
let spawnTimer;
let pollTimer;
let polls = 0;
let polling = false;

function log(...args) {
  console.log('[haunt]', ...args);
}

// ---- status for the control room ---------------------------------------------

function status() {
  return {
    hasCredentials: fs.existsSync(config.credentialsPath),
    signedIn: isSignedIn(config),
    email: myEmails[0] || null,
    hasVoiceKey: Boolean(config.elevenLabsApiKey),
    voiceEnabled: config.voiceEnabled,
    voiceError,
    haunting,
    banished,
    pace: config.spawnIntervalSeconds,
    active: [...active.values()].map(({ name, ageDays, subject }) => ({ name, ageDays, subject })),
    waiting: queue.length,
    exorcised: laidToRest.size,
  };
}

function pushStatus() {
  if (control && !control.isDestroyed()) control.webContents.send('status', status());
  updateTray();
}

async function ensureGmail(interactive) {
  if (!gmail) {
    gmail = createGmail(await getAuthClient(config, { interactive, open: (url) => shell.openExternal(url) }));
  }
  if (myEmails.length === 0) myEmails = await myAddresses(gmail);
  return gmail;
}

async function voiceFor(text) {
  try {
    const file = await speak(text, config);
    return file ? fs.readFileSync(file) : null;
  } catch (err) {
    if (!voiceError) log('voice failed:', err.message);
    voiceError = err.message;
    pushStatus();
    return null;
  }
}

function send(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

// ---- haunting ---------------------------------------------------------------

function enqueue(ghosts) {
  const known = new Set([...active.keys(), ...queue.map((g) => g.threadId), ...laidToRest]);
  for (const ghost of ghosts) if (!known.has(ghost.threadId)) queue.push(ghost);
  queue.sort((a, b) => b.ageDays - a.ageDays);
}

async function rescan() {
  const result = await scanInbox(await ensureGmail(false), config);
  myEmails = result.myEmails;
  // Drop queued ghosts that resolved before they ever appeared.
  const stillUnfinished = new Set(result.ghosts.map((g) => g.threadId));
  for (let i = queue.length - 1; i >= 0; i--) if (!stillUnfinished.has(queue[i].threadId)) queue.splice(i, 1);
  enqueue(result.ghosts);
  log(`scan: ${result.ghosts.length} unanswered, ${queue.length} queued, ${active.size} haunting`);
  pushStatus();
  return result;
}

async function spawnNext() {
  if (!haunting || banished || active.size >= config.maxGhosts || queue.length === 0) return;
  const ghost = queue.shift();
  active.set(ghost.threadId, ghost);
  const line = hauntLine(ghost);
  log(`summoning ${ghost.name} (${ghost.ageDays}d): "${line}"`);
  pushStatus();
  send('ghost:spawn', { ghost, line, audio: await voiceFor(line) });
  if (labelId) await tagThread(gmail, ghost.threadId, labelId).catch((err) => log('label failed:', err.message));
}

async function exorcise(ghost, reason) {
  active.delete(ghost.threadId);
  laidToRest.add(ghost.threadId);
  log(`exorcised ${ghost.name}: ${reason}`);
  pushStatus();
  send('ghost:exorcise', { threadId: ghost.threadId, reason, audio: await voiceFor(exorcismLine(ghost, reason)) });
  if (labelId && reason !== 'deleted') {
    await untagThread(gmail, ghost.threadId, labelId).catch((err) => log('unlabel failed:', err.message));
  }
}

async function poll() {
  if (polling) return;
  polling = true;
  polls++;
  try {
    for (const ghost of [...active.values()]) {
      try {
        const reason = await checkExorcism(gmail, ghost.threadId, myEmails);
        if (reason) await exorcise(ghost, reason);
      } catch (err) {
        log('check failed:', err.message);
      }
    }
    if (polls % RESCAN_EVERY_POLLS === 0) await rescan().catch((err) => log('scan failed:', err.message));
  } finally {
    polling = false;
  }
}

function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through by default; the overlay only catches the mouse over a ghost.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
  return new Promise((resolve) => overlay.webContents.once('did-finish-load', resolve));
}

async function startHaunting() {
  if (haunting) return;
  await ensureGmail(false);
  if (config.applyLabel && !labelId) {
    labelId = await ensureLabel(gmail, config.labelName).catch((err) => {
      log('could not create label, continuing without it:', err.message);
      return null;
    });
  }
  if (queue.length === 0) await rescan();
  await createOverlay();
  haunting = true;
  banished = false;
  await spawnNext();
  spawnTimer = setInterval(spawnNext, config.spawnIntervalSeconds * 1000);
  pollTimer = setInterval(poll, config.pollSeconds * 1000);
  pushStatus();
}

function stopHaunting() {
  clearInterval(spawnTimer);
  clearInterval(pollTimer);
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
  // Ghosts still on screen go back to waiting; they are not resolved.
  enqueue([...active.values()]);
  active.clear();
  haunting = false;
  banished = false;
  pushStatus();
}

// The kill switch: hide and silence everything instantly.
function setBanished(value) {
  if (!haunting) return;
  banished = value;
  if (banished) {
    send('banish');
    overlay.hide();
  } else {
    overlay.showInactive();
    send('restore');
  }
  pushStatus();
}

// ---- control room -----------------------------------------------------------

function showControl() {
  if (control && !control.isDestroyed()) {
    control.show();
    control.focus();
    return;
  }
  control = new BrowserWindow({
    width: 560,
    height: Math.min(780, screen.getPrimaryDisplay().workAreaSize.height - 40),
    minWidth: 480,
    minHeight: 560,
    title: 'Unfinished Business',
    backgroundColor: '#0b0b10',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'control-preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  control.loadFile(path.join(__dirname, 'control.html'));
  control.once('ready-to-show', () => control.show());
  // Closing the window keeps the haunting going; quit from the menu bar.
  control.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      control.hide();
    }
  });
}

// Every handler returns { ok, value } or { ok: false, error } so the window can
// show a plain message instead of a stack trace.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      log(`${channel} failed:`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

function wireIpc() {
  handle('control:status', () => status());

  handle('control:chooseCredentials', async () => {
    const pick = await dialog.showOpenDialog(control, {
      title: 'Choose your Google OAuth client file',
      buttonLabel: 'Use this file',
      properties: ['openFile'],
      filters: [{ name: 'Google client JSON', extensions: ['json'] }],
    });
    if (pick.canceled || pick.filePaths.length === 0) return status();
    readClientSecrets(pick.filePaths[0]); // throws a readable error if it's the wrong file
    paths.ensureDir(paths.dataDir);
    fs.copyFileSync(pick.filePaths[0], paths.credentials);
    fs.chmodSync(paths.credentials, 0o600);
    config.credentialsPath = paths.credentials;
    gmail = null;
    return status();
  });

  handle('control:signIn', async () => {
    await ensureGmail(true);
    app.focus({ steal: true });
    showControl();
    return status();
  });

  handle('control:saveVoiceKey', (key) => {
    if (!key || !key.trim()) throw new Error('Paste your ElevenLabs API key first.');
    saveVoiceKey(key);
    config.elevenLabsApiKey = key.trim();
    voiceError = null;
    return status();
  });

  handle('control:setVoiceEnabled', (enabled) => {
    config.voiceEnabled = Boolean(enabled);
    return status();
  });

  handle('control:previewVoice', async () => {
    const sample = queue[0] || [...active.values()][0];
    const line = sample ? hauntLine(sample) : 'Somewhere in your inbox... someone is still waiting.';
    const file = await speak(line, { ...config, voiceEnabled: true });
    voiceError = null;
    return { line, audio: fs.readFileSync(file) };
  });

  handle('control:scan', async () => {
    const { ghosts, skipped } = await rescan();
    return {
      total: ghosts.length,
      skipped,
      ghosts: ghosts.slice(0, 12).map(({ name, ageDays, subject }) => ({ name, ageDays, subject })),
    };
  });

  handle('control:setPace', (seconds) => {
    config.spawnIntervalSeconds = Math.max(3, Number(seconds) || 45);
    if (haunting) {
      clearInterval(spawnTimer);
      spawnTimer = setInterval(spawnNext, config.spawnIntervalSeconds * 1000);
    }
    return status();
  });

  handle('control:start', async () => {
    await startHaunting();
    return status();
  });

  handle('control:stop', () => {
    stopHaunting();
    return status();
  });

  handle('control:banish', () => {
    setBanished(!banished);
    return status();
  });

  handle('control:uninstall', async () => {
    const { response } = await dialog.showMessageBox(control, {
      type: 'warning',
      buttons: ['Cancel', 'Undo everything'],
      defaultId: 0,
      cancelId: 0,
      message: 'Undo everything?',
      detail:
        'This removes the 👻 haunted label from Gmail (if it was used), revokes the app’s Google access, and deletes your saved sign-in, voice key and cached voices. Your email itself is never touched.',
    });
    if (response !== 1) return null;
    stopHaunting();
    const steps = await uninstall(config);
    clearVoiceKey();
    gmail = null;
    myEmails = [];
    labelId = null;
    queue.length = 0;
    laidToRest.clear();
    config.elevenLabsApiKey = '';
    pushStatus();
    return steps;
  });

  handle('control:help', () => shell.openExternal(HELP_URL));

  // From the ghost overlay.
  ipcMain.on('overlay:interactive', (_e, interactive) => {
    if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('ghost:open', (_e, threadId) => {
    if (!active.has(threadId)) return;
    const account = encodeURIComponent(myEmails[0] || '');
    shell.openExternal(`https://mail.google.com/mail/?authuser=${account}#all/${encodeURIComponent(threadId)}`);
  });
}

// ---- menu bar -----------------------------------------------------------------

function updateTray() {
  if (!tray) return;
  tray.setTitle(banished ? '🕯️' : active.size ? `👻 ${active.size}` : '👻');
  const line = !haunting
    ? 'Not haunting'
    : banished
      ? 'Banished. The house is quiet.'
      : `${active.size} haunting · ${queue.length} waiting`;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: line, enabled: false },
      { type: 'separator' },
      { label: 'Open Control Room', click: showControl },
      {
        label: banished ? 'Let them back in' : 'Banish all',
        accelerator: KILL_SWITCH,
        enabled: haunting,
        click: () => setBanished(!banished),
      },
      { label: 'Stop haunting', enabled: haunting, click: stopHaunting },
      { type: 'separator' },
      { label: 'Quit Unfinished Business', role: 'quit' },
    ])
  );
}

// ---- lifecycle ------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showControl);
  app.whenReady().then(() => {
    if (!config.elevenLabsApiKey) config.elevenLabsApiKey = loadVoiceKey();
    wireIpc();
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip('Unfinished Business');
    updateTray();
    if (!globalShortcut.register(KILL_SWITCH, () => setBanished(!banished))) {
      log(`could not register ${KILL_SWITCH}; use the menu bar 👻 to banish`);
    }
    showControl();
    // Already signed in from a previous run: fetch the address quietly.
    if (isSignedIn(config)) ensureGmail(false).then(pushStatus).catch((err) => log('sign-in check failed:', err.message));
  });
  app.on('activate', showControl);
  app.on('before-quit', () => {
    app.isQuitting = true;
  });
  app.on('window-all-closed', (e) => e.preventDefault());
  app.on('will-quit', () => {
    clearInterval(spawnTimer);
    clearInterval(pollTimer);
    globalShortcut.unregisterAll();
  });
}
