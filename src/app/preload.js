'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haunt', {
  onSpawn: (cb) => ipcRenderer.on('ghost:spawn', (_e, payload) => cb(payload)),
  onExorcise: (cb) => ipcRenderer.on('ghost:exorcise', (_e, payload) => cb(payload)),
  onBanish: (cb) => ipcRenderer.on('banish', () => cb()),
  onRestore: (cb) => ipcRenderer.on('restore', () => cb()),
  setInteractive: (interactive) => ipcRenderer.send('overlay:interactive', Boolean(interactive)),
  openThread: (threadId) => ipcRenderer.send('ghost:open', String(threadId)),
});
