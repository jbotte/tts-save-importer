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
const { pickImportDir, importOne } = require('../src/import-to-game');
const { ImportLibrary } = require('../src/import-library');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-test-'));

function writeSaves(savesDir) {
  const sp = path.join(savesDir, 'Singleplayer');
  const ws = path.join(savesDir, 'Workshop');
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
    path.join(savesDir, 'Multiplayer-Casual-AUTOSAVE-1.json'),
    JSON.stringify({ ...save, SaveName: 'Casual' })
  );
  fs.writeFileSync(path.join(ws, 'broken.json'), '{ not json !!!');
  return { sp, save };
}

function makeFakeSaves(root) {
  return writeSaves(path.join(root, 'My Games', 'Tabletop Simulator', 'Saves'));
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
  assert(macDirs.length >= 3);
  assert(
    macDirs[0] === path.join(macHome, 'Library', 'Tabletop Simulator', 'Saves'),
    'documented macOS KB path must be candidate #1'
  );
  assert(
    macDirs[1] === path.join(macHome, 'Documents', 'My Games', 'Tabletop Simulator', 'Saves'),
    'community macOS path remains candidate #2'
  );

  // If a Mac only has saves under ~/Library/Tabletop Simulator/Saves, scan + detect must work there
  const libOnlyHome = path.join(tmp, 'machome-libonly');
  const libOnlySaves = path.join(libOnlyHome, 'Library', 'Tabletop Simulator', 'Saves');
  writeSaves(libOnlySaves);
  const libOnlyScan = scanSaveDirectory(libOnlySaves);
  assert.strictEqual(libOnlyScan.count, 3, 'saves under ~/Library/Tabletop Simulator are scannable');

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

  // ---- Direct import into the game's saves (v0.2 model) ----
  // Auto-detected destination (fake linux proton prefix from above)
  const saveSrc = path.join(tmp, 'downloads', 'from-email.json');
  fs.mkdirSync(path.dirname(saveSrc), { recursive: true });
  fs.writeFileSync(saveSrc, JSON.stringify({ SaveName: 'From Email', GameName: 'Poker', States: [{}] }));

  const imp1 = await importOne(saveSrc, null, { platform: 'linux', env: {}, home: linHome });
  assert(imp1.ok, 'import to detected dir: ' + (imp1.error || ''));
  assert(imp1.dest.includes(path.join('compatdata', '286160')), 'landed in proton saves');
  assert(imp1.dest.endsWith(path.join('Singleplayer', 'from-email.json')), 'landed in Singleplayer');
  assert.strictEqual(imp1.gameName, 'Poker');
  assert(fs.existsSync(imp1.dest));

  // Collision: second import of same name gets -1 suffix
  const imp2 = await importOne(saveSrc, null, { platform: 'linux', env: {}, home: linHome });
  assert(imp2.ok && imp2.dest.endsWith('from-email-1.json'), 'collision suffix: ' + imp2.dest);

  // Same file re-imported (now inside dest) is a no-op, not a duplicate
  const imp3 = await importOne(imp1.dest, null, { platform: 'linux', env: {}, home: linHome });
  assert(!imp3.ok && imp3.alreadyThere, 'already-in-folder detected');

  // Junk never reaches the game folder
  const junkSrc = path.join(tmp, 'downloads', 'junk.json');
  fs.writeFileSync(junkSrc, 'not json at all');
  const junkDirBefore = fs.readdirSync(path.join(protonSaves, 'My Games', 'Tabletop Simulator', 'Saves', 'Singleplayer')).length;
  const impJunk = await importOne(junkSrc, null, { platform: 'linux', env: {}, home: linHome });
  assert(!impJunk.ok && /Invalid JSON/.test(impJunk.error), 'junk rejected');
  const junkDirAfter = fs.readdirSync(path.join(protonSaves, 'My Games', 'Tabletop Simulator', 'Saves', 'Singleplayer')).length;
  assert.strictEqual(junkDirBefore, junkDirAfter, 'junk never copied into game folder');

  // Fallback dir when nothing is detected (fresh empty home, no steam anywhere)
  const lonelyHome = path.join(tmp, 'lonely');
  fs.mkdirSync(lonelyHome, { recursive: true });
  const noDir = await importOne(saveSrc, null, { platform: 'linux', env: {}, home: lonelyHome });
  assert(!noDir.ok && noDir.noDetectedDir, 'reports missing detection');
  const manualDir = path.join(tmp, 'manual-saves');
  fs.mkdirSync(manualDir, { recursive: true });
  const fb = await importOne(saveSrc, manualDir, { platform: 'linux', env: {}, home: lonelyHome });
  assert(fb.ok && fb.dest.startsWith(path.join(tmp, 'manual-saves')), 'fallback dir used: ' + (fb.error || fb.dest));

  // ---- Adaptive destination: Singleplayer vs old-style Saves-root ----
  // Old layout: single-player saves directly in Saves/ (TS_Save_*.json + index)
  const oldHome = path.join(tmp, 'oldmac');
  const oldRoot = path.join(oldHome, 'Library', 'Tabletop Simulator', 'Saves');
  fs.mkdirSync(oldRoot, { recursive: true });
  fs.writeFileSync(path.join(oldRoot, 'TS_Save_1.json'), JSON.stringify({ SaveName: 'Old', States: [{}] }));
  fs.writeFileSync(path.join(oldRoot, 'SaveFileInfos.json'), '{}');
  const impOld = await importOne(saveSrc, null, { platform: 'darwin', env: {}, home: oldHome });
  assert(impOld.ok && impOld.dest === path.join(oldRoot, 'from-email.json'), 'old-layout: import goes to Saves root: ' + (impOld.dest || impOld.error));

  // Modern layout with real saves in Singleplayer wins even if root has stray json
  const modernHome = path.join(tmp, 'modernmac');
  const modernRoot = path.join(modernHome, 'Library', 'Tabletop Simulator', 'Saves');
  writeSaves(modernRoot); // Singleplayer/ has saves; root has a Multiplayer autosave file
  const impModern = await importOne(saveSrc, null, { platform: 'darwin', env: {}, home: modernHome });
  assert(impModern.ok && impModern.dest.includes('Singleplayer'), 'modern layout: Singleplayer preferred: ' + (impModern.dest || impModern.error));

  // Fresh install: empty detected Saves -> Singleplayer created and used
  const freshHome = path.join(tmp, 'freshmac');
  const freshRoot = path.join(freshHome, 'Library', 'Tabletop Simulator', 'Saves');
  fs.mkdirSync(freshRoot, { recursive: true });
  const impFresh = await importOne(saveSrc, null, { platform: 'darwin', env: {}, home: freshHome });
  assert(impFresh.ok && impFresh.dest === path.join(freshRoot, 'Singleplayer', 'from-email.json'), 'fresh install: Singleplayer created: ' + (impFresh.dest || impFresh.error));

  console.log('✓ all smoke tests passed');
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('✗ smoke test failed:', e);
  process.exit(1);
});
