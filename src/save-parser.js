'use strict';
/**
 * Read + summarize a Tabletop Simulator save JSON without loading the whole
 * object graph into the renderer. TTS saves are plain JSON files with keys
 * like SaveName, GameName, Table, States (objects), Zones, Graphs, Notes...
 */
const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');

const MAX_RAW_PREVIEW = 2 * 1024 * 1024; // 2 MB of raw text for the viewer

async function summarizeSaveFile(filePath) {
  const summary = {
    path: filePath,
    name: path.basename(filePath),
    sizeBytes: null,
    mtimeMs: null,
    valid: false,
    error: null,
    looksLikeTts: false,
    saveName: null,
    gameName: null,
    date: null,
    table: null,
    tableId: null,
    gravity: null,
    turn: null,
    objectCount: 0,
    zoneCount: 0,
    graphCount: 0,
    layoutCount: 0,
    xmluiCount: 0,
    hasScriptState: false,
    hasNotes: false,
    topKeys: []
  };

  let stat;
  try {
    stat = await fss.promises.stat(filePath);
    summary.sizeBytes = stat.size;
    summary.mtimeMs = stat.mtimeMs;
  } catch (e) {
    summary.error = `Cannot read file: ${e.message}`;
    return summary;
  }

  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (e) {
    summary.error = `Cannot read file: ${e.message}`;
    return summary;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    summary.error = `Invalid JSON: ${e.message}`;
    return summary;
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    summary.error = 'Not a Tabletop Simulator save (expected a JSON object).';
    return summary;
  }

  summary.valid = true;
  summary.looksLikeTts =
    'SaveName' in json || 'Table' in json || Array.isArray(json.States) || 'GameName' in json;

  summary.saveName = typeof json.SaveName === 'string' ? json.SaveName : null;
  summary.gameName = typeof json.GameName === 'string' ? json.GameName : null;
  summary.date = typeof json.Date === 'string' ? json.Date : null;
  summary.table = typeof json.Table === 'string' ? json.Table : null;
  summary.tableId = json.TableID != null ? String(json.TableID) : null;
  summary.gravity = json.Gravity != null ? json.Gravity : null;
  summary.turn = json.Turn != null ? json.Turn : null;
  summary.objectCount = Array.isArray(json.States) ? json.States.length : 0;
  summary.zoneCount = Array.isArray(json.Zones) ? json.Zones.length : 0;
  summary.graphCount = Array.isArray(json.Graphs) ? json.Graphs.length : 0;
  summary.layoutCount = Array.isArray(json.Layout) ? json.Layout.length : 0;
  summary.xmluiCount = Array.isArray(json.XMLUI) ? json.XMLUI.length : 0;
  summary.hasScriptState = Boolean(json.ScriptState);
  summary.hasNotes = Boolean(json.Notes);
  summary.topKeys = Object.keys(json).sort();

  return summary;
}

async function readRawPreview(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  if (text.length > MAX_RAW_PREVIEW) {
    return {
      text: text.slice(0, MAX_RAW_PREVIEW),
      truncated: true,
      totalChars: text.length
    };
  }
  return { text, truncated: false, totalChars: text.length };
}

module.exports = { summarizeSaveFile, readRawPreview, MAX_RAW_PREVIEW };
