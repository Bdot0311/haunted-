'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('control', {
  status: call('control:status'),
  chooseCredentials: call('control:chooseCredentials'),
  signIn: call('control:signIn'),
  saveVoiceKey: call('control:saveVoiceKey'),
  setVoiceEnabled: call('control:setVoiceEnabled'),
  previewVoice: call('control:previewVoice'),
  scan: call('control:scan'),
  ignoreSender: call('control:ignoreSender'),
  setPace: call('control:setPace'),
  start: call('control:start'),
  stop: call('control:stop'),
  banish: call('control:banish'),
  uninstall: call('control:uninstall'),
  help: call('control:help'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, status) => cb(status)),
});
