# Plainfold

Plainfold is a desktop app for Windows and Linux that edits plain text files in an ordinary folder. A repository is just a folder you choose. Every note is a real file. Plainfold never renders Markdown or HTML, never executes scripts, and makes exactly one optional network request: a GitHub release check that only notifies and never downloads or installs anything. There is no telemetry.

## Status

GitHub repository: coming soon. The update checker uses a placeholder repository, so it makes no request until the owner configures a real source.

The v1 feature set in `instructions.md` is implemented:

- Repository tree with folders first, name/modified/size sort, one-click alphabetical sort, pins, recents, tags, drag-to-order, and drag-to-move between folders.
- Create nested files and folders, with full name validation, and move items to the operating system trash.
- CodeMirror 6 editing with extension-based syntax highlighting only.
- UTF-8 (with optional BOM) and BOM-marked UTF-16 LE/BE, preserving encoding, BOM, and CRLF/LF on save.
- Atomic saves: write a temporary file in the same folder, flush, then rename.
- FTS5 search over names and contents, with line numbers and click-to-line results.
- Settings in the OS config folder, written atomically, with safe fallback on corruption.
- A file watcher that reloads clean files and preserves unsaved edits with a notice.
- Unsaved-change prompts offer Save, Discard, and Cancel for switching files, changing repositories, deleting, and closing.
- Autosave modes: off, after idle, or fixed interval. Defaults: off, idle 20 seconds, interval 120 seconds. Autosave runs only while the open file has unsaved edits.
- Compressed revisions stored in the repository's hidden `.revisions` folder; restore from the file context menu. Retention uses Grandfather-Father-Son rotation with configurable hourly, daily, weekly, monthly, and yearly tiers.
- Non-text files (images, audio, video, PDF, Office, Photoshop, archives, executables) open in the OS default app. Text and script formats stay in Plainfold.
- Pinned and Recent context actions: open, pin/unpin, remove from Recent, reveal in the repository tree, tags, and move to the repository root. Clicking the Pinned or Recent heading opens a popup that sets how many entries the section shows.
- Repository tree filter for partial names, paths, or extensions, with `*` and `?` wildcards; matching folders keep their contents visible.
- Resizable sidebar pane; drag the divider, use arrow keys, or double-click to reset.
- Plain-text links: `[[repository-relative/path]]`; Ctrl+click (Cmd+click on macOS) opens the linked file.
- App version and GitHub repository placeholder in the About popover, repository folder/file counts on the left, and words, characters, and size of the open file on the right.
- No framework on the front end; CodeMirror is the only editor dependency.

Version 1.2.0 adds:

- Settings v2: left category navigation, search, auto-save, per-section reset, and a Features tab with 21 feature groups plus advanced per-control toggles. The safety floor cannot be disabled.
- Recent repositories and multiple saved repositories with one active repository. The saved list appears in the sidebar above Pinned and on the welcome screen. Startup reopens the last active repository unless a startup repository is configured. Removing an entry only removes it from the list; it never deletes files from disk.
- "Rebuild search index" moved to Settings > Maintenance. The toolbar Rescan button is gone.
- An automatic, notify-only GitHub Releases update check on launch, with a Settings toggle. The update source is a placeholder in `src/updater.js`, so the check stays inert until it is configured.

The v1.2.0 release round builds the front-end bundle and the release binary only. It does not build installers.

Final v1.2 QA and the release build are pending. `MILESTONES.md` tracks the checks.

The user guide for the v1.2 changes is `docs/features.md`.

Desktop shortcuts:

- Windows MSI always creates Start Menu and Desktop shortcuts.
- Windows NSIS always creates the Start Menu shortcut; its default-checked finish-page option creates the Desktop shortcut.
- Linux packages install the application-menu entry. On first launch, Plainfold asks once whether to create a per-user `.desktop` shortcut on the Desktop.

## Development

Requirements: Node 20+ (tested with 24), Rust 1.77+ (tested with 1.96), and the Tauri 2 platform prerequisites for your OS.

```sh
npm install
npm run dev          # front end only, in a browser (backend calls will fail)
npm run tauri dev    # full desktop app
```

Tests:

Front-end tests are plain Node test files. Run each file directly; Node's test runner spawns child processes, which some sandboxed environments block.

```sh
node tests/frontend/tree-utils.test.mjs
node tests/frontend/link-utils.test.mjs   # repeat for each tests/frontend/*.test.mjs file

cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets -- -D warnings
npm run build                             # production front-end bundle
```

`npm test` runs the same files through Node's test runner. Use it where the environment allows child processes.

Versioning: after each change, run `npm run version:bump`. Default is a patch bump; `npm run version:bump -- minor`, `npm run version:bump -- major`, and explicit targets such as `npm run version:bump -- 0.1.4` are available. The script updates `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` together.

Version 1.2.0 is the version documented here. The rollback point is the annotated tag `v1.1.27` at commit `dcc676e`. To restore it on a new branch:

```sh
git switch -c restore/v1.1.27 v1.1.27
```

## Build installers

```sh
npm run tauri build
```

The bundle targets are `"all"`, so each platform builds the installers it supports: NSIS on Windows, `.deb` and `.rpm` on Linux. See `PACKAGING.md`.

For v1.2.0, the release round builds `npm run build` and `npm run tauri build -- --no-bundle` only. It does not produce installers.

## Data locations

- Settings: the OS config folder, `settings.json`.
- Search index: the OS app data folder, one SQLite file per vault keyed by a stable hash of the vault's full path.
- Logs: the OS app data folder, `logs/plainfold.log`. Logs contain paths, error codes, and timings, never file contents.
- Revisions: `vault/.revisions/<file path>/<UTC timestamp>.gz`. Hidden on Windows; dot-hidden on Linux. Excluded from tree, search, and watcher.
- Vaults: the folder the user selected. Plainfold creates no hidden files or folders in a vault, except `.revisions` and a short-lived `plainfold-save-*` temporary file during an atomic save.

The index is a cache for file contents and organization data (tags, pins, recents, custom order). Deleting it never loses note content.

## Dependencies and why they exist

Front end, pinned exactly in `package.json`:

- `@tauri-apps/api`, `@tauri-apps/cli`: window, events, and build tooling.
- `@tauri-apps/plugin-dialog`: native folder picker and confirmation dialogs.
- `codemirror` plus `@codemirror/*` language packages and `@codemirror/theme-one-dark`: editing and syntax highlighting only.
- `@codemirror/legacy-modes`: shell highlighting for `.bat` files.
- `vite`: front-end bundler. Nothing is loaded from a CDN at runtime.

Rust, pinned exactly in `src-tauri/Cargo.toml`:

- `tauri`: window, IPC, and packaging.
- `tauri-plugin-dialog`: native dialogs.
- `serde`, `serde_json`: settings and IPC types.
- `rusqlite` with bundled SQLite: FTS5 index, no system SQLite dependency.
- `chrono`: revision timestamps.
- `flate2`: gzip-compressed revision snapshots.
- `notify`: file watching.
- `opener`: launch non-text files in the OS default application, and open update release links in the browser.
- `trash`: move files and folders to the OS trash.
- `tempfile` (dev only): isolated test vaults.

Version 1.2 adds no runtime dependencies. The update check uses the webview's `fetch`, and release links use the existing `opener` crate.

## Security rules

- Every path is resolved and canonicalized against the vault root. `..`, absolute paths, drive prefixes, and links that escape the vault are rejected.
- Symbolic links are never edited, overwritten, or followed for deletion.
- File contents are never logged.
- Errors shown in the UI are plain language; technical detail stays out of the interface.
- The app has no telemetry, accounts, sync, or CDN. Its only network request is the optional GitHub Releases check: an ordinary HTTPS request to `api.github.com` that sends no account, identifier, or file data. It is on by default, can be disabled in Settings > Updates, and makes no request while the update source is the placeholder.

## Open owner decisions

`instructions.md` section 10 lists decisions that the owner must confirm. Implementation currently uses the document's proposed defaults. They are recorded, with the affected code, in `MILESTONES.md`. Change them before release if any default is not what you want.
