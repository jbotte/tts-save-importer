'use strict';
/**
 * Smoke tests — run with `npm test` (plain node, no Electron needed).
 * Fakes a Windows/Mac/Linux home folder and checks discovery, scanning,
 * parsing and the import library.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { candidateSaveDirs, scanSaveDirectory } = require('../src/tts-locations');
const { summarizeSaveFile } = require('../src/save-parser');
const { ImportLibrary } = require('../src/import-library');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-test-'));

function makeFakeSaves(root) {
  const sp = path.join(root, 'My Games', 'Tabletop Simulator', 'Saves', 'Singleplayer');
  const ws = path.join(root, 'My Games', 'Tabletop Simulator', 'Saves', 'Workshop');
  fs.mkdirSync(sp, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const save = {
    SaveName: 'My Great Game',
    GameName: 'Chess',
    Date: '10/31/26 8:15 PM',
    Table: 'ChessTable.png',
    TableID: 'Table_01',
    Gravity: 0.5,
    Turn: 3,
    States: [{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }],
    Zones: [{ Name: 'deck' }],
    Graphs: [],
    Notes: ''
  };
  fs.writeFileSync(path.join(sp, 'My Great Game.json'), JSON.stringify(save));
  fs.writeFileSync(
    path.join(root, 'My Games', 'Tabletop Simulator', 'Saves', 'Multiplayer-Casual-AUTOSAVE-1.json'),
    JSON.stringify({ ...save, SaveName: 'Casual' })
  );
  fs.writeFileSync(path.join(ws, 'broken.json'), '{ not json !!!');
  return { sp, save };
}

async function main() {
  // ---- Windows discovery (OneDrive-redirected Documents) ----
  const winHome = path.join(tmp, 'winhome');
  const { sp: winSp } = makeFakeSaves(path.join(winHome, 'Documents'));
  const winDirs = candidateSaveDirs({
    platform: 'win32',
    env: { USERPROFILE: winHome, OneDrive: path.join(winHome, 'OneDrive') },
    home: winHome
  });
  assert(
    winDirs.some((d) => d.endsWith(path.join('My Games', 'Tabletop Simulator', 'Saves'))),
    'windows candidates should include Documents\\My Games\\...\\Saves'
  );
  assert(winDirs.some((d) => d.includes('OneDrive')), 'windows candidates should include OneDrive Documents');

  const winScan = scanSaveDirectory(path.dirname(winSp));
  assert.strictEqual(winScan.error, null);
  assert.strictEqual(winScan.count, 3, 'should find 3 json files on fake windows home');
  const mp = winScan.entries.find((e) => e.name.startsWith('Multiplayer-'));
  assert.strictEqual(mp.kind, 'Multiplayer', 'root Multiplayer-* autosave classified');
  const wsEntry = winScan.entries.find((e) => e.folder === 'Workshop');
  assert.strictEqual(wsEntry.kind, 'Workshop');

  // ---- macOS discovery ----
  const macHome = path.join(tmp, 'machome');
  makeFakeSaves(path.join(macHome, 'Documents'));
  const macDirs = candidateSaveDirs({ platform: 'darwin', env: {}, home: macHome });
  assert(macDirs.length >= 2);
  assert(macDirs[0] === path.join(macHome, 'Documents', 'My Games', 'Tabletop Simulator', 'Saves'));

  // ---- Linux discovery (Proton compatdata under several steam roots) ----
  const linHome = path.join(tmp, 'linhome');
  const lib = path.join(linHome, '.local', 'share', 'Steam');
  const protonSaves = path.join(
    lib, 'steamapps', 'compatdata', '286160', 'pfx', 'drive_c', 'users', 'steamuser', 'Documents'
  );
  makeFakeSaves(protonSaves);
  // extra library via libraryfolders.vdf
  const extraLib = path.join(tmp, 'extralib');
  fs.mkdirSync(path.join(lib, 'steamapps'), { recursive: true });
  fs.writeFileSync(
    path.join(lib, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${lib.replace(/\//g, '\\\\/')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${extraLib.replace(/\//g, '\\\\/')}"\n\t}\n\t}\n}`
  );
  const linDirs = candidateSaveDirs({ platform: 'linux', env: {}, home: linHome });
  assert(
    linDirs.some((d) => d.includes(path.join('compatdata', '286160'))),
    'linux candidates should include proton compatdata/286160'
  );
  assert(linDirs.some((d) => d.startsWith(extraLib)), 'linux candidates should include libraries from libraryfolders.vdf');
  const linScan = scanSaveDirectory(
    path.join(protonSaves, 'My Games', 'Tabletop Simulator', 'Saves')
  );
  assert.strictEqual(linScan.count, 3);

  // ---- Parser: valid save ----
  const summary = await summarizeSaveFile(path.join(winSp, 'My Great Game.json'));
  assert(summary.valid, 'valid save parses');
  assert(summary.looksLikeTts);
  assert.strictEqual(summary.saveName, 'My Great Game');
  assert.strictEqual(summary.gameName, 'Chess');
  assert.strictEqual(summary.objectCount, 3);
  assert.strictEqual(summary.zoneCount, 1);

  // ---- Parser: broken json ----
  const broken = await summarizeSaveFile(path.join(path.dirname(winSp), 'Workshop', 'broken.json'));
  assert(!broken.valid && broken.error, 'broken json flagged');

  // ---- Import library ----
  const libDir = path.join(tmp, 'library');
  const library = new ImportLibrary(libDir);
  await library.init();
  const res = await library.import(path.join(winSp, 'My Great Game.json'));
  assert(res.ok, 'import succeeds: ' + (res.error || ''));
  assert.strictEqual(res.item.objectCount, 3);
  const copied = path.join(library.itemFilePath(res.item.id), res.item.fileName);
  assert(fs.existsSync(copied), 'copy exists in library');

  const badRes = await library.import(path.join(path.dirname(winSp), 'Workshop', 'broken.json'));
  assert(!badRes.ok && /Invalid JSON/.test(badRes.error), 'invalid json rejected');

  // export round-trip
  const outDir = path.join(tmp, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const dest = await library.exportItem(res.item.id, outDir);
  assert(fs.existsSync(dest), 'export writes file');
  const back = JSON.parse(fs.readFileSync(dest, 'utf8'));
  assert.strictEqual(back.SaveName, 'My Great Game');

  // list + remove
  let items = await library.list();
  assert.strictEqual(items.length, 1);
  await library.remove(res.item.id);
  items = await library.list();
  assert.strictEqual(items.length, 0);
  assert(!fs.existsSync(library.itemFilePath(res.item.id)), 'removed from disk');

  console.log('✓ all smoke tests passed');
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('✗ smoke test failed:', e);
  process.exit(1);
});
