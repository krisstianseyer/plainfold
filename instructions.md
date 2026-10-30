# Plainfold: Instructions for an AI Coding Agent

Version 1.0 for the first build. Decisions marked Open must be answered by the owner before the agent implements them.

## 1. Project summary

Plainfold is a desktop app for Windows and Linux, inspired by Obsidian, that works with plain text only. A vault is an ordinary folder on disk chosen by the user. Every file is a real file. The app never stores note content anywhere else, and it never renders Markdown or HTML.

## 2. Non-goals for v1

- No Markdown or HTML rendering or preview, and no WYSIWYG editing.
- No split panes, graph view, quick switcher, or plugin system.
- No cloud sync, accounts, or telemetry. Network access is limited to the optional, notify-only GitHub release check added in v1.2; it can be disabled in Settings > Updates and never downloads or installs anything.
- No mobile version.
- No embedded terminal, and no running of scripts (.js, .bat) from inside the app.

## 3. Target platforms

- Windows 11, 64-bit. Installed from an MSI or NSIS installer.
- Linux, 64-bit, Debian family (Debian, Ubuntu, Mint, Pop!\_OS): installed from a .deb package.
- Linux, 64-bit, Fedora and Red Hat family (Fedora, RHEL, Rocky, AlmaLinux): installed from an .rpm package.
- The same codebase builds all three packages. Packaging is verified on each family before release.

## 4. Technology

- Rust backend. Tauri 2 provides the window, installers, and icon generation.
- Front end uses web technologies bundled inside the app. Nothing is loaded from a CDN at runtime.
- Editor component: CodeMirror 6, used for editing and syntax highlighting only.
- Front-end framework: Open (see section 10). Default to no framework unless the agent states a reason in writing.
- Search index: SQLite with the FTS5 full-text extension, through rusqlite.
- Settings: JSON read and written with serde.
- File watching: the notify crate.
- Pin every dependency to a specific version. Keep dependencies few, and note the reason for each one.

## 5. Identity

- App name: Plainfold. Use it for the window title, the installer product name, and the About dialog.
- Bundle identifier: Open (see section 10). Use a placeholder until the owner confirms it.
- Icon: a blank page with a blinking text cursor. No folder imagery. Supply a 1024 by 1024 PNG master and generate all platform sizes with Tauri's icon tooling. The icon must stay readable at 16 by 16 pixels.

## 6. Vault model

- A vault is any folder the user selects. Its folders and files are shown exactly as they are on disk.
- The app must not create hidden files or folders inside the vault.
- Settings live in the operating system config folder. The search index and other app data live in the operating system app data folder, one index per vault, keyed by the vault's full path.
- The index is a cache. Deleting it must never lose user data. The app rebuilds it on demand.
- Tags are stored only in the index. Adding or removing a tag never changes the file.
- Pinned files, recent files, and custom sort order are stored in the index, keyed by path.

## 7. Features for v1

### 7.1 Browsing

- Show a tree of folders and files. Folders are listed before files, and each group is sorted by name by default.
- Custom sort order: the user can drag items to set their order within a folder.
- A Pinned section sits above the tree and lists pinned files.
- A Recent section lists the 20 most recently opened files.
- Filter the tree by tag.

### 7.2 Creating and deleting

- New file and New folder create items in the selected folder. A name containing forward slashes creates the intermediate subfolders in one step.
- Reject names containing any of these characters: backslash, forward slash (except as the path separator described above), colon, asterisk, question mark, double quote, less-than, greater-than, pipe, or control characters. On Windows, also reject the reserved names CON, PRN, AUX, NUL, COM1 through COM9, and LPT1 through LPT9, and names ending in a dot or space.
- Refuse to create an item that already exists.
- Delete asks for confirmation and moves the item to the operating system trash. Permanent deletion is not offered in v1.

### 7.3 Opening and editing

- Any file can be opened. Syntax highlighting is applied by extension for json, xml, html, css, js, bat, and log. Highlighting is the only transformation. HTML is displayed as source text, never rendered. Scripts are never executed.
- Encoding: UTF-8 is the standard. Honor a UTF-8 byte-order mark, and detect UTF-16 LE and BE from their byte-order marks. Files that are not valid in any of these encodings open as read-only with a plain notice. The app never converts an encoding silently.
- Line endings: detect CRLF or LF when a file is opened, and write the same line endings on save. New files use the platform default, CRLF on Windows and LF on Linux.
- Saving is atomic. Write a temporary file in the same folder, flush it to disk, then rename it over the original. A failed save must leave the original file intact.
- Ctrl+S saves. Switching files, closing the window, or opening another vault with unsaved changes asks the user to confirm.
- Tab inserts spaces. The width is a setting, default 4.
- A Wrap toggle switches between wrapped and unwrapped lines. Unwrapped is the default.
- Files larger than 5 MB open read-only with a notice. Size limit: Open (see section 10).

### 7.4 Search

- Ctrl+F focuses the search box. Search matches file names and file contents, case-insensitively.
- Contents search uses the FTS5 index. Only files under 2 MB are indexed for contents. Larger files are searched by name only.
- Each result shows the path and the matching line number, with the matching line. Clicking a result opens the file at that position.
- The index updates when files change, through the file watcher. "Rebuild search index" in Settings > Maintenance rebuilds it from scratch. The old toolbar Rescan button was removed in v1.2.
- Regular expressions are not in v1.

### 7.5 Settings

Store these in settings.json in the operating system config folder, and provide a settings screen for them:

- Theme: light, dark, or follow the system.
- Font family and font size.
- Default sort order: name, modified date, or size.
- Default vault folder, opened at launch.
- Tab width.

Write settings.json atomically. If it is missing or corrupt, fall back to defaults and show a notice. Never crash because of settings.

### 7.6 External changes

- The file watcher detects files changed by other programs.
- An open file that changed on disk reloads automatically when it has no unsaved edits.
- If the open file has unsaved edits, the app must not discard them. The required behavior is Open (see section 10).

### 7.7 Organization

- Tags: add and remove tags on a file, stored in the index. Show tags in the file's header and filter the tree by tag.
- Pinned files: pin and unpin from the context menu.
- Custom sort order: drag and drop, stored in the index.

### 7.8 Linking (not in v1)

The owner's original request included linking between files. It is not required for v1. For later versions, the planned syntax is double square brackets around a vault-relative path, for example a link to a file in a subfolder. Links are plain text and are never rendered. Ctrl+click follows a link. Design the index schema so links can be added later without a migration that changes user data.

## 8. Milestones

Build in this order. Each milestone must end in a working, tested state before the next begins.

1. A window showing the Plainfold name and icon with an empty state. Installers build for Windows (MSI or NSIS), Debian (.deb), and Fedora (.rpm).
2. Open a vault and show the tree, sorted by name.
3. Open, edit, and save text files, including the encoding and line-ending rules in 7.3.
4. Create and delete files and folders, with the name rules in 7.2.
5. Search index and search interface.
6. Settings file and settings screen.
7. Pinned files, recent files, tags, and custom sort order.
8. File watcher and external-change handling.
9. Packaging verification on a Debian-family system and a Fedora-family system, plus a Windows 11 install test.

## 9. Engineering rules

- Canonicalize every path and reject any path that resolves outside the vault root. Do not follow symbolic links that point outside the vault.
- Never write file contents to logs. Log only paths, error codes, and timings.
- Show errors to the user in plain language. Keep technical details in the log.
- No telemetry, including crash reporting. The only network access is the optional, notify-only GitHub release check in v1.2. It sends no account, identifier, or file data, and it can be disabled in Settings > Updates. No other host is contacted.
- Write unit tests for path validation, name validation, encoding detection, line-ending preservation, atomic save, and index queries. Write an integration test that creates a temporary vault, edits and saves files, and checks the results on disk.
- Commit at the end of each milestone with a message naming the milestone.
- Do not change a decision in this document. If a decision seems wrong, write the proposed change in the milestone notes and wait for the owner.

## 10. Open decisions

The owner must answer each of these before the agent implements the related part:

1. Backlinks panel (which files link to the open file): in v1 or later?
2. External change while the file has unsaved edits: keep the edits and show a notice (proposed), or reload anyway?
3. Rename and move of files and folders: in v1 or later?
4. Confirm delete moves to trash only (proposed), or offer permanent deletion?
5. Non-UTF-8 files: open read-only (proposed), or offer conversion?
6. Front-end framework: none (proposed default), Svelte, or React?
7. Bundle identifier in reverse-DNS form, and the publisher name for installers.
8. Editing size limit: 5 MB (proposed). Content indexing size limit: 2 MB (proposed).
9. Confirm that quick switcher and graph view are out of v1.
10. Confirm that custom sort order is drag and drop within a folder, as described in 7.1.

## 11. Definition of done for v1

- Installs and launches on Windows 11 from an MSI or NSIS installer.
- Installs and launches on a Debian-family and a Fedora-family Linux system from .deb and .rpm packages.
- Shows the Plainfold name and icon in the window, the taskbar or dock, and the installer.
- Opens a folder as a vault. The user can browse, create, delete, edit, and save text files.
- Search finds matches in file names and file contents.
- Settings persist across launches in settings.json.
- Files changed by other programs are handled as decided in section 10.
- No Markdown or HTML rendering appears anywhere in the app.
