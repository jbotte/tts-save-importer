# TTS Save Importer

A cross-platform **Electron** app for importing **Tabletop Simulator** save JSON files on **Windows, macOS and Linux** — with automatic discovery of the (very different) save directories each OS uses.

## What it does

- **Auto-detects** TTS `Saves` folders for your OS (see table below), including OneDrive-redirected Documents on Windows and every Steam library / Proton prefix on Linux (Flatpak and Snap included).
- **Lists** every `.json` save (Singleplayer / Multiplayer autosaves / Workshop), newest first.
- **Inspects** a save before importing: game name, table, object/zone/graph counts, script presence, size, modified date — and flags broken JSON.
- **Imports** validated copies into its own library (originals are never touched). **"Add to TTS saves"** puts an imported save straight back into your TTS `Saves/Singleplayer` folder so it shows up in the game's Save & Load panel; Export copies any file anywhere. Drag & drop or **"Open folder"** to browse the library on disk.
- **Drag & drop** `.json` files anywhere onto the window to import.
- **Add folder…** for any custom/odd save location the auto-detector can't find.

## Where TTS keeps saves

| OS | Location |
| --- | --- |
| Windows | `%USERPROFILE%\Documents\My Games\Tabletop Simulator\Saves` (also checks `%OneDrive%\Documents` and the registry "Personal" known-folder for redirected Documents) |
| macOS | `~/Documents/My Games/Tabletop Simulator/Saves` |
| Linux | `<steam library>/steamapps/compatdata/286160/pfx/drive_c/users/steamuser/Documents/My Games/Tabletop Simulator/Saves` — TTS runs under Proton. All libraries from `libraryfolders.vdf` are searched, plus Flatpak (`~/.var/app/com.valvesoftware.Steam/...`) and Snap (`~/snap/steam/common/...`) roots. Older prefixes that use your real username instead of `steamuser` are checked too. |

Within `Saves/`: `Singleplayer/`, `Workshop/`, `Multiplayer-…` subfolders and root-level `Multiplayer-*-AUTOSAVE-*.json` files are all picked up.

## Develop

```bash
npm install
npm test      # logic tests, no GUI needed
npm start     # launch the app
```

## Package installers

Uses [electron-builder](https://www.electron.build). Build on (or for) each target:

```bash
npm run dist:win     # NSIS installer + portable exe   (run on Windows)
npm run dist:mac     # dmg + zip                        (run on macOS, signing optional)
npm run dist:linux   # AppImage + deb                   (run on Linux)
```

Notes:
- macOS builds should be built on a Mac; unsigned builds show a Gatekeeper prompt (right-click → Open, or `xattr -d com.apple.quarantine`).
- Windows cross-builds from Linux need Wine; easiest is to let CI do it (below).

## CI: build all three installers automatically

`.github/workflows/build.yml` is a GitHub Actions **matrix**: one job definition, run in parallel on `ubuntu-latest`, `windows-latest`, and `macos-latest` — each runner builds its own platform's installer (Electron tooling generally can only build for the OS it runs on, which is exactly why the matrix exists).

To use it:

1. Push this folder to a GitHub repo.
2. **Test run:** Actions tab → "Build installers" → Run workflow. Each OS job uploads its installers as downloadable artifacts on the run page.
3. **Release:** tag a version and push it:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   The matrix runs again, then the `release` job merges all artifacts into a GitHub Release with download links.

What each matrix leg does: checkout → setup Node 22 (with npm cache) → cache Electron downloads → `npm ci` → `npm test` → `npx electron-builder --<os> --publish never` → upload artifacts.

- macOS builds are produced for **both arm64 and x64**, so Apple Silicon and Intel Macs are covered.
- Builds are **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY: false`). Windows SmartScreen and macOS Gatekeeper will show first-launch warnings until you add signing certificates (see electron-builder docs: `win.signtoolOptions`, `mac.notarize` + `CSC_LINK`/`CSC_KEY_PASSWORD` secrets).
- Free GitHub plans include limited runner minutes; macOS minutes count heavier than Linux/Windows.

## Project layout

```
main.js                 Electron main process + IPC
preload.js              contextBridge API (no node in the page)
src/tts-locations.js    OS-specific save-directory discovery + folder scanning
src/save-parser.js      JSON validation + metadata summary + raw preview
src/import-library.js   copy-in library with manifest (userData/library)
renderer/               UI (vanilla JS, no framework)
test/smoke.js           node test covering all three platforms
```

The `src/` modules are pure Node (no Electron imports), so they are unit-tested on any host — the tests fake a Windows/Mac/Linux home directory and assert discovery, scanning, parsing and import all behave.

## Imported library location

Copies live under the app's userData folder, e.g.
- Windows: `%APPDATA%/TTS Save Importer/library`
- macOS: `~/Library/Application Support/TTS Save Importer/library`
- Linux: `~/.config/TTS Save Importer/library`

`manifest.json` there is the index; each import is its own folder with the copied save.
