'use strict';
/* global window, document */

const $ = (id) => document.getElementById(id);

const state = {
  candidates: [], // { path, exists }
  customDirs: [], // dirs the user added manually (fallback)
  active: null, // { type: 'auto'|'custom', path }
  entries: [],
  selectedSavePath: null
};

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDate(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString(); } catch { return '—'; }
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 6500);
}

function shortPath(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
}

function baseName(p) {
  return String(p || '').split(/[\\/]/).pop();
}

// ---------- import ----------
async function importPaths(paths) {
  if (!paths.length) return;
  const fallback = state.customDirs[0] || null;
  const results = await window.tts.importToTTS(paths, fallback);
  if (!Array.isArray(results)) return;
  for (const r of results) {
    if (r.ok) {
      toast(`Imported ${r.name} → ${shortPath(r.dest)}. Open TTS → Save & Load → Singleplayer.`, 'ok');
    } else if (r.alreadyThere) {
      toast(`${r.name}: ${r.error}`);
    } else {
      toast(`${r.name}: ${r.error}`, 'bad');
    }
  }
  // If a save was dropped into the folder we're currently viewing, refresh it.
  if (state.active) await selectFolder(state.active.path, state.active.type);
}

async function pickAndImport() {
  const paths = await window.tts.pickSaveFiles();
  if (!paths || !paths.length) return;
  await importPaths(paths);
}

// ---------- sidebar ----------
function renderSidebar() {
  const auto = $('auto-list');
  auto.innerHTML = '';
  const existing = state.candidates.filter((c) => c.exists);
  const missing = state.candidates.filter((c) => !c.exists);

  for (const loc of existing) {
    const li = document.createElement('li');
    li.className = state.active && state.active.path === loc.path ? 'active' : '';
    li.innerHTML = `<span class="badge ok">found</span>${esc(shortPath(loc.path))}`;
    li.title = loc.path;
    li.addEventListener('click', () => selectFolder(loc.path, 'auto'));
    auto.appendChild(li);
  }
  if (!existing.length) {
    const li = document.createElement('li');
    li.className = 'missing';
    li.innerHTML = '<span class="badge warn">none found</span> No TTS Saves folder detected.';
    auto.appendChild(li);
    for (const loc of missing.slice(0, 4)) {
      const li2 = document.createElement('li');
      li2.className = 'missing';
      li2.innerHTML = `<span class="path">${esc(loc.path)}</span>`;
      li2.title = loc.path + ' (does not exist)';
      auto.appendChild(li2);
    }
  }

  const custom = $('custom-list');
  custom.innerHTML = '';
  for (const dir of state.customDirs) {
    const li = document.createElement('li');
    li.className = state.active && state.active.path === dir ? 'active' : '';
    li.innerHTML = esc(shortPath(dir));
    li.title = dir;
    li.addEventListener('click', () => selectFolder(dir, 'custom'));
    custom.appendChild(li);
  }

  $('side-footer').innerHTML =
    'Imports are copied straight into:<br>' +
    '<code class="hint">' +
    esc(existing.length ? existing[0].path : 'detected Saves/Singleplayer') +
    '</code>';
}

// ---------- folder / save list ----------
async function selectFolder(dir, type) {
  state.active = { type, path: dir };
  renderSidebar();
  const res = await window.tts.scanDirectory(dir);
  if (res.error) {
    state.entries = [];
    $('list-header').innerHTML = `<span class="error">${esc(dir)} — ${esc(res.error)}</span>`;
    $('save-list').innerHTML = '';
    return;
  }
  state.entries = res.entries;
  renderSaveList();
}

function renderSaveList() {
  const header = $('list-header');
  header.textContent = state.active
    ? `${state.entries.length} save file(s) — ${shortPath(state.active.path)}`
    : 'Choose a folder on the left.';

  const ul = $('save-list');
  ul.innerHTML = '';
  if (!state.entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No .json saves in this folder.';
    ul.appendChild(li);
    return;
  }
  for (const e of state.entries) {
    const li = document.createElement('li');
    li.className = state.selectedSavePath === e.path ? 'active' : '';
    li.innerHTML =
      `<span class="name">${esc(e.name)}</span>` +
      `<span class="meta"><span>${esc(e.kind)}</span><span>${fmtBytes(e.sizeBytes)}</span>` +
      `<span>${fmtDate(e.mtimeMs)}</span></span>`;
    li.addEventListener('click', () => showSaveDetail(e.path));
    ul.appendChild(li);
  }
}

// ---------- detail pane ----------
async function showSaveDetail(filePath) {
  state.selectedSavePath = filePath;
  renderSaveList();
  const pane = $('detail-pane');
  pane.innerHTML = '<p class="muted">Reading save…</p>';

  const s = await window.tts.saveSummary(filePath);
  if (s.error) {
    pane.innerHTML =
      `<h2>${esc(s.name || filePath)}</h2>` +
      `<div class="sub">${esc(s.path)}</div>` +
      `<p class="error">${esc(s.error)}</p>` +
      detailButtons();
    bindDetailButtons(filePath);
    return;
  }

  const rows = [
    ['Save name', s.saveName],
    ['Game name', s.gameName],
    ['In-game date', s.date],
    ['Table', s.table],
    ['Table ID', s.tableId],
    ['Objects', s.objectCount],
    ['Zones', s.zoneCount],
    ['Graphs (Lua)', s.graphCount],
    ['Layouts', s.layoutCount],
    ['Custom UI', s.xmluiCount],
    ['Global script', s.hasScriptState ? 'yes' : 'no'],
    ['Table notes', s.hasNotes ? 'yes' : 'no'],
    ['Gravity', s.gravity],
    ['Turn', s.turn],
    ['File size', fmtBytes(s.sizeBytes)],
    ['Modified', fmtDate(s.mtimeMs)],
    ['Looks like a TTS save', s.looksLikeTts ? 'yes' : 'unexpected — check contents']
  ];

  pane.innerHTML =
    `<h2>${esc(s.saveName || s.name)}</h2>` +
    `<div class="sub">${esc(s.path)}</div>` +
    `<div class="kv">${rows
      .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`)
      .join('')}</div>` +
    detailButtons();
  bindDetailButtons(filePath);
}

function detailButtons() {
  // Saves browsed from a detected TTS folder are already in the game.
  const inTts = state.active && state.active.type === 'auto';
  return `<div class="detail-actions">
    ${inTts
      ? '<span class="badge ok" style="padding:6px 10px">Already in your TTS saves</span>'
      : '<button class="primary" data-act="import">Import to TTS</button>'}
    <button data-act="raw">View raw JSON</button>
    <button data-act="show">Show in folder</button>
  </div>`;
}

function bindDetailButtons(filePath) {
  const pane = $('detail-pane');
  pane.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.getAttribute('data-act');
      if (act === 'import') {
        await importPaths([filePath]);
      } else if (act === 'raw') {
        const raw = await window.tts.saveRaw(filePath);
        openRaw(filePath, raw);
      } else if (act === 'show') {
        window.tts.showInFolder(filePath);
      }
    });
  });
}

// ---------- raw viewer ----------
function openRaw(title, raw) {
  if (!raw || raw.error) {
    toast((raw && raw.error) || 'Cannot read file.', 'bad');
    return;
  }
  $('raw-title').textContent = title + (raw.truncated ? ` (first 2 MB of ${raw.totalChars.toLocaleString()} chars)` : '');
  $('raw-body').textContent = raw.text;
  $('raw-modal').classList.remove('hidden');
}

$('raw-close').addEventListener('click', () => $('raw-modal').classList.add('hidden'));
$('raw-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('raw-body').textContent).then(
    () => toast('JSON copied to clipboard.', 'ok'),
    () => toast('Copy failed.', 'bad')
  );
});
$('raw-modal').addEventListener('click', (e) => {
  if (e.target === $('raw-modal')) $('raw-modal').classList.add('hidden');
});

// ---------- top actions ----------
$('btn-refresh').addEventListener('click', async () => {
  await refreshLocations({ keepActive: true });
  if (state.active) await selectFolder(state.active.path, state.active.type);
  toast('Folders re-scanned.', 'ok');
});

$('btn-add-folder').addEventListener('click', async () => {
  const res = await window.tts.pickFolder();
  if (!res) return;
  if (!state.customDirs.includes(res.dir)) state.customDirs.push(res.dir);
  await selectFolder(res.dir, 'custom');
});

$('btn-import-file').addEventListener('click', () => pickAndImport());

if (window.tts.onMenuAddFolder) window.tts.onMenuAddFolder(() => $('btn-add-folder').click());
if (window.tts.onMenuImportFile) window.tts.onMenuImportFile(() => pickAndImport());

// ---------- drag & drop ----------
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) document.body.classList.remove('dragging');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files || []);
  const paths = files
    .filter((f) => f.name.toLowerCase().endsWith('.json'))
    .map((f) => window.tts.pathForFile(f))
    .filter(Boolean);
  if (!paths.length) {
    toast('Drop .json save files to import them.', 'bad');
    return;
  }
  await importPaths(paths);
});

// ---------- init ----------
async function refreshLocations({ keepActive = false } = {}) {
  state.candidates = await window.tts.candidateLocations();
  const existing = state.candidates.filter((c) => c.exists);
  renderSidebar();
  if (!keepActive && !state.active && existing.length) {
    await selectFolder(existing[0].path, 'auto');
  }
}

async function init() {
  // One-time migration from the old staging library (v0.1.x), if any.
  try {
    const boot = await window.tts.bootstrap();
    if (boot && boot.migrated && boot.migrated.length) {
      toast(
        `Moved ${boot.migrated.length} earlier import(s) into TTS: ${boot.migrated.map(baseName).join(', ')} — open TTS → Save & Load → Singleplayer.`,
        'ok'
      );
    } else if (boot && boot.pending) {
      toast('You have imports from an older version waiting — they will move into TTS once a saves folder is detected.', 'bad');
    }
  } catch {
    /* migration is best-effort */
  }

  await refreshLocations();
  if (!state.candidates.some((c) => c.exists)) {
    $('detail-pane').innerHTML =
      '<div class="empty"><h2>No save folders found</h2>' +
      '<p>We could not find a Tabletop Simulator <code>Saves</code> folder automatically.<br>' +
      'Open Tabletop Simulator once (Steam → play) so the folder exists, or click ' +
      '<b>Add folder…</b> and pick your Saves folder manually — imports will then go there.</p></div>';
  }
}

init();
