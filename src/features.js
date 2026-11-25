/**
 * The feature registry for Plainfold 1.2.
 *
 * Group ids are stable and stored in `disabledFeatures`. A feature is enabled
 * unless its group or its own control id is in that list. Unknown ids are
 * treated as enabled so settings written by a newer version never break an
 * older front end.
 */

export const FEATURE_GROUPS = [
  {
    id: "search",
    label: "Search",
    description: "The sidebar search field, its shortcut, and the results panel.",
    controls: [
      {
        id: "search.toolbar",
        label: "Search field",
        description: "Show the search field in the sidebar.",
      },
      {
        id: "search.shortcut",
        label: "Search shortcut",
        description: "Focus search with Ctrl+F and the editor shortcut.",
      },
      {
        id: "search.results",
        label: "Search results",
        description: "Show matching files and lines in a results panel.",
      },
    ],
  },
  {
    id: "treeFilter",
    label: "Tree filter",
    description: "Narrow the repository tree by file name or extension.",
    controls: [
      {
        id: "treeFilter.input",
        label: "Tree filter input",
        description: "Show the filter field above the repository tree.",
      },
    ],
  },
  {
    id: "pinned",
    label: "Pinned",
    description: "The Pinned section and pin actions for files.",
    controls: [
      {
        id: "pinned.section",
        label: "Pinned section",
        description: "Show pinned files in the sidebar.",
      },
      {
        id: "pinned.contextActions",
        label: "Pinned context actions",
        description: "Allow pinning and unpinning from context menus.",
      },
    ],
  },
  {
    id: "recentFiles",
    label: "Recent files",
    description: "The Recent section and its remove action.",
    controls: [
      {
        id: "recentFiles.section",
        label: "Recent files section",
        description: "Show recently opened files in the sidebar.",
      },
      {
        id: "recentFiles.removeAction",
        label: "Remove from Recent",
        description: "Allow removing a file from the Recent list.",
      },
    ],
  },
  {
    id: "tags",
    label: "Tags",
    description: "Tag chips in the editor and tag filtering in the sidebar.",
    controls: [
      {
        id: "tags.filterBar",
        label: "Tag filter bar",
        description: "Show tag chips above the repository tree.",
      },
      {
        id: "tags.editor",
        label: "File tags",
        description: "Show the open file's tags above the editor.",
      },
      {
        id: "tags.contextAction",
        label: "Tag context action",
        description: "Allow editing tags from context menus.",
      },
    ],
  },
  {
    id: "revisions",
    label: "Revisions",
    description: "Revision snapshots, restore actions, and retention settings.",
    controls: [
      {
        id: "revisions.contextAction",
        label: "Revisions context action",
        description: "Allow opening revisions from context menus.",
      },
      {
        id: "revisions.settings",
        label: "Revision retention settings",
        description: "Show revision retention fields in Settings.",
      },
    ],
  },
  {
    id: "autosave",
    label: "Autosave",
    description: "Automatic saving and the settings that control it.",
    controls: [
      {
        id: "autosave.engine",
        label: "Autosave engine",
        description: "Run autosave while a file has unsaved changes.",
      },
      {
        id: "autosave.settings",
        label: "Autosave settings",
        description: "Show autosave fields in Settings.",
      },
    ],
  },
  {
    id: "watcher",
    label: "External-change watcher",
    description:
      "Reload files that change on disk and show a notice. Turning this off stops the watcher the next time a repository is opened.",
    controls: [
      {
        id: "watcher.autoReload",
        label: "Automatic reload",
        description: "Reload the open file when it changes on disk.",
      },
      {
        id: "watcher.notice",
        label: "External-change notice",
        description: "Show a notice when a file changes on disk.",
      },
    ],
  },
  {
    id: "repositoryUndo",
    label: "Repository undo/redo",
    description: "Undo and redo repository changes with buttons and shortcuts.",
    controls: [
      {
        id: "repositoryUndo.buttons",
        label: "Undo/redo menu items",
        description: "Enable repository undo and redo in the Edit menu.",
      },
      {
        id: "repositoryUndo.shortcuts",
        label: "Undo/redo shortcuts",
        description: "Allow Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z for repository steps.",
      },
    ],
  },
  {
    id: "sortAndOrder",
    label: "Sort & drag order",
    description: "Sorting, custom ordering, and drag-and-drop in the tree.",
    controls: [
      {
        id: "sortAndOrder.sortButton",
        label: "Sort button",
        description: "Show the A-Z sort button and sort menu actions.",
      },
      {
        id: "sortAndOrder.dragReorder",
        label: "Drag reorder",
        description: "Reorder sibling items by dragging.",
      },
      {
        id: "sortAndOrder.dragMove",
        label: "Drag move",
        description: "Move items into folders by dragging.",
      },
      {
        id: "sortAndOrder.resetAction",
        label: "Reset custom order",
        description: "Allow resetting a folder's custom order.",
      },
    ],
  },
  {
    id: "createDelete",
    label: "Create/delete",
    description: "Creating files and folders and moving items to the trash.",
    controls: [
      {
        id: "createDelete.newFile",
        label: "New file",
        description: "Show the New file button and menu action.",
      },
      {
        id: "createDelete.newFolder",
        label: "New folder",
        description: "Show the New folder button and menu action.",
      },
      {
        id: "createDelete.emptyNewFile",
        label: "New file from welcome screen",
        description: "Allow the empty state's New file shortcut.",
      },
      {
        id: "createDelete.deleteAction",
        label: "Delete action",
        description: "Allow deleting files and folders.",
      },
    ],
  },
  {
    id: "wrap",
    label: "Wrap toggle",
    description: "The editor's wrap toggle.",
    controls: [
      {
        id: "wrap.toggle",
        label: "Wrap toggle",
        description: "Show the Wrap toggle in the file header.",
      },
    ],
  },
  {
    id: "syntaxHighlighting",
    label: "Syntax highlighting",
    description: "Language-aware coloring in the editor.",
    controls: [
      {
        id: "syntaxHighlighting.editor",
        label: "Editor syntax highlighting",
        description: "Highlight syntax for supported file types.",
      },
    ],
  },
  {
    id: "editorStats",
    label: "Editor statistics",
    description: "Word, character, and size counts for the open file.",
    controls: [
      {
        id: "editorStats.statusWords",
        label: "Word and character counts",
        description: "Show word, character, and size counts in the filename tooltip.",
      },
    ],
  },
  {
    id: "repositoryCounts",
    label: "Repository counts",
    description: "Folder and file totals for the whole repository.",
    controls: [
      {
        id: "repositoryCounts.statusCounts",
        label: "Folder and file counts",
        description: "Show repository totals on the Repository heading.",
      },
    ],
  },
  {
    id: "recentRepositories",
    label: "Recent repositories",
    description: "Saved repositories in the sidebar, welcome screen, and Settings.",
    controls: [
      {
        id: "recentRepositories.section",
        label: "Sidebar repositories section",
        description: "Show the Repositories section in the sidebar.",
      },
      {
        id: "recentRepositories.welcomeList",
        label: "Welcome-screen repositories",
        description: "Show saved repositories on the welcome screen.",
      },
      {
        id: "recentRepositories.removeAction",
        label: "Remove saved repository",
        description: "Allow removing saved repositories from the list.",
      },
    ],
  },
  {
    id: "updates",
    label: "Update checks",
    description: "Optional notifications when a newer Plainfold release exists.",
    controls: [
      {
        id: "updates.autoCheck",
        label: "Automatic update checks",
        description: "Check for a new release once per day at launch.",
      },
      {
        id: "updates.banner",
        label: "Update banner",
        description: "Show a dismissible banner when an update is available.",
      },
      {
        id: "updates.settingsSection",
        label: "Updates settings section",
        description: "Show update status and controls in Settings.",
      },
    ],
  },
  {
    id: "about",
    label: "Application menu info",
    description: "App description, version, and repository link in the Application menu.",
    controls: [
      {
        id: "about.brand",
        label: "About block",
        description: "Show the app description, version, and repository link.",
      },
      {
        id: "about.version",
        label: "Version display",
        description: "Show the running version.",
      },
      {
        id: "about.githubLink",
        label: "GitHub link",
        description: "Show the GitHub repository link placeholder.",
      },
      {
        id: "about.supportLink",
        label: "Support link",
        description: "Show the Ko-fi link for supporting Plainfold.",
      },
    ],
  },
  {
    id: "desktopShortcut",
    label: "Desktop shortcut prompt",
    description: "The one-time offer to create a desktop shortcut.",
    controls: [
      {
        id: "desktopShortcut.firstRunPrompt",
        label: "First-run shortcut prompt",
        description: "Offer to create a desktop shortcut on first launch.",
      },
    ],
  },
  {
    id: "externalFiles",
    label: "Non-text file opening",
    description: "Opening non-text files in their default application.",
    controls: [
      {
        id: "externalFiles.openDefaultApp",
        label: "Open non-text files in default app",
        description: "Open binary and other non-text files outside Plainfold.",
      },
    ],
  },
];

const controlIndex = new Map();
const groupIndex = new Map();
for (const group of FEATURE_GROUPS) {
  groupIndex.set(group.id, group);
  for (const control of group.controls) {
    controlIndex.set(control.id, { ...control, group: group.id });
  }
}

/** Flat list of every advanced control, with its group id attached. */
export const FEATURE_CONTROLS = [...controlIndex.values()];

/** Group id to title-case label. */
export const GROUP_LABELS = Object.freeze(
  Object.fromEntries(FEATURE_GROUPS.map((group) => [group.id, group.label]))
);

/** Every group and control id to its display label. Callable as labels(id). */
const labelMap = Object.freeze(
  Object.fromEntries([
    ...FEATURE_GROUPS.map((group) => [group.id, group.label]),
    ...FEATURE_CONTROLS.map((control) => [control.id, control.label]),
  ])
);

export const labels = Object.assign(
  (id) => labelMap[id] ?? String(id ?? ""),
  labelMap
);

/** Category names in display order for the Features settings view. */
export const FEATURE_CATEGORY_ORDER = ["Browsing", "Editing", "Application"];

/**
 * Maps every group id to its Features settings category:
 * Browsing, Editing, or Application.
 */
export const FEATURE_CATEGORIES = Object.freeze({
  search: "Browsing",
  treeFilter: "Browsing",
  pinned: "Browsing",
  recentFiles: "Browsing",
  tags: "Browsing",
  sortAndOrder: "Browsing",
  repositoryCounts: "Browsing",
  recentRepositories: "Browsing",
  revisions: "Editing",
  autosave: "Editing",
  watcher: "Editing",
  repositoryUndo: "Editing",
  createDelete: "Editing",
  wrap: "Editing",
  syntaxHighlighting: "Editing",
  editorStats: "Editing",
  updates: "Application",
  about: "Application",
  desktopShortcut: "Application",
  externalFiles: "Application",
});

/** Display label for any known group or control id, or the id itself. */
export function labelFor(id) {
  return labels[id] ?? String(id ?? "");
}

/**
 * The group id that owns a control id. Group ids return themselves. Unknown
 * ids return null.
 */
export function groupOf(controlId) {
  if (groupIndex.has(controlId)) return controlId;
  return controlIndex.get(controlId)?.group ?? null;
}

/** All advanced controls belonging to a group. Unknown groups return []. */
export function controlsForGroup(groupId) {
  return groupIndex.get(groupId)?.controls ?? [];
}

function disabledSet(disabledFeatures) {
  if (disabledFeatures instanceof Set) return disabledFeatures;
  if (Array.isArray(disabledFeatures)) return new Set(disabledFeatures);
  return new Set();
}

/**
 * True when neither the id nor its group is disabled. Unknown ids are enabled
 * and never throw.
 */
export function featureEnabled(id, disabledFeatures) {
  const disabled = disabledSet(disabledFeatures);
  if (disabled.has(id)) return false;
  const group = groupOf(id);
  if (group && group !== id && disabled.has(group)) return false;
  return true;
}
