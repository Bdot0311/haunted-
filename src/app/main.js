'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, shell, dialog, nativeImage } = require('electron');
const { loadConfig } = require('../config');
const { getAuthClient } = require('../gmail/auth');
const { createGmail } = require('../gmail/client');
const { scanInbox, checkExorcism } = require('../gmail/scan');
const { ensureLabel, tagThread, untagThread } = require('../gmail/label');
const { hauntLine, exorcismLine } = require('../voice/script');
const { speak } = require('../voice/tts');

const KILL_SWITCH = 'CommandOrControl+Alt+Shift+G';
const RESCAN_EVERY_POLLS = 5;

const config = loadConfig();
let gmail;
let myEmails = [];
let overlay;
let tray;
let labelId = null;
let banished = false;
let voiceError = null;

const queue = []; // ghosts waiting to appear
const active = new Map(); // threadId -> ghost on screen
const laidToRest = new Set(); // exorcised this session; never re-summoned
let spawnTimer;
let pollTimer;
let polls = 0;

function log(...args) {
  console.log('[haunt]', ...args);
}

async function voiceFor(text) {
  try {
    const file = await speak(text, config);
    return file ? fs.readFileSync(file) : null;
  } catch (err) {
    if (!voiceError) log('voice disabled for this session:', err.message);
    voiceError = err.message;
    updateTray();
    return null;
  }
}

function send(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

// ---- haunting -------------------------------------------------------------

function enqueue(ghosts) {
  const known = new Set([...active.keys(), ...queue.map((g) => g.threadId), ...laidToRest]);
  for (const ghost of ghosts) if (!known.has(ghost.threadId)) queue.push(ghost);
  queue.sort((a, b) => b.ageDays - a.ageDays);
}

async function spawnNext() {
  if (banished || active.size >= config.maxGhosts || queue.length === 0) return;
  const ghost = queue.shift();
  active.set(ghost.threadId, ghost);
  const line = hauntLine(ghost);
  log(`summoning ${ghost.name} (${ghost.ageDays}d): "${line}"`);
  send('ghost:spawn', { ghost, line, audio: await voiceFor(line) });
  if (labelId) await tagThread(gmail, ghost.threadId, labelId).catch((err) => log('label failed:', err.message));
  updateTray();
}

async function exorcise(ghost, reason) {
  active.delete(ghost.threadId);
  laidToRest.add(ghost.threadId);
  log(`exorcised ${ghost.name}: ${reason}`);
  send('ghost:exorcise', { threadId: ghost.threadId, reason, audio: await voiceFor(exorcismLine(ghost, reason)) });
  if (labelId && reason !== 'deleted') {
    await untagThread(gmail, ghost.threadId, labelId).catch((err) => log('unlabel failed:', err.message));
  }
  updateTray();
}

let polling = false;

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
    if (polls % RESCAN_EVERY_POLLS === 0) await rescan();
  } finally {
    polling = false;
  }
}

async function rescan() {
  try {
    const result = await scanInbox(gmail, config);
    myEmails = result.myEmails;
    // Drop queued ghosts that resolved before they ever appeared.
    const stillUnfinished = new Set(result.ghosts.map((g) => g.threadId));
    for (let i = queue.length - 1; i >= 0; i--) if (!stillUnfinished.has(queue[i].threadId)) queue.splice(i, 1);
    enqueue(result.ghosts);
    log(`scan: ${result.ghosts.length} unanswered, ${queue.length} queued, ${active.size} haunting`);
    updateTray();
  } catch (err) {
    log('scan failed:', err.message);
  }
}

// ---- kill switch ------------------------------------------------------------

function setBanished(value) {
  banished = value;
  if (banished) {
    send('banish');
    overlay.hide();
  } else {
    overlay.showInactive();
    send('restore');
  }
  updateTray();
}

// ---- windows & tray ---------------------------------------------------------

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
}

function updateTray() {
  if (!tray) return;
  tray.setTitle(banished ? '🕯️' : active.size ? `👻 ${active.size}` : '👻');
  const status = banished
    ? 'Banished. The house is quiet.'
    : `${active.size} haunting · ${queue.length} waiting`;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      ...(voiceError ? [{ label: 'Voice unavailable (see terminal)', enabled: false }] : []),
      { type: 'separator' },
      {
        label: banished ? 'Let them back in' : 'Banish all',
        accelerator: KILL_SWITCH,
        click: () => setBanished(!banished),
      },
      { label: 'Rescan inbox now', click: () => rescan().then(spawnNext) },
      { type: 'separator' },
      { label: 'Quit Unfinished Business', role: 'quit' },
    ])
  );
}

function wireIpc() {
  ipcMain.on('overlay:interactive', (_e, interactive) => {
    if (overlay) overlay.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('ghost:open', (_e, threadId) => {
    if (!active.has(threadId)) return;
    const account = encodeURIComponent(myEmails[0] || '');
    shell.openExternal(`https://mail.google.com/mail/?authuser=${account}#all/${encodeURIComponent(threadId)}`);
  });
}

async function start() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  wireIpc();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Unfinished Business');
  updateTray();

  if (!globalShortcut.register(KILL_SWITCH, () => setBanished(!banished))) {
    log(`could not register ${KILL_SWITCH}; use the menu bar 👻 to banish`);
  }

  try {
    gmail = createGmail(await getAuthClient(config, { open: (url) => shell.openExternal(url) }));
  } catch (err) {
    dialog.showErrorBox('Unfinished Business', err.message);
    app.quit();
    return;
  }

  if (config.applyLabel) {
    labelId = await ensureLabel(gmail, config.labelName).catch((err) => {
      log('could not create label, continuing without it:', err.message);
      return null;
    });
  }

  createOverlay();
  await new Promise((resolve) => overlay.webContents.once('did-finish-load', resolve));
  await rescan();
  await spawnNext();
  spawnTimer = setInterval(spawnNext, config.spawnIntervalSeconds * 1000);
  pollTimer = setInterval(poll, config.pollSeconds * 1000);
}

app.whenReady().then(start);
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => {
  clearInterval(spawnTimer);
  clearInterval(pollTimer);
  globalShortcut.unregisterAll();
});
