'use strict';
/**
 * Import = validate a TTS save JSON and copy it into the game's saves folder.
 * Destination is auto-detected per OS (Saves/Singleplayer), with an optional
 * fallbackDir (a folder the user added manually). Pure Node — testable anywhere.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { detectSaveLocations, isDir } = require('./tts-locations');

/** Where imported saves land: detected TTS Saves/Singleplayer, else the fallback. */
function pickImportDir(fallbackDir, detectOpts) {
  const locs = detectSaveLocations(detectOpts || {});
  let base = locs.length ? locs[0].path : null;
  if (!base && fallbackDir && isDir(fallbackDir)) base = fallbackDir;
  if (!base) return null;
  const singleplayer = path.join(base, 'Singleplayer');
  try {
    fs.mkdirSync(singleplayer, { recursive: true });
  } catch {
    /* fall back to the Saves root */
  }
  return isDir(singleplayer) ? singleplayer : base;
}

async function importOne(filePath, fallbackDir, detectOpts) {
  const name = path.basename(String(filePath || ''));
  if (typeof filePath !== 'string' || !filePath) {
    return { ok: false, name: String(filePath), error: 'No file given.' };
  }

  // Validate before touching the game folder.
  let parsed;
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, name, error: `Invalid JSON: ${e.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, name, error: 'Not a Tabletop Simulator save (expected a JSON object).' };
  }

  const destDir = pickImportDir(fallbackDir, detectOpts);
  if (!destDir) {
    return {
      ok: false,
      name,
      noDetectedDir: true,
      error: 'No Tabletop Simulator Saves folder detected — use "Add folder…" once so we know where to put it.'
    };
  }

  // Already inside the destination? Nothing to do.
  const rel = path.relative(destDir, path.resolve(filePath));
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { ok: false, alreadyThere: true, name, error: 'Already inside your TTS saves folder.' };
  }

  let dest = path.join(destDir, name.replace(/\.json$/i, '') + '.json');
  let n = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, name.replace(/\.json$/i, '') + `-${n++}.json`);
  }

  try {
    await fsp.copyFile(filePath, dest);
  } catch (e) {
    return { ok: false, name, error: `Copy failed: ${e.message}` };
  }
  return {
    ok: true,
    name,
    dest,
    gameName: typeof parsed.GameName === 'string' ? parsed.GameName : null
  };
}

module.exports = { pickImportDir, importOne };
