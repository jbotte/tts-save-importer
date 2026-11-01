'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tts', {
  // Location discovery
  candidateLocations: () => ipcRenderer.invoke('locations:candidates'),
  detectLocations: () => ipcRenderer.invoke('locations:detect'),
  scanDirectory: (dir) => ipcRenderer.invoke('saves:scan', dir),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),

  // Save inspection
  saveSummary: (p) => ipcRenderer.invoke('save:summary', p),
  saveRaw: (p) => ipcRenderer.invoke('save:raw', p),

  // Imports
  pickAndImportFiles: () => ipcRenderer.invoke('file:pick'),
  importFile: (p) => ipcRenderer.invoke('import:add', p),
  listImports: () => ipcRenderer.invoke('imports:list'),
  removeImport: (id) => ipcRenderer.invoke('imports:remove', id),
  exportImport: (id) => ipcRenderer.invoke('imports:export', id),
  restoreImport: (id) => ipcRenderer.invoke('imports:restore', id),
  openLibraryFolder: () => ipcRenderer.invoke('library:openFolder'),
  importRaw: (id) => ipcRenderer.invoke('import:raw', id),

  // Misc
  showInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  onMenuAddFolder: (cb) => ipcRenderer.on('menu:add-folder', () => cb())
});
