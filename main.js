'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const { candidateSaveDirs, detectSaveLocations, scanSaveDirectory, isDir } = require('./src/tts-locations');
const { summarizeSaveFile, readRawPreview } = require('./src/save-parser');
const { pickImportDir, importOne } = require('./src/import-to-game');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 920,
    minHeight: 580,
    backgroundColor: '#14161b',
    title: 'TTS Save Importer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Import Save File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('menu:import-file');
          }
        },
        {
          label: 'Add Save Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('menu:add-folder');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- import destination logic lives in src/import-to-game.js ----------

// One-time migration: the old version staged imports in a library folder.
// Move any leftovers straight into the game's saves, then retire the manifest.
async function migrateLegacyLibrary() {
  const out = { migrated: [], pending: false };
  const libDir = path.join(app.getPath('userData'), 'library');
  const manifestPath = path.join(libDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    return out; // no old library — nothing to do
  }
  if (!manifest || !Array.isArray(manifest.items) || !manifest.items.length) return out;

  const destDir = pickImportDir(null);
  if (!destDir) {
    out.pending = true;
    return out; // try again next launch
  }
  for (const item of manifest.items) {
    const src = path.join(libDir, 'items', item.id, item.fileName || '');
    try {
      await fsp.access(src);
      JSON.parse(await fsp.readFile(src, 'utf8')); // never copy junk into the game folder
      let dest = path.join(destDir, path.basename(src));
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(destDir, path.basename(src).replace(/\.json$/i, '') + `-${n++}.json`);
      }
      await fsp.copyFile(src, dest);
      out.migrated.push(dest);
    } catch {
      /* skip unreadable entries; originals stay on disk under library/ */
    }
  }
  try {
    await fsp.rename(manifestPath, manifestPath + '.migrated');
  } catch {
    /* fine */
  }
  return out;
}

// ---------- IPC ----------
ipcMain.handle('app:bootstrap', () => migrateLegacyLibrary());

ipcMain.handle('locations:candidates', () =>
  candidateSaveDirs().map((p) => ({ path: p, exists: isDir(p) }))
);

ipcMain.handle('locations:detect', () => detectSaveLocations());

ipcMain.handle('saves:scan', (_e, dir) => {
  if (typeof dir !== 'string' || !dir) return { dir: String(dir), error: 'Invalid directory', entries: [] };
  return scanSaveDirectory(dir);
});

ipcMain.handle('save:summary', (_e, p) => {
  if (typeof p !== 'string') return { error: 'Invalid path' };
  return summarizeSaveFile(p);
});

ipcMain.handle('save:raw', (_e, p) => {
  if (typeof p !== 'string') return { error: 'Invalid path' };
  return readRawPreview(p);
});

ipcMain.handle('folder:pick', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a Tabletop Simulator Saves folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths.length) return null;
  return scanSaveDirectory(r.filePaths[0]);
});

ipcMain.handle('file:pick', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import save into Tabletop Simulator',
    buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Tabletop Simulator save (*.json)', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths;
});

ipcMain.handle('saves:import', async (_e, filePaths, fallbackDir) => {
  const list = Array.isArray(filePaths) ? filePaths : [filePaths];
  const results = [];
  for (const p of list) results.push(await importOne(p, fallbackDir));
  return results;
});

ipcMain.handle('shell:showItem', (_e, p) => {
  if (typeof p === 'string' && p) shell.showItemInFolder(p);
  return true;
});

// ---------- Lifecycle ----------
app.setName('TTS Save Importer');

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
