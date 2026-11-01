'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const { candidateSaveDirs, detectSaveLocations, scanSaveDirectory, isDir } = require('./src/tts-locations');
const { summarizeSaveFile, readRawPreview } = require('./src/save-parser');
const { ImportLibrary } = require('./src/import-library');

let mainWindow = null;
let library = null;

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
          click: () => importViaDialog()
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

async function importViaDialog() {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Tabletop Simulator save',
    buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Tabletop Simulator save (*.json)', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return [];
  const results = [];
  for (const filePath of result.filePaths) {
    results.push(await library.import(filePath));
  }
  return results;
}

// ---------- IPC ----------
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

ipcMain.handle('file:pick', () => importViaDialog());
ipcMain.handle('import:add', (_e, p) => library.import(p));
ipcMain.handle('imports:list', () => library.list());
ipcMain.handle('imports:remove', (_e, id) => library.remove(id));

ipcMain.handle('imports:export', async (_e, id) => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Export save to folder…',
    buttonLabel: 'Export here',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    return { ok: true, dest: await library.exportItem(id, r.filePaths[0]) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('imports:restore', async (_e, id) => {
  const item = await library.get(id);
  if (!item) return { ok: false, error: 'Import not found.' };
  const src = path.join(library.itemFilePath(id), item.fileName);

  // Preferred destination: Singleplayer folder of the first detected TTS Saves dir.
  let destDir = null;
  const locs = detectSaveLocations();
  if (locs.length) {
    destDir = path.join(locs[0].path, 'Singleplayer');
    try {
      await fsp.mkdir(destDir, { recursive: true });
    } catch {
      destDir = null;
    }
  }
  if (!destDir) {
    if (!mainWindow) return { ok: false, error: 'No TTS save location detected.' };
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Where should the save be restored?',
      buttonLabel: 'Restore here',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return null; // user canceled
    destDir = r.filePaths[0];
  }

  let dest = path.join(destDir, item.fileName);
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, item.fileName.replace(/\.json$/i, '') + `-${n++}.json`);
  }
  try {
    await fsp.copyFile(src, dest);
  } catch (e) {
    return { ok: false, error: `Restore failed: ${e.message}` };
  }
  return { ok: true, dest };
});

ipcMain.handle('library:openFolder', () => shell.openPath(library.baseDir));

ipcMain.handle('import:raw', async (_e, id) => {
  const item = await library.get(id);
  if (!item) return { error: 'Import not found.' };
  return readRawPreview(path.join(library.itemFilePath(id), item.fileName));
});

ipcMain.handle('shell:showItem', (_e, p) => {
  if (typeof p === 'string' && p) shell.showItemInFolder(p);
  return true;
});

// ---------- Lifecycle ----------
app.setName('TTS Save Importer');

app.whenReady().then(async () => {
  library = new ImportLibrary(path.join(app.getPath('userData'), 'library'));
  await library.init();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
