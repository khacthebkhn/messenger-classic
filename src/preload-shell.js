'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  getState: () => ipcRenderer.invoke('shell:get-state'),
  onState: (cb) => ipcRenderer.on('shell:state', (_e, state) => cb(state)),
  navigate: (route) => ipcRenderer.send('shell:navigate', route),
  openMenu: (x, y) => ipcRenderer.send('shell:menu', { x, y }),
  toggleRail: () => ipcRenderer.send('shell:toggle-rail'),
  setBadge: (dataUrl, count) => ipcRenderer.send('shell:badge', { dataUrl, count }),
});
