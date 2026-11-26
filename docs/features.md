# Plainfold 1.2 features

This is the user-facing guide for Plainfold 1.2.0. It covers the Settings window, the feature toggles, saved repositories, and update checks. The implementation contract is `docs/v1.2-spec.md`.

## The safety floor

Some controls cannot be disabled. They are the safety floor:

- Settings.
- Open or switch repository.
- The repository tree.
- The editor.
- Save.
- The close and unsaved-change guard.
- Error and status notices.
- Window controls.
- Encoding and read-only guards.

Settings is always reachable from the Application menu, so a disabled feature can always be restored.

## What disabling a feature does

There are two levels of control:

- A **feature group** switch disables the whole group.
- An **advanced control** switch disables one part of a group. Advanced switches only matter while the group is on.

When a feature is disabled, Plainfold hides its control everywhere, blocks its keyboard shortcut, and blocks the action itself. Disabling is not deletion. Plainfold keeps:

- Tags.
- Pins.
- Recent files.
- Recent repositories.
- Custom sort order.
- Existing revisions.
- Every file in the repository.

Files are never deleted because a feature was turned off.

Two groups also have backend effects:

- **External-change watcher** stops watching on the next repository open. Settings explains this.
- **Revisions** stops capturing new snapshots on save. Existing revisions stay on disk, and restore works again if the feature is re-enabled.

All other disabling is a front-end visibility and action guard.

## Settings

The Settings window has left category navigation. There is no Save/Cancel footer: changes save themselves, and a brief "Saved" indicator confirms a successful save.

| Category | What it contains |
|---|---|
| Appearance | Theme, font family, font size, and Window chrome options for the full menu title bar, status bar, and file header buttons, plus a desktop menu layout preset. Themes: Follow the system, Light, White, Dark, Sepia, Nord, Solarized Light, Solarized Dark, Midnight, Forest. Accent color: theme default or Blue, Teal, Green, Amber, Orange, Rose, Violet, or Slate, applied to every theme, with selectable coverage for the title bar, file header, status bar, sidebar, controls, and editor. Content background: follow theme, White, Paper, Gray, Dark, or Black; editor text and syntax colors adapt to the chosen pane. |
| Editor | Tab width, autosave, revision retention, and editor statistics. |
| Sidebar & Tree | Pinned and recent limits, default sort, tree filtering, sort and drag behavior, and create/delete. |
| Search | Search feature state, index information, and Rebuild index. |
| Repositories | Startup repository, an explanation of reopen-last behavior, the recent repository limit, and the saved repository list with remove controls. |
| Updates | Auto-check switch, Check now, current version, latest version, last checked, and update source status. |
| Features | All 20 feature groups, grouped under Browsing, Editing, and Application. Each group expands to its advanced controls. |
| Maintenance | Rebuild search index, clear recent repositories, and reset all settings. |
| About | Version, update source, GitHub placeholder, and a plain-language note about the app. |

Auto-save rules:

- Checkboxes and selects save immediately.
- Text and number inputs debounce for 500 ms. Pressing Enter or closing the dialog flushes pending changes.
- The dialog does not close on a validation or save error. The message appears inline.
- After a successful save, the normal settings path runs and settings are applied.
- Per-section Reset restores only that section's settings and feature flags.

The search field filters settings by label, help text, and key. When nothing matches, it shows "No settings match".

## Feature groups

These are the 21 groups in Settings > Features, with the advanced controls each one contains. Group and control IDs are stored in `disabledFeatures`.

| Group | What it covers | Advanced controls |
|---|---|---|
| Search | Sidebar search, the search shortcut, and the results list. | `search.toolbar`, `search.shortcut`, `search.results` |
| Tree filter | The filter field above the repository tree. | `treeFilter.input` |
| Pinned | The Pinned section and its context menu actions. | `pinned.section`, `pinned.contextActions` |
| Recent files | The Recent section and the Remove from Recent action. | `recentFiles.section`, `recentFiles.removeAction` |
| Tags | The tag filter bar, the tag editor, and the tags context action. | `tags.filterBar`, `tags.editor`, `tags.contextAction` |
| Revisions | Show revisions and the revision retention settings. | `revisions.contextAction`, `revisions.settings` |
| Autosave | The autosave engine and its settings fields. | `autosave.engine`, `autosave.settings` |
| External-change watcher | Reloading a clean file and the notice for a file with unsaved edits. | `watcher.autoReload`, `watcher.notice` |
| Repository undo/redo | Undo and redo for repository operations, through Edit menu items and shortcuts. | `repositoryUndo.buttons`, `repositoryUndo.shortcuts` |
| Sort & drag order | The one-click sort button, drag reorder, drag move, and reset action. | `sortAndOrder.sortButton`, `sortAndOrder.dragReorder`, `sortAndOrder.dragMove`, `sortAndOrder.resetAction` |
| Create/delete | New file, new folder, new empty file, and delete to trash. | `createDelete.newFile`, `createDelete.newFolder`, `createDelete.emptyNewFile`, `createDelete.deleteAction` |
| Wrap toggle | The Word Wrap item in the Edit menu. | `wrap.toggle` |
| Syntax highlighting | Extension-based highlighting in the editor. | `syntaxHighlighting.editor` |
| Editor statistics | Word, character, and size counts in the filename tooltip. | `editorStats.statusWords` |
| Repository counts | Folder and file counts on the Repository heading tooltip. | `repositoryCounts.statusCounts` |
| Recent repositories | The Repositories section, the welcome-screen list, and remove controls. | `recentRepositories.section`, `recentRepositories.welcomeList`, `recentRepositories.removeAction` |
| Update checks | The automatic launch check, the update banner, and the Updates settings section. | `updates.autoCheck`, `updates.banner`, `updates.settingsSection` |
| About block | The app description, version, GitHub link, and Ko-fi support link in the Application menu and Settings > About. | `about.brand`, `about.version`, `about.githubLink`, `about.supportLink` |
| Desktop shortcut prompt | The first-run Linux desktop shortcut prompt. | `desktopShortcut.firstRunPrompt` |
| Non-text file opening | Opening images, audio, video, PDF, Office, and similar files in the OS default app. | `externalFiles.openDefaultApp` |

## Recent repositories

Plainfold keeps a list of saved repositories and has exactly one active repository at a time.

- The list is most recent first. It stores up to 20 canonical paths.
- Settings > Repositories sets how many entries are shown, from 1 to 20. The default is 8.
- The sidebar shows a Repositories section directly above Pinned. It appears only while the Recent repositories feature is on.
- The welcome screen shows the same list above the Open a folder button.
- The active repository is marked. Clicking an inactive entry switches to it, asking the unsaved-changes question first and showing the loading overlay.
- A remove control appears on hover or focus. Removing the active repository is refused; switch to another repository first.
- An entry whose folder is missing is disabled and labelled "Missing".
- Removing an entry only removes it from the list. Plainfold never deletes repository files from disk.
- If the Recent repositories feature is off, the sidebar section and welcome list are hidden. Open Repository and switching repositories remain available through the core Open Repository button.

The saved list and last active repository are managed by the backend. Saving settings from the front end cannot erase them.

## Startup behavior

On launch, Plainfold chooses a repository in this order:

1. The startup repository, if one is configured (the existing `defaultRepository` setting).
2. The last active repository.
3. The welcome screen, which includes the saved repository list.

If a stored repository is missing or cannot be opened, Plainfold shows a plain notice. It does not crash and does not delete the entry.

## Maintenance

Settings > Maintenance contains:

- **Rebuild search index.** This is the old Rescan action, moved out of the toolbar. It rebuilds the index, reports the indexed file count in the status bar, and is disabled when no repository is open.
- **Clear recent repositories.** Clears the saved repository list. It does not delete files.
- **Reset all settings.** Returns settings and feature toggles to their defaults.

## Update checks

Plainfold can check GitHub Releases for a newer version on launch. The check is notify-only.

- It runs at most once per 24 hours, after startup, without blocking the UI.
- It is on by default. The switch is in Settings > Updates.
- It never downloads or installs anything. It never replaces files.
- The app's only network destination is `https://api.github.com`.
- There is no telemetry, account, token, or identifier. The request is an ordinary HTTPS request; as with any HTTPS request, GitHub sees the connection's IP address and standard request headers. No repository path or file content is sent.

The update source is configured in `src/updater.ts`:

```js
const UPDATE_OWNER = "krisstianseyer";
const UPDATE_REPO = "plainfold";
```

While the owner is the `your-github-user` placeholder, the source counts as unconfigured and no request is made. Plainfold requests `https://api.github.com/repos/<owner>/<repo>/releases/latest`, ignores drafts and prereleases, and accepts a `tag_name` and `html_url`. The request times out after 8 seconds. A network or HTTP problem never crashes the app.

When an update is found, a dismissible banner appears below the top bar: `Plainfold <version> is available.` It offers Release notes and Dismiss. Dismiss remembers that version. Release notes open in the browser through the existing `opener` crate, and only `https://github.com/` addresses are accepted.

Settings > Updates shows the source status, the current and latest versions, the last-checked time, Check now, and the auto-check switch. Turning auto-check off means launch makes no update request. The app makes no other network request.

## Release and rollback

Version 1.2.0 is the v1.2 release. The rollback point is the annotated tag `v1.1.27` at commit `dcc676e`:

```sh
git switch -c restore/v1.1.27 v1.1.27
```
