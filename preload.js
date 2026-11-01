'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tts', {
  // Startup (one-time migration from the old staging library)
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),

  // Location discovery
  candidateLocations: () => ipcRenderer.invoke('locations:candidates'),
  detectLocations: () => ipcRenderer.invoke('locations:detect'),
  scanDirectory: (dir) => ipcRenderer.invoke('saves:scan', dir),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),

  // Save inspection
  saveSummary: (p) => ipcRenderer.invoke('save:summary', p),
  saveRaw: (p) => ipcRenderer.invoke('save:raw', p),

  // Import = copy straight into the TTS saves folder
  pickSaveFiles: () => ipcRenderer.invoke('file:pick'),
  importToTTS: (paths, fallbackDir) => ipcRenderer.invoke('saves:import', paths, fallbackDir),

  // Misc
  showInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  onMenuAddFolder: (cb) => ipcRenderer.on('menu:add-folder', () => cb()),
  onMenuImportFile: (cb) => ipcRenderer.on('menu:import-file', () => cb())
});
