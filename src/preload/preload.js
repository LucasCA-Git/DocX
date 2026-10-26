'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The only surface the UI gets: no Node, no fs, no AWS credentials.
contextBridge.exposeInMainWorld('docs', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  chooseFolder: () => ipcRenderer.invoke('vault:choose'),
  list: () => ipcRenderer.invoke('vault:list'),
  read: (rel) => ipcRenderer.invoke('vault:read', rel),
  readTexts: (rels) => ipcRenderer.invoke('vault:read-texts', rels),
  write: (rel, text) => ipcRenderer.invoke('vault:write', rel, text),
  create: (rel) => ipcRenderer.invoke('vault:create', rel),
  createBinary: (rel, bytes) => ipcRenderer.invoke('vault:create-binary', rel, bytes),
  copy: (from, to) => ipcRenderer.invoke('vault:copy', from, to),
  revealInFolder: (rel) => ipcRenderer.invoke('vault:reveal', rel),
  mkdir: (rel) => ipcRenderer.invoke('vault:mkdir', rel),
  rename: (from, to) => ipcRenderer.invoke('vault:rename', from, to),
  remove: (rel) => ipcRenderer.invoke('vault:delete', rel),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  history: (rel) => ipcRenderer.invoke('history:list', rel),
  readVersion: (sha, rel) => ipcRenderer.invoke('history:read', sha, rel),
  onSyncStatus: (cb) => subscribe('sync:status', cb),
  onVaultChanged: (cb) => subscribe('vault:changed', cb),
  onConflict: (cb) => subscribe('sync:conflict', cb),
  onBeforeClose: (cb) => subscribe('app:before-close', cb),
  closeReady: () => ipcRenderer.invoke('app:close-ready'),
});
