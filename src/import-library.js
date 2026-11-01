'use strict';
/**
 * Import library: copies validated TTS save JSON files into the app's own
 * library folder (under userData) and keeps a manifest. The original save is
 * never modified. Pure Node — the caller supplies the base directory.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

class ImportLibrary {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.itemsDir = path.join(baseDir, 'items');
    this.manifestPath = path.join(baseDir, 'manifest.json');
  }

  async init() {
    await fsp.mkdir(this.itemsDir, { recursive: true });
    try {
      await fsp.access(this.manifestPath);
    } catch {
      await fsp.writeFile(this.manifestPath, JSON.stringify({ version: 1, items: [] }, null, 2), 'utf8');
    }
  }

  async readManifest() {
    try {
      const text = await fsp.readFile(this.manifestPath, 'utf8');
      const m = JSON.parse(text);
      if (!Array.isArray(m.items)) m.items = [];
      return m;
    } catch {
      return { version: 1, items: [] };
    }
  }

  async writeManifest(manifest) {
    const tmp = this.manifestPath + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    await fsp.rename(tmp, this.manifestPath);
  }

  /**
   * Validate + copy a save file into the library.
   * Returns { ok:true, item } or { ok:false, error }.
   */
  async import(filePath, { sourceLabel } = {}) {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false, error: 'No file given.' };
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) return { ok: false, error: 'Not a file.' };
    } catch (e) {
      return { ok: false, error: `Cannot read ${filePath}: ${e.message}` };
    }

    let parsed;
    try {
      const text = await fsp.readFile(filePath, 'utf8');
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e.message}` };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Not a Tabletop Simulator save (expected a JSON object).' };
    }

    const looksLikeTts =
      'SaveName' in parsed || 'Table' in parsed || Array.isArray(parsed.States) || 'GameName' in parsed;

    const rawBase = path.basename(filePath, path.extname(filePath));
    const safeBase = (rawBase.replace(/[^\w.\- ]+/g, '_').trim() || 'save').slice(0, 80);
    const id = `${Date.now()}-${safeBase}`;
    const destDir = path.join(this.itemsDir, id);
    const fileName = `${safeBase}.json`;
    const destFile = path.join(destDir, fileName);

    await fsp.mkdir(destDir, { recursive: true });
    await fsp.copyFile(filePath, destFile);

    const item = {
      id,
      name: typeof parsed.SaveName === 'string' && parsed.SaveName ? parsed.SaveName : rawBase,
      fileName,
      sourcePath: filePath,
      sourceLabel: sourceLabel || path.dirname(filePath),
      importedAt: new Date().toISOString(),
      sizeBytes: stat.size,
      looksLikeTts,
      gameName: typeof parsed.GameName === 'string' ? parsed.GameName : null,
      table: typeof parsed.Table === 'string' ? parsed.Table : null,
      date: typeof parsed.Date === 'string' ? parsed.Date : null,
      objectCount: Array.isArray(parsed.States) ? parsed.States.length : 0
    };

    const manifest = await this.readManifest();
    manifest.items.unshift(item);
    await this.writeManifest(manifest);

    return { ok: true, item };
  }

  async list() {
    const manifest = await this.readManifest();
    return manifest.items;
  }

  async get(id) {
    const items = await this.list();
    return items.find((i) => i.id === id) || null;
  }

  async remove(id) {
    const manifest = await this.readManifest();
    const idx = manifest.items.findIndex((i) => i.id === id);
    if (idx === -1) return { ok: false, error: 'Import not found.' };
    manifest.items.splice(idx, 1);
    await this.writeManifest(manifest);
    await fsp.rm(path.join(this.itemsDir, id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }

  async exportItem(id, destDir) {
    const item = await this.get(id);
    if (!item) throw new Error('Import not found.');
    const src = path.join(this.itemsDir, id, item.fileName);
    let dest = path.join(destDir, item.fileName);
    // Avoid silent overwrite: add a counter if the name exists
    let n = 1;
    while (fs.existsSync(dest)) {
      dest = path.join(destDir, item.fileName.replace(/\.json$/i, '') + `-${n++}.json`);
    }
    await fsp.copyFile(src, dest);
    return dest;
  }

  itemFilePath(id) {
    return path.join(this.itemsDir, id);
  }
}

module.exports = { ImportLibrary };
