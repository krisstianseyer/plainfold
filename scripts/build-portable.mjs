import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
).version;
const targetDir = resolve(root, "src-tauri/target/portable");
const tauriCli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
const releaseExe = resolve(targetDir, "release/plainfold.exe");
const outputDir = resolve(root, "src-tauri/target/release/bundle/portable");
const portableDir = resolve(
  outputDir,
  `Plainfold_${version}_portable_x64`
);

const isWindows = process.platform === "win32";
if (!isWindows) {
  throw new Error("The portable edition is built on Windows only.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}.`);
  }
}

console.log(`Building Plainfold ${version} portable edition...`);
run(
  process.execPath,
  [
    tauriCli,
    "build",
    "--no-bundle",
    "--config",
    "src-tauri/tauri.portable.conf.json",
  ],
  {
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    shell: false,
  }
);

if (!existsSync(releaseExe)) {
  throw new Error(
    `Portable build did not produce ${releaseExe}. Check CARGO_TARGET_DIR support.`
  );
}

rmSync(portableDir, { recursive: true, force: true });
mkdirSync(portableDir, { recursive: true });
copyFileSync(releaseExe, resolve(portableDir, "Plainfold.exe"));
const readme = `Plainfold ${version} - Portable Edition (Windows x64)
========================================================

Contents
--------
Plainfold.exe   The application.
README.txt      This file.
Plainfold-data  Created on first launch. Holds settings, the search index,
                logs, and WebView2 profile data.

No installation is needed. Start Plainfold.exe to run the app.

What is Plainfold?
------------------
Plainfold is a desktop editor for plain-text notes kept in an ordinary folder.
A repository is simply a folder you choose, and every note is a real file on
disk. Plainfold never renders Markdown or HTML, never executes scripts, and
does not put your notes in a database. The search index is a rebuildable cache.

This portable edition keeps all application state in Plainfold-data next to
Plainfold.exe. It is assembled fresh and contains no settings, logs, search
index, or other user data from another copy. It has its own application
identifier, so it can run beside an installed copy without sharing data or
settings.

Requirements
------------
- Windows 11, 64-bit, or Windows 10, 64-bit, with the WebView2 runtime.
- Microsoft Edge WebView2 Runtime. Windows 11 includes it. On Windows 10,
  install the WebView2 Evergreen Runtime from Microsoft:
  https://developer.microsoft.com/microsoft-edge/webview2/
- A writable folder on a local disk or USB stick. Do not run it from a
  read-only location or a network share; the app and WebView2 need write access.
- No administrator rights, Node.js, Rust, or .NET installation is required.
- About 5 MB for the application, plus space for Plainfold-data. The search
  index and WebView2 cache grow with use.
- Repositories can be anywhere the current user can read and write.

Quick start
-----------
1. Open the folder containing Plainfold.exe.
2. Start Plainfold.exe.
3. Choose "Open repository" and select any folder of text files, or create an
   empty folder first.
4. Use the sidebar tree to open or create files. Save with Ctrl+S, or enable
   Auto Save in Settings.
5. Optional: pin files, add tags, search with Ctrl+Shift+F, and configure the
   theme and window chrome in Settings.

The first launch starts blank: default settings, no recent repositories, and
an empty search index.

Features
--------
- Repository tree: folders first; sort by name, modified time, or size;
  one-click alphabetical sort; pins; recents; tags; drag to reorder; drag to
  move between folders.
- Create nested files and folders, rename, and move items to the OS trash.
- CodeMirror 6 editing with extension-based syntax highlighting only.
- Text encodings: UTF-8 with optional BOM, and BOM-marked UTF-16 LE/BE.
  Encoding, BOM, and CRLF/LF line endings are preserved on save.
- Atomic saves: a temporary file is written in the same folder, flushed, then
  renamed over the original.
- Full-text search (SQLite FTS5) over file names and contents, with line
  numbers and click-to-line results.
- A file watcher that reloads clean files and preserves unsaved edits with a
  notice.
- Unsaved-change prompts with Save, Discard, and Cancel when switching files,
  changing repositories, deleting, or closing.
- Auto Save with a configurable idle delay (default 20 seconds, up to 60
  minutes), running only while the open file has unsaved edits.
- Compressed revisions in the repository's hidden .revisions folder. Restore
  from the file context menu. Retention uses Grandfather-Father-Son rotation
  with configurable hourly, daily, weekly, monthly, and yearly tiers.
- Non-text files (images, audio, video, PDF, Office, Photoshop, archives,
  executables) open in the OS default app. Text and script formats stay in
  Plainfold.
- Sidebar search with keyboard navigation; tree filter with * and ? wildcards
  for names, paths, or extensions; resizable sidebar pane.
- Plain-text links in the form [[repository-relative/path]]; Ctrl+click opens
  the linked file.
- Themes and accent colors, per-section settings reset, feature toggles, and a
  configurable title-bar and menu layout.
- No telemetry, no account, no cloud sync, and no CDN.

Keyboard shortcuts
------------------
Ctrl+S           Save the current file.
Ctrl+Shift+F     Focus sidebar search.
Ctrl+F           Find in the editor when the editor has focus.
Ctrl+H           Replace in the editor.
Ctrl+O           Open a repository.
Ctrl+,           Open Settings.
Ctrl+W           Close the current file; the window stays open.
Ctrl+Z / Ctrl+Y  Undo / redo.
Alt+A            Open the Application menu.
Alt+E            Open the Edit menu.
Enter            Run the current sidebar search.
Arrow Down       From the search field, focus the first result.
Esc              Close search results, a menu, or a popup.
Ctrl+click       Open a [[...]] plain-text link.

Data locations (portable)
-------------------------
Everything below lives in Plainfold-data next to Plainfold.exe:
- settings.json: theme, toggles, recent repositories, limits, and features.
- indexes/: one SQLite search index per repository, keyed by a hash of the
  repository path. It is a cache and can be rebuilt.
- logs/plainfold.log: diagnostics. Contains paths, error codes, and timings,
  never file contents.
- EBWebView/: Microsoft Edge WebView2 profile data such as cache and local
  storage.

Revisions are stored in the repository itself, under
.revisions/<file path>/<UTC timestamp>.gz. To reset the portable edition while
the app is closed, delete Plainfold-data. Repository files and .revisions are
not affected.

Moving the edition
------------------
Close Plainfold first, then move or rename the whole folder, including
Plainfold-data. The app resolves its state relative to Plainfold.exe, so it
runs from a USB stick or any writable folder. Repositories are not moved
automatically; they remain where you opened them. Recent entries store
absolute paths, so open a moved repository again from its new location.

Network and privacy
-------------------
- No telemetry, analytics, accounts, cloud sync, or CDN requests.
- The only possible network request is the optional GitHub Releases update
  check. It asks https://api.github.com for the latest release of
  https://github.com/krisstianseyer/plainfold; it sends no account, identifier,
  or file data. It only notifies; it never downloads or installs updates. It
  can be disabled in Settings > Updates.
- File contents stay on disk and are never uploaded.

Uninstalling
------------
Close Plainfold, then delete the folder containing Plainfold.exe. The portable
edition creates no registry entries, services, or Start menu shortcuts. Your
repositories, including .revisions, remain on disk.

Troubleshooting
---------------
- A missing WebView2 runtime or a blank window: install the WebView2 Evergreen
  Runtime, then start Plainfold.exe again.
- The app does not start from a read-only folder or a network share: copy the
  folder to a local disk or a writable USB stick.
- Settings or search behave oddly after moving the folder: close the app,
  confirm Plainfold-data sits beside Plainfold.exe, then rebuild the search
  index from Settings > Maintenance.
- Logs: Plainfold-data/logs/plainfold.log.
- A second launch focuses the existing portable window. An installed Plainfold
  is a separate application with separate data and does not share its window.

Project, version, and support
-----------------------------
- Application: Plainfold ${version} (Windows x64 portable edition).
- Built with Tauri 2.12.4 (Rust) and CodeMirror 6; the front end does not use a
  framework.
- GitHub repository: https://github.com/krisstianseyer/plainfold
- Update checker source: src/updater.js (UPDATE_OWNER and UPDATE_REPO).
- Source code, issues, and release notes: use the GitHub repository above.
- Building from source: run "npm ci", then "npm run build" for the front end,
  "npm run tauri build" for installers, or "npm run portable" for this folder.
  See PACKAGING.md in the repository.
- License: none is declared in this build; check the repository before
  redistributing.

Copyright (c) 2026 Plainfold.
`.replace(/\n/g, "\r\n");
writeFileSync(resolve(portableDir, "README.txt"), readme);

console.log(`Portable edition ready: ${portableDir}`);
