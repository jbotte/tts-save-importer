'use strict';
/**
 * Tabletop Simulator save-location detection for Windows, macOS and Linux.
 * Pure Node (no Electron imports) so it is unit-testable on any host.
 *
 * Known TTS save roots:
 *  - Windows: %USERPROFILE%\Documents\My Games\Tabletop Simulator\Saves
 *             (Documents may be redirected, e.g. to OneDrive — we check the
 *             registry "Personal" folder plus %OneDrive%\Documents)
 *  - macOS:   ~/Documents/My Games/Tabletop Simulator/Saves
 *  - Linux:   TTS runs under Proton, so saves live inside the Steam
 *             compatibility prefix: <steamlib>/steamapps/compatdata/286160/pfx/
 *             drive_c/users/steamuser/Documents/My Games/Tabletop Simulator/Saves
 *             We check every Steam library found in libraryfolders.vdf,
 *             including Flatpak and Snap installs.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TTS_APP_ID = '286160'; // Steam app id for Tabletop Simulator
const SAVES_SEGMENTS = ['My Games', 'Tabletop Simulator', 'Saves'];

function uniquePaths(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p) continue;
    const norm = path.normalize(p);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function expandEnv(value, env, home) {
  if (!value) return value;
  let out = value;
  out = out.replace(/%USERPROFILE%/gi, home || env.USERPROFILE || '');
  if (env.OneDrive) out = out.replace(/%OneDrive%/gi, env.OneDrive);
  if (env.HOME) out = out.replace(/%HOME%/gi, env.HOME);
  return out;
}

function win32Candidates(env, home) {
  const bases = [];
  for (const profile of [home, env.USERPROFILE].filter(Boolean)) {
    bases.push(path.join(profile, 'Documents', ...SAVES_SEGMENTS));
  }
  // OneDrive-redirected Documents (very common on modern Windows)
  if (env.OneDrive) {
    bases.push(path.join(env.OneDrive, 'Documents', ...SAVES_SEGMENTS));
  }
  // Known-folder redirection: HKCU\...\User Shell Folders "Personal"
  try {
    const reg = spawnSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'],
      { encoding: 'utf8', timeout: 4000 }
    );
    if (reg && reg.status === 0 && reg.stdout) {
      const m = reg.stdout.match(/Personal\s+REG_SZ\s+(.+)/i);
      if (m) {
        const doc = expandEnv(m[1].trim(), env, home);
        if (doc) bases.push(path.join(doc, ...SAVES_SEGMENTS));
      }
    }
  } catch {
    /* best effort */
  }
  return bases;
}

function darwinCandidates(home) {
  return [
    // Community threads report this as the default for newer builds
    path.join(home, 'Documents', ...SAVES_SEGMENTS),
    // Older/alternative app-support location, just in case
    path.join(home, 'Library', 'Application Support', 'Tabletop Simulator', 'Saves'),
    // Official KB "Save Game Data Location" for macOS (kb.tabletopsimulator.com)
    path.join(home, 'Library', 'Tabletop Simulator', 'Saves')
  ];
}

function steamLibraryRoots(home, env) {
  const roots = new Set([
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
    env.STEAM_LIBRARY ? path.join(env.STEAM_LIBRARY, 'steam') : null
  ].filter(Boolean));

  // Every library folder Steam knows about (extra drives etc.)
  for (const root of [...roots]) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      for (const m of text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
        let lib = m[1].replace(/\\\\/g, '\\').replace(/\\\//g, '/');
        if (lib) roots.add(lib);
      }
    } catch {
      /* library not present */
    }
  }
  return [...roots];
}

function linuxCandidates(home, env) {
  const out = [];
  let user = 'steamuser';
  try {
    user = os.userInfo().username || 'steamuser';
  } catch {
    user = env.USER || 'steamuser';
  }
  for (const lib of steamLibraryRoots(home, env)) {
    const compat = path.join(lib, 'steamapps', 'compatdata', TTS_APP_ID, 'pfx', 'drive_c', 'users');
    // Proton normally maps the Linux user as "steamuser"; older prefixes use the real username
    out.push(path.join(compat, 'steamuser', 'Documents', ...SAVES_SEGMENTS));
    if (user !== 'steamuser') {
      out.push(path.join(compat, user, 'Documents', ...SAVES_SEGMENTS));
    }
  }
  // Native fallback (non-Proton / custom wine prefix mapping)
  out.push(path.join(home, '.local', 'share', 'Tabletop Simulator', 'Saves'));
  return out;
}

/**
 * All plausible Saves directories for a platform. Pure listing — does not
 * check existence, so UIs can show "not found" candidates too.
 */
function candidateSaveDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  let list = [];
  if (platform === 'win32') list = win32Candidates(env, home);
  else if (platform === 'darwin') list = darwinCandidates(home);
  else list = linuxCandidates(home, env);
  return uniquePaths(list);
}

/** Candidates that actually exist right now. */
function detectSaveLocations(opts = {}) {
  return candidateSaveDirs(opts)
    .filter(isDir)
    .map((p) => ({ path: p, exists: true, kind: 'auto' }));
}

function classifyEntry(folder, fileName) {
  const f = (folder || '').toLowerCase();
  const n = (fileName || '').toLowerCase();
  if (f === 'singleplayer') return 'Singleplayer';
  if (f === 'workshop') return 'Workshop';
  if (f.startsWith('multiplayer')) return 'Multiplayer';
  if (n.startsWith('multiplayer-')) return 'Multiplayer';
  if (f === '(root)') return 'Root';
  return folder;
}

function walk(dir, base, depth, out) {
  if (depth > 3) return;
  let items = [];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      walk(full, base, depth + 1, out);
    } else if (it.isFile() && it.name.toLowerCase().endsWith('.json')) {
      let stat = null;
      try {
        stat = fs.statSync(full);
      } catch {
        /* race with deletion */
      }
      const rel = path.relative(base, full);
      const folder = rel.includes(path.sep) ? rel.split(path.sep)[0] : '(root)';
      out.push({
        path: full,
        name: it.name,
        folder,
        kind: classifyEntry(folder, it.name),
        sizeBytes: stat ? stat.size : null,
        mtimeMs: stat ? stat.mtimeMs : null
      });
    }
  }
}

/** Scan a Saves folder (recursively, shallow) for .json save files. */
function scanSaveDirectory(dir) {
  const entries = [];
  try {
    if (!fs.statSync(dir).isDirectory()) return { dir, error: 'Not a directory', entries };
  } catch (e) {
    return { dir, error: e.message, entries };
  }
  walk(dir, dir, 0, entries);
  entries.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  return { dir, error: null, count: entries.length, entries };
}

module.exports = {
  TTS_APP_ID,
  candidateSaveDirs,
  detectSaveLocations,
  scanSaveDirectory,
  isDir
};
