'use strict';
/* global window, document */

const $ = (id) => document.getElementById(id);

const state = {
  candidates: [],          // { path, exists }
  customDirs: [],          // dirs the user added manually
  active: null,            // { type: 'auto'|'custom'|'imports', path, label }
  entries: [],             // scanned saves for the active folder
  selectedSavePath: null,
  imports: []              // manifest items
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
  setTimeout(() => el.remove(), 5000);
}

function shortPath(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/);
  return parts.length > 3 ? '…' + '/' + parts.slice(-3).join('/') : p;
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

  $('import-count').textContent = state.imports.length;
  const imp = $('import-list');
  imp.innerHTML = '';
  for (const item of state.imports) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(item.name)} <span class="badge">${item.objectCount} obj</span>`;
    li.addEventListener('click', () => showImportDetail(item));
    imp.appendChild(li);
  }

  $('side-footer').innerHTML =
    'Expected TTS Saves folders:<br>' +
    state.candidates.map((c) => `<code class="hint">${esc(c.path)}</code>`).join('<br>');
}

// ---------- folder / save list ----------
async function selectFolder(dir, type) {
  state.active = { type, path: dir, label: dir };
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

// ---------- detail panes ----------
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
      detailButtonsForSave(filePath);
    bindDetailButtons(filePath, null);
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
    detailButtonsForSave(filePath);
  bindDetailButtons(filePath, null);
}

function detailButtonsForSave(filePath) {
  return `<div class="detail-actions">
    <button class="primary" data-act="import">Import to library</button>
    <button data-act="raw">View raw JSON</button>
    <button data-act="show">Show in folder</button>
  </div>`;
}

async function showImportDetail(item) {
  state.selectedSavePath = null;
  renderSaveList();
  const pane = $('detail-pane');
  const rows = [
    ['Save name', item.name],
    ['Game name', item.gameName],
    ['In-game date', item.date],
    ['Table', item.table],
    ['Objects', item.objectCount],
    ['Imported at', item.importedAt ? new Date(item.importedAt).toLocaleString() : '—'],
    ['File size', fmtBytes(item.sizeBytes)],
    ['Source', item.sourceLabel],
    ['Looks like a TTS save', item.looksLikeTts ? 'yes' : 'unexpected — check contents']
  ];
  pane.innerHTML =
    `<h2>${esc(item.name)} <span class="badge">imported</span></h2>` +
    `<div class="sub">${esc(item.fileName)} · id ${esc(item.id)}</div>` +
    `<div class="kv">${rows
      .map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`)
      .join('')}</div>` +
    `<div class="detail-actions">
      <button class="primary" data-act="restore" data-id="${esc(item.id)}">Add to TTS saves</button>
      <button data-act="raw-import" data-id="${esc(item.id)}">View raw JSON</button>
      <button data-act="export" data-id="${esc(item.id)}">Export copy…</button>
      <button class="danger" data-act="remove" data-id="${esc(item.id)}">Remove</button>
    </div>`;

  pane.querySelectorAll('button[data-act]').forEach((btn) => {
    const id = btn.getAttribute('data-id');
    btn.addEventListener('click', async () => {
      const act = btn.getAttribute('data-act');
      if (act === 'restore') {
        const r = await window.tts.restoreImport(id);
        if (r && r.ok) toast(`Restored to ${r.dest} — open TTS → Save & Load → Singleplayer`, 'ok');
        else if (r && r.error) toast(r.error, 'bad');
      } else if (act === 'raw-import') {
        const raw = await window.tts.importRaw(id);
        openRaw(item.name, raw);
      } else if (act === 'export') {
        const r = await window.tts.exportImport(id);
        if (r && r.ok) toast(`Exported to ${r.dest}`, 'ok');
        else if (r && r.error) toast(r.error, 'bad');
      } else if (act === 'remove') {
        await window.tts.removeImport(id);
        await refreshImports();
        $('detail-pane').innerHTML = '<p class="muted">Select a save to see its details.</p>';
        toast('Removed from library.', 'ok');
      }
    });
  });
}

function bindDetailButtons(filePath) {
  const pane = $('detail-pane');
  pane.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.getAttribute('data-act');
      if (act === 'import') {
        const r = await window.tts.importFile(filePath);
        if (r.ok) {
          toast(`Imported “${r.item.name}”`, 'ok');
          await refreshImports();
        } else {
          toast(r.error || 'Import failed.', 'bad');
        }
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

// ---------- imports ----------
async function refreshImports() {
  state.imports = await window.tts.listImports();
  renderSidebar();
}

async function importPaths(paths) {
  let ok = 0;
  let fail = 0;
  for (const p of paths) {
    const r = await window.tts.importFile(p);
    if (r.ok) ok++;
    else {
      fail++;
      toast(`${p.split(/[\\/]/).pop()}: ${r.error}`, 'bad');
    }
  }
  if (ok) toast(`Imported ${ok} save file(s).`, 'ok');
  await refreshImports();
  return { ok, fail };
}

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

$('btn-import-file').addEventListener('click', async () => {
  const results = await window.tts.pickAndImportFiles();
  if (!results || !results.length) return;
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  if (ok) toast(`Imported ${ok} save file(s).`, 'ok');
  for (const r of results) if (!r.ok) toast(r.error, 'bad');
  await refreshImports();
});

$('btn-open-lib').addEventListener('click', () => window.tts.openLibraryFolder());

if (window.tts.onMenuAddFolder) {
  window.tts.onMenuAddFolder(() => $('btn-add-folder').click());
}

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
  await refreshLocations();
  await refreshImports();
  if (!state.candidates.some((c) => c.exists)) {
    $('detail-pane').innerHTML =
      '<div class="empty"><h2>No save folders found</h2>' +
      '<p>We could not find a Tabletop Simulator <code>Saves</code> folder automatically.<br>' +
      'Open Tabletop Simulator once (Steam → play) so the folder exists, or click ' +
      '<b>Add folder…</b> and pick your Saves folder manually.</p></div>';
  }
}

init();
