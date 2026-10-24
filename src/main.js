import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";

import { api } from "./api.js";
import { createEditor } from "./editor.js";
import {
  basename,
  contentChangedSince,
  countFiles,
  filterTree,
  filterTreeByQuery,
  findNode,
  flattenTree,
  formatBytes,
  formatDate,
  isPathWithin,
  parentOf,
} from "./tree-utils.js";

const $ = (id) => document.getElementById(id);

const els = {
  openVault: $("open-vault"),
  emptyOpen: $("empty-open"),
  emptyState: $("empty-state"),
  emptyTitle: document.querySelector("#empty-state h1"),
  emptyCopy: document.querySelector("#empty-state p"),
  search: $("search"),
  undoButton: $("undo-button"),
  redoButton: $("redo-button"),
  rescan: $("rescan"),
  settingsButton: $("settings-button"),
  pinnedList: $("pinned-list"),
  recentList: $("recent-list"),
  tree: $("tree"),
  treeFilter: $("tree-filter"),
  treeEmpty: $("tree-empty"),
  rootDropZone: $("root-drop-zone"),
  sidebarFooter: document.querySelector(".sidebar-footer"),
  tagFilter: $("tag-filter"),
  sortAlpha: $("sort-alpha"),
  newFile: $("new-file"),
  newFolder: $("new-folder"),
  vaultName: $("vault-name"),
  layout: document.querySelector(".layout"),
  paneResizer: $("pane-resizer"),
  workspace: document.querySelector(".workspace"),
  sidebar: document.querySelector(".sidebar"),
  editorPane: $("editor-pane"),
  fileName: $("file-name"),
  filePath: $("file-path"),
  fileMeta: $("file-meta"),
  fileTags: $("file-tags"),
  wrapToggle: $("wrap-toggle"),
  saveButton: $("save-button"),
  editor: $("editor"),
  notice: $("notice"),
  noticeText: $("notice-text"),
  noticeClose: $("notice-close"),
  appVersion: $("app-version"),
  statusLeft: $("status-left"),
  statusRight: $("status-right"),
  searchResults: $("search-results"),
  resultsList: $("results-list"),
  resultsEmpty: $("results-empty"),
  closeResults: $("close-results"),
  contextMenu: $("context-menu"),
  promptDialog: $("prompt-dialog"),
  promptForm: $("prompt-form"),
  promptTitle: $("prompt-title"),
  promptCopy: $("prompt-copy"),
  promptLabel: $("prompt-label"),
  promptInput: $("prompt-input"),
  promptError: $("prompt-error"),
  promptSubmit: $("prompt-submit"),
  promptCancel: $("prompt-cancel"),
  tagsDialog: $("tags-dialog"),
  tagsForm: $("tags-form"),
  tagsInput: $("tags-input"),
  tagsError: $("tags-error"),
  tagsCancel: $("tags-cancel"),
  unsavedDialog: $("unsaved-dialog"),
  unsavedCopy: $("unsaved-copy"),
  unsavedSave: $("unsaved-save"),
  revisionsDialog: $("revisions-dialog"),
  revisionsCopy: $("revisions-copy"),
  revisionsList: $("revisions-list"),
  revisionsEmpty: $("revisions-empty"),
  revisionsClose: $("revisions-close"),
  settingsDialog: $("settings-dialog"),
  settingsForm: $("settings-form"),
  settingTheme: $("setting-theme"),
  settingFontFamily: $("setting-font-family"),
  settingFontSize: $("setting-font-size"),
  settingTabWidth: $("setting-tab-width"),
  settingPinnedLimit: $("setting-pinned-limit"),
  settingRecentLimit: $("setting-recent-limit"),
  settingAutosaveMode: $("setting-autosave-mode"),
  settingAutosaveIdle: $("setting-autosave-idle"),
  settingAutosaveInterval: $("setting-autosave-interval"),
  settingRevisionHourly: $("setting-revision-hourly"),
  settingRevisionDaily: $("setting-revision-daily"),
  settingRevisionWeekly: $("setting-revision-weekly"),
  settingRevisionMonthly: $("setting-revision-monthly"),
  settingRevisionYearly: $("setting-revision-yearly"),
  settingSort: $("setting-sort"),
  settingDefaultVault: $("setting-default-vault"),
  chooseDefaultVault: $("choose-default-vault"),
  useCurrentVault: $("use-current-vault"),
  clearDefaultVault: $("clear-default-vault"),
  settingsError: $("settings-error"),
  settingsCancel: $("settings-cancel"),
};

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 292;
const SIDEBAR_STORAGE_KEY = "plainfold.sidebarWidth";

const ZOOM_MIN = 8;
const ZOOM_MAX = 48;
const ZOOM_STEP = 1;
const ZOOM_STORAGE_KEY = "plainfold.zoom";

const DEFAULT_SETTINGS = {
  theme: "system",
  fontFamily: "Consolas",
  fontSize: 14,
  defaultSort: "name",
  defaultVault: null,
  tabWidth: 4,
  pinnedLimit: 5,
  recentLimit: 5,
  autosaveMode: "off",
  autosaveIdleSecs: 20,
  autosaveIntervalSecs: 120,
  revisionHourly: 24,
  revisionDaily: 7,
  revisionWeekly: 4,
  revisionMonthly: 12,
  revisionYearly: 100,
  desktopShortcutPrompted: false,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  vault: null,
  tree: [],
  expanded: new Set(),
  selected: null,
  currentFile: null,
  editor: null,
  dirty: false,
  wrap: false,
  tags: new Map(),
  tagCounts: [],
  pins: [],
  recents: [],
  tagFilter: null,
  fileFilter: "",
  searchTimer: null,
  searchSequence: 0,
  dragSource: null,
  settingsDraftVault: null,
  dark: false,
  saving: false,
  moving: false,
  autosaveTimer: null,
  autosavePaused: false,
  sidebarWidth: SIDEBAR_DEFAULT,
  menuReturnFocus: null,
  pendingTreeFocus: null,
  // Editor zoom in pixels. Null follows the font size from Settings.
  zoom: null,
  // Text of the open file on disk, restored when an edit is undone.
  diskContent: null,
  undoInfo: { undoLabel: null, redoLabel: null },
  undoBusy: false,
};

const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => {
  if ((state.settings.theme ?? "system") === "system") applyTheme();
});

function errText(error) {
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  return "The operation could not be completed.";
}

function setStatus(text) {
  els.statusLeft.textContent = text;
}

function updateStatusRight() {
  els.statusRight.textContent = state.vault
    ? `${state.vault.path} · ${countFiles(state.tree)} file${countFiles(state.tree) === 1 ? "" : "s"}`
    : "";
}

function setNotice(text, kind = "info") {
  if (!text) {
    els.notice.hidden = true;
    els.noticeText.textContent = "";
    return;
  }
  els.noticeText.textContent = text;
  els.notice.className = kind === "info" ? "notice info" : "notice";
  els.notice.hidden = false;
}

/** Dismiss whatever message is showing without changing anything else. */
function dismissNotice() {
  if (els.notice.hidden) return false;
  setNotice("");
  return true;
}

function updateTitle() {
  if (state.currentFile) {
    const marker = state.dirty ? "• " : "";
    document.title = `${marker}${basename(state.currentFile.path)} — Plainfold`;
  } else {
    document.title = "Plainfold";
  }
}

function fontValue(raw) {
  const value = (raw ?? "").trim() || "Consolas";
  if (value.includes(",") || value.startsWith('"') || value.startsWith("'")) {
    return value;
  }
  return `"${value.replaceAll('"', "")}"`;
}

function applyTheme() {
  const setting = state.settings.theme ?? "system";
  const dark = setting === "dark" || (setting === "system" && media.matches);
  state.dark = dark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.setProperty(
    "--editor-font",
    `${fontValue(state.settings.fontFamily)}, "DejaVu Sans Mono", monospace`
  );
  applyZoom();
  state.editor?.setTheme(dark);
}

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

/** The size the editor actually uses: the zoom level when set, otherwise
 *  the font size from Settings. */
function editorFontSize() {
  return state.zoom ?? clampZoom(Number(state.settings.fontSize) || 14);
}

function applyZoom() {
  document.documentElement.style.setProperty(
    "--editor-size",
    `${editorFontSize()}px`
  );
}

function loadZoom() {
  try {
    const value = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) {
      return clampZoom(value);
    }
  } catch {
    return null;
  }
  return null;
}

function saveZoom() {
  try {
    if (state.zoom === null) localStorage.removeItem(ZOOM_STORAGE_KEY);
    else localStorage.setItem(ZOOM_STORAGE_KEY, String(state.zoom));
  } catch {
    return;
  }
}

/** Drop the zoom level so the font size from Settings applies again. */
function resetZoom() {
  if (state.zoom === null) return;
  state.zoom = null;
  applyZoom();
  saveZoom();
  setStatus("Zoom reset to the size set in Settings.");
}

/** Zoom by whole steps, keeping the caret visible. */
function zoomBy(delta) {
  const next = clampZoom(editorFontSize() + delta * ZOOM_STEP);
  if (next === editorFontSize()) return;
  state.zoom = next;
  applyZoom();
  saveZoom();
  setStatus(`Zoom ${next}px. Ctrl+wheel to change, Ctrl+0 to reset.`);
}

/** Ctrl+wheel is the familiar Notepad gesture. Only the editor reacts; the
 *  rest of the window keeps its normal scrolling. */
function wireZoom(element) {
  element.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false }
  );
}

function applySettings(next) {
  state.settings = { ...DEFAULT_SETTINGS, ...next };
  applyTheme();
  state.editor?.setTabWidth(state.settings.tabWidth);
  clearAutosave();
  scheduleAutosave();
  renderShortLists();
  renderTree();
}

function loadSidebarWidth() {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY));
    if (Number.isFinite(value) && value >= SIDEBAR_MIN && value <= SIDEBAR_MAX) {
      return value;
    }
  } catch {
    return SIDEBAR_DEFAULT;
  }
  return SIDEBAR_DEFAULT;
}

function applySidebarWidth(width) {
  const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
  state.sidebarWidth = next;
  els.layout.style.setProperty("--sidebar-width", `${next}px`);
  els.paneResizer.setAttribute("aria-valuenow", String(next));
  return next;
}

function saveSidebarWidth() {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(state.sidebarWidth));
  } catch {
    return;
  }
}

function updateControls() {
  const hasVault = Boolean(state.vault);
  const hasFile = Boolean(state.currentFile);
  els.search.disabled = !hasVault;
  els.rescan.disabled = !hasVault;
  const undoLabel = state.undoInfo.undoLabel;
  els.undoButton.disabled = !hasVault || state.undoBusy;
  els.undoButton.title = undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo";
  const redoLabel = state.undoInfo.redoLabel;
  els.redoButton.disabled = !hasVault || state.undoBusy;
  els.redoButton.title = redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : "Nothing to redo";
  els.treeFilter.disabled = !hasVault;
  els.sortAlpha.disabled = !hasVault;
  els.newFile.disabled = !hasVault;
  els.newFolder.disabled = !hasVault;
  els.wrapToggle.disabled = !hasFile;
  els.saveButton.disabled = !hasFile || state.currentFile?.readOnly || !state.dirty;
  els.saveButton.title = state.currentFile?.readOnly ? "This file is read-only" : "Save (Ctrl+S)";
  const filtered = Boolean(state.tagFilter || state.fileFilter);
  els.tree.classList.toggle("filtered", filtered);
  if (!hasVault) {
    els.emptyState.hidden = false;
    els.editorPane.hidden = true;
    els.emptyTitle.textContent = "Plain text, plain files.";
    els.emptyCopy.textContent =
      "Open a folder as your vault. Every note stays a real file on disk, in the encoding and line endings it already uses.";
    els.emptyOpen.textContent = "Open a folder";
  } else if (!hasFile) {
    els.emptyState.hidden = false;
    els.editorPane.hidden = true;
    els.emptyTitle.textContent = "Choose a file.";
    els.emptyCopy.textContent =
      "Select a file in the vault, or create one. Files are opened as plain text, never rendered.";
    els.emptyOpen.textContent = "New file";
  }
}

function handleNotices(notices) {
  if (!notices?.length) return;
  setStatus(notices.join(" "));
  if (state.currentFile) setNotice(notices.join(" "), "info");
}

/* ------------------------------------------------------------------ */
/* Vault and tree                                                      */
/* ------------------------------------------------------------------ */

async function chooseVault() {
  if (!(await resolvePendingChanges())) return;
  let selected;
  try {
    selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open a vault folder",
    });
  } catch (error) {
    setStatus(errText(error));
    return;
  }
  if (!selected) return;
  await activateVault(selected);
}

async function activateVault(path) {
  try {
    setStatus("Opening vault…");
    const snapshot = await api.openVault(path);
    applySnapshot(snapshot);
    await refreshOrganization();
    handleNotices(snapshot.notices);
    setStatus(state.vault ? `Opened ${state.vault.name}.` : "Ready");
  } catch (error) {
    setStatus(errText(error));
  }
}

function applySnapshot(snapshot) {
  closeEditor({ silent: true });
  els.search.value = "";
  els.treeFilter.value = "";
  hideResults();
  state.settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
  els.appVersion.textContent = snapshot.version ? `v${snapshot.version}` : "";
  state.vault = snapshot.vault;
  state.tree = snapshot.tree ?? [];
  state.expanded = new Set();
  state.selected = null;
  state.tagFilter = null;
  state.fileFilter = "";
  state.tags = new Map();
  state.tagCounts = [];
  state.pins = [];
  state.recents = [];
  state.undoInfo = { undoLabel: null, redoLabel: null };
  refreshUndoState();
  applyTheme();
  els.vaultName.textContent = state.vault ? state.vault.path : "No vault open";
  els.vaultName.title = state.vault ? state.vault.path : "";
  renderTree();
  renderShortLists();
  renderTagFilter();
  updateControls();
  updateStatusRight();
  updateTitle();
}

async function loadTree() {
  if (!state.vault) {
    state.tree = [];
    renderTree();
    return;
  }
  try {
    state.tree = await api.listTree();
    if (state.selected && !findNode(state.tree, state.selected)) {
      state.selected = null;
    }
    renderTree();
    updateStatusRight();
    updateControls();
  } catch (error) {
    setStatus(errText(error));
  }
  refreshUndoState();
}

async function refreshOrganization() {
  if (!state.vault) {
    state.tags = new Map();
    state.tagCounts = [];
    state.pins = [];
    state.recents = [];
    renderShortLists();
    renderTagFilter();
    renderFileTags();
    return;
  }
  try {
    const organization = await api.getOrganization();
    const tags = new Map();
    for (const [path, list] of Object.entries(organization.tags ?? {})) {
      tags.set(path, list);
    }
    state.tags = tags;
    state.tagCounts = organization.tagCounts ?? [];
    state.pins = organization.pins ?? [];
    state.recents = organization.recents ?? [];
    renderShortLists();
    renderTagFilter();
    renderFileTags();
    renderTree();
    updateControls();
  } catch (error) {
    setStatus(errText(error));
  }
}

function renderShortLists() {
  const pinnedLimit = state.settings.pinnedLimit ?? 5;
  const recentLimit = state.settings.recentLimit ?? 5;
  renderShortList(els.pinnedList, state.pins.slice(0, pinnedLimit), "Nothing pinned.", "pinned");
  renderShortList(
    els.recentList,
    state.recents.slice(0, recentLimit),
    "No recent files.",
    "recent"
  );
}

function renderShortList(element, paths, emptyText, source) {
  element.textContent = "";
  if (!paths.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    element.append(li);
    return;
  }
  const existing = new Set(flattenTree(state.tree).map((node) => node.path));
  for (const path of paths) {
    if (!existing.has(path)) continue;
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = basename(path);
    button.title = path;
    button.addEventListener("click", () => openFile(path));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const node = findNode(state.tree, path);
      if (!node) return;
      state.selected = path;
      renderTree();
      showContextMenu(event.clientX, event.clientY, node, source);
    });
    li.append(button);
    element.append(li);
  }
  if (!element.children.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyText;
    element.append(li);
  }
}

function renderTagFilter() {
  els.tagFilter.textContent = "";
  if (!state.tagCounts.length) {
    state.tagFilter = null;
    return;
  }
  if (
    state.tagFilter &&
    !state.tagCounts.some(
      (item) => item.tag.toLowerCase() === state.tagFilter.toLowerCase()
    )
  ) {
    state.tagFilter = null;
  }
  for (const { tag, count } of state.tagCounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    if (state.tagFilter && state.tagFilter.toLowerCase() === tag.toLowerCase()) {
      button.classList.add("active");
    }
    button.title = `Filter by ${tag}`;
    const label = document.createElement("span");
    label.textContent = tag;
    const countEl = document.createElement("span");
    countEl.className = "tag-count";
    countEl.textContent = String(count);
    button.append(label, countEl);
    button.addEventListener("click", () => {
      if (state.tagFilter && state.tagFilter.toLowerCase() === tag.toLowerCase()) {
        state.tagFilter = null;
      } else {
        state.tagFilter = tag;
      }
      renderTagFilter();
      renderTree();
      updateControls();
    });
    els.tagFilter.append(button);
  }
}

function treeForDisplay() {
  let display = state.tree;
  if (state.tagFilter) {
    const needle = state.tagFilter.toLowerCase();
    const matching = new Set();
    for (const [path, tags] of state.tags) {
      if (tags.some((tag) => tag.toLowerCase() === needle)) matching.add(path);
    }
    display = filterTree(display, matching);
  }
  if (state.fileFilter) {
    display = filterTreeByQuery(display, state.fileFilter);
  }
  return display;
}

function renderTree() {
  const activeEntry = els.tree.contains(document.activeElement)
    ? document.activeElement.closest?.(".tree-entry")
    : null;
  if (activeEntry?.dataset.path) {
    state.pendingTreeFocus = activeEntry.dataset.path;
  }
  els.tree.textContent = "";
  if (!state.vault) {
    els.treeEmpty.hidden = true;
    return;
  }
  const display = treeForDisplay();
  const all = flattenTree(display);
  els.treeEmpty.hidden = all.length > 0;
  els.treeEmpty.textContent = state.tagFilter
    ? "No files carry this tag."
    : state.fileFilter
      ? "No items match this filter."
      : "This vault is empty.";
  const filtered = Boolean(state.tagFilter || state.fileFilter);
  renderNodes(display, 0, filtered);
  const entries = [...els.tree.querySelectorAll(".tree-entry")];
  entries.forEach((entry) => {
    entry.tabIndex = -1;
  });
  const focusTarget =
    entries.find((entry) => entry.dataset.path === state.focusPath) ||
    entries.find((entry) => entry.dataset.path === state.selected) ||
    entries[0];
  if (focusTarget) focusTarget.tabIndex = 0;
  if (state.pendingTreeFocus) {
    const pending = entries.find(
      (entry) => entry.dataset.path === state.pendingTreeFocus
    );
    state.pendingTreeFocus = null;
    pending?.focus();
  }
}

function selectTreePath(path) {
  state.selected = path;
  for (const row of els.tree.querySelectorAll(".tree-row")) {
    row.classList.toggle("selected", row.dataset.path === path);
  }
  for (const entry of els.tree.querySelectorAll(".tree-entry")) {
    entry.setAttribute(
      "aria-selected",
      entry.dataset.path === path ? "true" : "false"
    );
  }
}

function treeEntryList() {
  return [...els.tree.querySelectorAll(".tree-entry")];
}

function handleTreeKeydown(event) {
  const entry = event.target.closest?.(".tree-entry");
  if (!entry) return;
  const entries = treeEntryList();
  const index = entries.indexOf(entry);
  if (index < 0) return;
  const node = findNode(state.tree, entry.dataset.path);
  const focusAt = (nextIndex) => {
    const next = entries[nextIndex];
    if (!next) return;
    entries.forEach((item) => {
      item.tabIndex = -1;
    });
    next.tabIndex = 0;
    next.focus();
  };

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusAt(Math.min(entries.length - 1, index + 1));
      break;
    case "ArrowUp":
      event.preventDefault();
      focusAt(Math.max(0, index - 1));
      break;
    case "Home":
      event.preventDefault();
      focusAt(0);
      break;
    case "End":
      event.preventDefault();
      focusAt(entries.length - 1);
      break;
    case "ArrowRight":
      if (node?.isDir) {
        event.preventDefault();
        if (!state.expanded.has(node.path)) {
          state.expanded.add(node.path);
          state.pendingTreeFocus = node.path;
          renderTree();
        } else if (entries[index + 1]?.dataset.parent === node.path) {
          focusAt(index + 1);
        }
      }
      break;
    case "ArrowLeft":
      event.preventDefault();
      if (node?.isDir && state.expanded.has(node.path)) {
        state.expanded.delete(node.path);
        state.pendingTreeFocus = node.path;
        renderTree();
      } else {
        const parentPath = parentOf(entry.dataset.path);
        if (parentPath) {
          focusAt(entries.findIndex((item) => item.dataset.path === parentPath));
        }
      }
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      entry.click();
      break;
    default:
      break;
  }
}

function renderNodes(nodes, depth, filtered) {
  for (const node of nodes) {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.setAttribute("role", "none");
    row.dataset.path = node.path;
    row.dataset.parent = parentOf(node.path);
    row.dataset.isDir = node.isDir ? "true" : "false";
    row.dataset.name = node.name;
    row.style.paddingLeft = `${depth * 14}px`;
    if (state.selected === node.path) row.classList.add("selected");
    row.draggable = !filtered;

    const disclosure = document.createElement("span");
    disclosure.className = "tree-disclosure";
    disclosure.setAttribute("aria-hidden", "true");
    const expanded = filtered || state.expanded.has(node.path);
    if (node.isDir) {
      disclosure.textContent = expanded ? "▾" : "▸";
      disclosure.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.expanded.has(node.path)) state.expanded.delete(node.path);
        else state.expanded.add(node.path);
        state.pendingTreeFocus = node.path;
        renderTree();
      });
    } else {
      disclosure.classList.add("leaf");
    }

    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "tree-entry";
    entry.title = node.path;
    entry.dataset.path = node.path;
    entry.setAttribute("role", "treeitem");
    entry.setAttribute("aria-level", String(depth + 1));
    entry.setAttribute(
      "aria-selected",
      state.selected === node.path ? "true" : "false"
    );
    if (node.isDir) {
      entry.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    const glyph = document.createElement("span");
    glyph.className = node.isDir ? "folder-glyph" : "file-glyph";
    glyph.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = node.name;
    entry.append(glyph, name);
    if (node.isSymlink) {
      const kind = document.createElement("span");
      kind.className = "tree-kind";
      kind.textContent = "link";
      entry.append(kind);
    }
    entry.addEventListener("click", () => {
      state.selected = node.path;
      if (node.isDir) {
        if (state.expanded.has(node.path)) state.expanded.delete(node.path);
        else state.expanded.add(node.path);
        state.pendingTreeFocus = node.path;
        renderTree();
      } else {
        openFile(node.path);
      }
    });
    entry.addEventListener("focus", () => {
      state.focusPath = node.path;
      selectTreePath(node.path);
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.selected = node.path;
      renderTree();
      showContextMenu(event.clientX, event.clientY, node);
    });
    row.addEventListener("dragstart", (event) => {
      if (filtered || state.saving || state.moving) {
        event.preventDefault();
        return;
      }
      state.dragSource = {
        path: node.path,
        parent: parentOf(node.path),
        name: node.name,
      };
      els.rootDropZone.hidden = !state.dragSource.parent;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.path);
      row.classList.add("dragging");
    });
    const clearDrop = () => {
      row.classList.remove("drop-target", "drop-into");
      delete row.dataset.dropMode;
      els.tree.querySelectorAll(".drop-target, .drop-into").forEach((element) => {
        element.classList.remove("drop-target", "drop-into");
      });
      els.tree.classList.remove("drop-root");
      els.rootDropZone.classList.remove("drop-root");
      els.sidebarFooter.classList.remove("drop-root");
      els.rootDropZone.hidden = true;
    };
    row.addEventListener("dragend", () => {
      state.dragSource = null;
      row.classList.remove("dragging");
      clearDrop();
    });
    row.addEventListener("dragover", (event) => {
      const source = state.dragSource;
      if (!source || source.path === node.path) return;
      const sameParent = source.parent === parentOf(node.path);
      const canMoveInto =
        node.isDir &&
        node.path !== source.parent &&
        !isPathWithin(node.path, source.path);
      if (!sameParent && !canMoveInto) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
      const into = canMoveInto && (!sameParent || (ratio > 0.25 && ratio < 0.75));
      row.classList.toggle("drop-target", !into);
      row.classList.toggle("drop-into", into);
      row.dataset.dropMode = into ? "into" : "reorder";
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drop-target", "drop-into");
    });
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      const source = state.dragSource;
      const mode = row.dataset.dropMode;
      clearDrop();
      if (!source) return;
      if (mode === "into") await movePath(source.path, node.path);
      else await dropReorder(node, event);
    });

    row.append(disclosure, entry);
    els.tree.append(row);

    if (node.isDir && expanded && node.children?.length) {
      renderNodes(node.children, depth + 1, filtered);
    }
  }
}

async function dropReorder(targetNode, event) {
  const source = state.dragSource;
  if (!source) return;
  const parent = parentOf(targetNode.path);
  if (source.parent !== parent) return;

  const siblingRows = [...els.tree.querySelectorAll(".tree-row")].filter(
    (row) => row.dataset.parent === parent
  );
  const names = siblingRows.map((row) => row.dataset.name);
  const sourceIndex = names.indexOf(source.name);
  if (sourceIndex === -1) return;
  names.splice(sourceIndex, 1);
  let targetIndex = names.indexOf(targetNode.name);
  if (targetIndex === -1) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientY > rect.top + rect.height / 2) targetIndex += 1;
  names.splice(targetIndex, 0, source.name);

  try {
    await api.setSortOrder(parent, names);
    await loadTree();
    setStatus("Custom order saved.");
  } catch (error) {
    setStatus(errText(error));
  }
}

function ensureExpanded(path) {
  let parent = parentOf(path);
  while (parent) {
    state.expanded.add(parent);
    parent = parentOf(parent);
  }
}

function siblingNodes(node) {
  const parent = parentOf(node.path);
  if (!parent) return state.tree;
  return findNode(state.tree, parent)?.children ?? [];
}

async function moveNode(node, delta) {
  const parent = parentOf(node.path);
  const siblings = siblingNodes(node);
  const names = siblings.map((sibling) => sibling.name);
  const index = siblings.findIndex((sibling) => sibling.path === node.path);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= names.length) return;
  [names[index], names[next]] = [names[next], names[index]];
  try {
    await api.setSortOrder(parent, names);
    await loadTree();
    setStatus("Custom order saved.");
  } catch (error) {
    setStatus(errText(error));
  }
}

function compareNames(a, b) {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower < bLower) return -1;
  if (aLower > bLower) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

async function sortAlphabetically(parent) {
  const folder = parent ? findNode(state.tree, parent) : null;
  if (parent && !folder) {
    setStatus("That folder is no longer available.");
    return;
  }
  const names = (folder ? folder.children ?? [] : state.tree)
    .map((node) => node.name)
    .sort(compareNames);
  try {
    await api.setSortOrder(parent, names);
    await loadTree();
    setStatus("Sorted alphabetically.");
  } catch (error) {
    setStatus(errText(error));
  }
}

async function resetOrder(parent) {
  try {
    await api.setSortOrder(parent, []);
    await loadTree();
    setStatus("Custom order reset.");
  } catch (error) {
    setStatus(errText(error));
  }
}

function showContextMenu(x, y, node, source = null) {
  els.contextMenu.textContent = "";
  state.menuReturnFocus = document.activeElement;
  const add = (label, action, danger = false, disabled = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    if (danger) button.className = "danger";
    button.disabled = disabled;
    button.addEventListener("click", async () => {
      hideContextMenu();
      await action();
    });
    els.contextMenu.append(button);
  };
  const separator = () => els.contextMenu.append(document.createElement("hr"));

  if (!node) {
    add("New file…", () => createItem("", false));
    add("New folder…", () => createItem("", true));
    add("Sort alphabetically", () => sortAlphabetically(""));
    separator();
    add("Reset custom order", () => resetOrder(""));
  } else if (node.isDir) {
    add("New file…", () => createItem(node.path, false));
    add("New folder…", () => createItem(node.path, true));
    add("Sort alphabetically", () => sortAlphabetically(node.path));
    if (node.path.includes("/")) {
      add("Move to vault root", () => movePath(node.path, ""));
    }
    const siblings = siblingNodes(node);
    const index = siblings.findIndex((sibling) => sibling.path === node.path);
    add("Move up", () => moveNode(node, -1), false, index <= 0);
    add("Move down", () => moveNode(node, 1), false, index === siblings.length - 1);
    add("Reset custom order", () => resetOrder(node.path));
    separator();
    add("Delete folder…", () => deleteItem(node), true);
  } else {
    add("Open", () => openFile(node.path));
    add("Show revisions…", () => showRevisions(node.path));
    const pinned = state.pins.includes(node.path);
    if (source === "pinned") {
      add("Unpin from Pinned", () => togglePin(node.path));
    } else {
      add(pinned ? "Unpin" : "Pin", () => togglePin(node.path));
    }
    if (source === "recent") {
      add("Remove from Recent", () => removeRecent(node.path));
    }
    if (source) {
      add("Reveal in vault", () => revealInTree(node.path));
    }
    add("Edit tags…", () => editTags(node.path));
    add("Sort alphabetically", () => sortAlphabetically(parentOf(node.path)));
    if (node.path.includes("/")) {
      add("Move to vault root", () => movePath(node.path, ""));
    }
    const siblings = siblingNodes(node);
    const index = siblings.findIndex((sibling) => sibling.path === node.path);
    add("Move up", () => moveNode(node, -1), false, index <= 0);
    add("Move down", () => moveNode(node, 1), false, index === siblings.length - 1);
    add("Reset custom order", () => resetOrder(parentOf(node.path)));
    separator();
    add("Delete file…", () => deleteItem(node), true);
  }

  els.contextMenu.hidden = false;
  const rect = els.contextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, left)}px`;
  els.contextMenu.style.top = `${Math.max(8, top)}px`;
  els.contextMenu.querySelector("button")?.focus();
}

function hideContextMenu() {
  els.contextMenu.hidden = true;
  els.contextMenu.textContent = "";
  const returnFocus = state.menuReturnFocus;
  state.menuReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

function targetFolder() {
  if (!state.selected) return "";
  const node = findNode(state.tree, state.selected);
  if (!node) return "";
  return node.isDir ? node.path : parentOf(node.path);
}

async function createItem(parent, isDir) {
  if (!state.vault) return;
  ensureExpanded(parent);
  renderTree();
  let initial = "";
  let error = "";
  for (;;) {
    const name = await promptName({
      title: isDir ? "New folder" : "New file",
      copy: parent ? `Inside ${parent}` : "Inside the vault root",
      label: "Name",
      submit: isDir ? "Create folder" : "Create file",
      initial,
      error,
    });
    if (name === null) return;
    if (!name.trim()) {
      initial = name;
      error = "Enter a name.";
      continue;
    }
    try {
      const created = await api.createItem(parent, name.trim(), isDir);
      await loadTree();
      await refreshOrganization();
      ensureExpanded(created.path);
      state.selected = created.path;
      if (created.isDir) {
        state.expanded.add(created.path);
        renderTree();
        setStatus(`Created folder ${created.path}.`);
      } else {
        await openFile(created.path);
        setStatus(`Created ${created.path}.`);
      }
      return;
    } catch (backendError) {
      initial = name;
      error = errText(backendError);
    }
  }
}

async function deleteItem(node) {
  const kind = node.isDir ? "folder" : "file";
  const affectsCurrent =
    state.currentFile &&
    (state.currentFile.path === node.path ||
      state.currentFile.path.startsWith(`${node.path}/`));
  if (affectsCurrent && !(await resolvePendingChanges())) return;
  const confirmed = await confirmDialog(
    `Move the ${kind} “${node.name}” to the trash?`,
    { title: "Delete", kind: "warning" }
  );
  if (!confirmed) return;
  try {
    await api.deleteItem(node.path);
    if (affectsCurrent) {
      closeEditor();
    }
    if (state.selected === node.path) state.selected = null;
    await loadTree();
    await refreshOrganization();
    setStatus(`Moved ${node.name} to the trash.`);
  } catch (error) {
    setStatus(errText(error));
  }
}

async function togglePin(path) {
  const pinned = state.pins.includes(path);
  try {
    await api.setPin(path, !pinned);
    await refreshOrganization();
    setStatus(pinned ? `Unpinned ${basename(path)}.` : `Pinned ${basename(path)}.`);
  } catch (error) {
    setStatus(errText(error));
  }
}

async function removeRecent(path) {
  try {
    await api.removeRecent(path);
    await refreshOrganization();
    setStatus(`Removed ${basename(path)} from Recent.`);
  } catch (error) {
    setStatus(errText(error));
  }
}

function revealInTree(path) {
  const node = findNode(state.tree, path);
  if (!node) {
    setStatus("That file is no longer in the vault.");
    return;
  }
  ensureExpanded(path);
  state.selected = path;
  state.pendingTreeFocus = path;
  renderTree();
  setStatus(`Revealed ${basename(path)} in the vault tree.`);
}

function remapExpanded(oldPath, newPath) {
  const next = new Set();
  for (const path of state.expanded) {
    next.add(
      isPathWithin(path, oldPath)
        ? `${newPath}${path.slice(oldPath.length)}`
        : path
    );
  }
  state.expanded = next;
}

function remapCurrentFile(oldPath, newPath) {
  if (!state.currentFile || !isPathWithin(state.currentFile.path, oldPath)) return;
  state.currentFile.path = `${newPath}${state.currentFile.path.slice(oldPath.length)}`;
  els.filePath.textContent = state.currentFile.path;
  updateTitle();
}

async function movePath(sourcePath, targetParent) {
  if (state.saving || state.moving) return;
  if (sourcePath === targetParent || isPathWithin(targetParent, sourcePath)) {
    setStatus("A folder cannot be moved into itself.");
    return;
  }
  if (parentOf(sourcePath) === targetParent) return;
  state.moving = true;
  try {
    const newPath = await api.moveItem(sourcePath, targetParent);
    remapExpanded(sourcePath, newPath);
    remapCurrentFile(sourcePath, newPath);
    state.selected = newPath;
    await loadTree();
    ensureExpanded(newPath);
    if (findNode(state.tree, newPath)?.isDir) state.expanded.add(newPath);
    renderTree();
    await refreshOrganization();
    setStatus(`Moved ${basename(newPath)}.`);
  } catch (error) {
    setStatus(errText(error));
  } finally {
    state.moving = false;
  }
}

async function editTags(path) {
  const current = (state.tags.get(path) ?? []).join(", ");
  const value = await promptTags(current);
  if (value === null) return;
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  try {
    await api.setTags(path, tags);
    await refreshOrganization();
    setStatus(`Tags updated for ${basename(path)}.`);
  } catch (error) {
    setStatus(errText(error));
  }
}

async function showRevisions(path) {
  try {
    const revisions = await api.listRevisions(path);
    els.revisionsCopy.textContent = path;
    els.revisionsList.textContent = "";
    els.revisionsEmpty.hidden = revisions.length > 0;
    for (const revision of revisions) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const date = document.createElement("span");
      date.textContent = formatDate(revision.modifiedMs) || revision.id;
      const size = document.createElement("span");
      size.textContent = formatBytes(revision.size);
      button.append(date, size);
      button.addEventListener("click", async () => {
        const confirmed = await confirmDialog(
          `Restore the revision from ${date.textContent}? The current file is saved as a revision first.`,
          { title: "Restore revision", kind: "warning" }
        );
        if (!confirmed) return;
        if (state.currentFile?.path === path && !(await resolvePendingChanges())) {
          return;
        }
        try {
          await api.restoreRevision(path, revision.id);
          if (state.currentFile?.path === path) {
            await reloadCurrent(true);
            setNotice("Revision restored.", "info");
          } else {
            setStatus("Revision restored.");
          }
          els.revisionsDialog.close();
        } catch (error) {
          setStatus(errText(error));
        }
      });
      li.append(button);
      els.revisionsList.append(li);
    }
    els.revisionsDialog.showModal();
  } catch (error) {
    setStatus(errText(error));
  }
}

/* ------------------------------------------------------------------ */
/* Files and editor                                                    */
/* ------------------------------------------------------------------ */

function askUnsavedChanges() {
  return new Promise((resolve) => {
    const name = state.currentFile ? basename(state.currentFile.path) : "the open file";
    els.unsavedCopy.textContent = `Save changes to ${name} before continuing?`;
    els.unsavedDialog.returnValue = "";
    const onClose = () => {
      els.unsavedDialog.removeEventListener("close", onClose);
      resolve(els.unsavedDialog.returnValue || "cancel");
    };
    els.unsavedDialog.addEventListener("close", onClose);
    els.unsavedDialog.showModal();
    setTimeout(() => els.unsavedSave.focus(), 0);
  });
}

async function resolvePendingChanges() {
  if (!state.dirty) return true;
  clearAutosave();
  const choice = await askUnsavedChanges();
  if (choice === "cancel") {
    scheduleAutosave();
    return false;
  }
  if (choice === "save") {
    const saved = await saveCurrent();
    if (!saved) scheduleAutosave();
    return saved;
  }
  return true;
}

async function openFile(path, line = null) {
  if (!state.vault) return false;
  if (state.currentFile?.path === path) {
    if (line) state.editor?.openAtLine(line);
    ensureExpanded(path);
    renderTree();
    return true;
  }
  try {
    const file = await api.readFile(path);
    if (file.external) {
      state.selected = path;
      ensureExpanded(path);
      renderTree();
      await api.openExternal(path);
      await refreshOrganization();
      setStatus(`Opened ${basename(path)} in its default app.`);
      return true;
    }
    if (!(await resolvePendingChanges())) return false;
    mountFile(file, line);
    ensureExpanded(path);
    state.selected = path;
    renderTree();
    await refreshOrganization();
    return true;
  } catch (error) {
    setStatus(errText(error));
    return false;
  }
}

function mountFile(file, line = null) {
  closeEditor({ silent: true });
  state.currentFile = {
    path: file.path,
    encoding: file.encoding,
    encodingLabel: file.encodingLabel,
    eol: file.eol,
    eolLabel: file.eolLabel,
    readOnly: file.readOnly,
    size: file.size,
    modifiedMs: file.modifiedMs,
  };
  state.dirty = false;
  state.diskContent = file.content;
  els.emptyState.hidden = true;
  els.editorPane.hidden = false;
  els.fileName.textContent = file.name;
  els.filePath.textContent = file.path;
  els.fileMeta.textContent = [
    file.encodingLabel,
    file.eolLabel,
    formatBytes(file.size),
  ]
    .filter(Boolean)
    .join(" · ");
  setNotice(file.notice ?? "", file.readOnly ? "warn" : "info");
  renderFileTags();
  updateControls();
  updateTitle();

  state.editor?.destroy();
  els.editor.textContent = "";
  state.editor = createEditor({
    parent: els.editor,
    doc: file.content,
    path: file.path,
    readOnly: file.readOnly,
    wrap: state.wrap,
    tabWidth: state.settings.tabWidth,
    dark: state.dark,
    onChange: markDirty,
    onSave: saveCurrent,
    onSearch: focusSearch,
    onOpenLink: (path) => openFile(path),
    onUndo: undo,
    onRedo: redo,
  });
  if (line) state.editor.openAtLine(line);
  else state.editor.focus();
  setStatus(file.readOnly ? "Opened read-only." : "Opened.");
}

function closeEditor({ silent = false } = {}) {
  clearAutosave();
  state.autosavePaused = false;
  state.editor?.destroy();
  state.editor = null;
  state.currentFile = null;
  state.dirty = false;
  state.diskContent = null;
  els.editor.textContent = "";
  els.editorPane.hidden = true;
  els.fileTags.textContent = "";
  els.fileName.textContent = "";
  els.filePath.textContent = "";
  els.fileMeta.textContent = "";
  setNotice("");
  updateControls();
  updateTitle();
  if (!silent) setStatus("Ready.");
}

function clearAutosave() {
  if (state.autosaveTimer !== null) {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }
}

function scheduleAutosave() {
  if (state.autosavePaused || !state.dirty) return;
  if (
    state.settings.autosaveMode === "interval" &&
    state.autosaveTimer !== null
  ) {
    return;
  }
  clearAutosave();
  const mode = state.settings.autosaveMode;
  if (mode === "idle") {
    const seconds = Math.min(
      60,
      Math.max(1, Number(state.settings.autosaveIdleSecs) || 20)
    );
    state.autosaveTimer = setTimeout(runAutosave, seconds * 1000);
  } else if (mode === "interval") {
    const seconds = Math.min(
      3600,
      Math.max(120, Number(state.settings.autosaveIntervalSecs) || 120)
    );
    state.autosaveTimer = setTimeout(runAutosave, seconds * 1000);
  }
}

async function runAutosave() {
  state.autosaveTimer = null;
  if (state.autosavePaused || !state.dirty) return;
  const saved = await saveCurrent();
  if (!saved && state.dirty) scheduleAutosave();
}

function markDirty() {
  if (!state.currentFile || state.currentFile.readOnly) return;
  if (!state.dirty) {
    state.dirty = true;
    updateControls();
    updateTitle();
    setStatus("Unsaved changes.");
  }
  scheduleAutosave();
}

async function saveCurrent() {
  if (!state.currentFile) return false;
  if (state.currentFile.readOnly) {
    setStatus("This file is read-only.");
    return false;
  }
  if (state.saving) return false;
  if (
    state.editor &&
    state.diskContent !== null &&
    state.editor.getValue() === state.diskContent
  ) {
    // Nothing changed on screen, so there is nothing to write.
    state.dirty = false;
    clearAutosave();
    updateControls();
    updateTitle();
    return true;
  }
  state.saving = true;
  els.saveButton.disabled = true;
  try {
    const outcome = await api.saveFile(
      state.currentFile.path,
      state.editor?.getValue() ?? "",
      state.currentFile.encoding,
      state.currentFile.eol
    );
    state.currentFile.size = outcome.size;
    state.currentFile.modifiedMs = outcome.modifiedMs;
    state.diskContent = state.editor?.getValue() ?? "";
    state.dirty = false;
    clearAutosave();
    state.autosavePaused = false;
    els.fileMeta.textContent = [
      state.currentFile.encodingLabel,
      state.currentFile.eolLabel,
      formatBytes(outcome.size),
    ]
      .filter(Boolean)
      .join(" · ");
    updateControls();
    updateTitle();
    setStatus("Saved.");
    refreshUndoState();
    return true;
  } catch (error) {
    setNotice(errText(error), "warn");
    setStatus("The file could not be saved.");
    return false;
  } finally {
    state.saving = false;
    updateControls();
  }
}

async function reloadCurrent(silent = false) {
  if (!state.currentFile) return;
  const line = state.editor
    ? state.editor.view.state.doc.lineAt(state.editor.view.state.selection.main.head).number
    : null;
  try {
    const file = await api.readFile(state.currentFile.path);
    mountFile(file, line);
    if (!silent) setNotice("Reloaded from disk.", "info");
    await refreshOrganization();
  } catch (error) {
    if (!state.dirty && /no longer exists/i.test(errText(error))) {
      closeEditor({ silent: true });
      setStatus("The open file was removed outside Plainfold.");
      updateControls();
    } else {
      setNotice("The open file could not be reloaded from disk.", "warn");
    }
  }
}

function renderFileTags() {
  els.fileTags.textContent = "";
  if (!state.currentFile) return;
  const tags = state.tags.get(state.currentFile.path) ?? [];
  for (const tag of tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    button.textContent = tag;
    button.title = `Filter the tree by ${tag}`;
    button.addEventListener("click", () => {
      state.tagFilter = tag;
      renderTagFilter();
      renderTree();
      updateControls();
    });
    els.fileTags.append(button);
  }
}

/* ------------------------------------------------------------------ */
/* Undo and redo                                                       */
/* ------------------------------------------------------------------ */

async function refreshUndoState() {
  if (!state.vault) {
    state.undoInfo = { undoLabel: null, redoLabel: null };
    updateControls();
    return;
  }
  try {
    state.undoInfo = await api.undoState();
  } catch {
    state.undoInfo = { undoLabel: null, redoLabel: null };
  }
  updateControls();
}

/** Text as it is on disk right now, used as the redo target for an edit. */
function diskText() {
  return state.diskContent ?? "";
}

async function undo() {
  if (!state.vault || state.undoBusy) return;
  if (state.currentFile && state.dirty) {
    if (state.currentFile.readOnly) {
      setStatus("This file is read-only.");
      return;
    }
    state.undoBusy = true;
    try {
      state.editor?.replaceDoc(diskText());
      state.dirty = false;
      clearAutosave();
      state.autosavePaused = false;
      updateControls();
      updateTitle();
      setStatus("Reverted the unsaved edits.");
      await saveCurrent();
    } finally {
      state.undoBusy = false;
      updateControls();
    }
    return;
  }
  if (!state.undoInfo.undoLabel) {
    setStatus("There is nothing to undo.");
    return;
  }
  const before = state.undoInfo.undoLabel;
  const currentPath = state.currentFile?.path ?? null;
  state.undoBusy = true;
  try {
    const message = await api.undo();
    await afterUndoStep(currentPath);
    setStatus(message || `Undid ${before}.`);
  } catch (error) {
    setStatus(errText(error));
    await refreshUndoState();
  } finally {
    state.undoBusy = false;
    updateControls();
  }
}

async function redo() {
  if (!state.vault || state.undoBusy || !state.undoInfo.redoLabel) return;
  const currentPath = state.currentFile?.path ?? null;
  state.undoBusy = true;
  try {
    const message = await api.redo();
    await afterUndoStep(currentPath);
    setStatus(message);
  } catch (error) {
    setStatus(errText(error));
  } finally {
    state.undoBusy = false;
    updateControls();
  }
}

/** Bring the tree, the open editor and the organization lists back in step
 *  with the vault after a step was undone or redone. */
async function afterUndoStep(previousPath) {
  await loadTree();
  await refreshOrganization();
  await refreshUndoState();
  await syncEditorWithDisk(previousPath);
}

async function syncEditorWithDisk(previousPath) {
  if (!state.currentFile) return;
  const path = state.currentFile.path;
  const found = findNode(state.tree, path);
  if (!found) {
    // The undo may have given the item back under a different name.
    const restored =
      previousPath && findNode(state.tree, previousPath) ? previousPath : null;
    if (restored) {
      await openFile(restored);
    } else {
      closeEditor({ silent: true });
      setStatus("The open file is no longer in the vault.");
    }
    return;
  }
  if (found.isDir) return;
  try {
    const file = await api.readFile(path);
    state.diskContent = file.content;
    if (state.dirty || file.external) return;
    if ((state.editor?.getValue() ?? "") !== file.content) {
      const line = state.editor
        ? state.editor.view.state.doc.lineAt(state.editor.view.state.selection.main.head)
            .number
        : null;
      mountFile(file, line);
    }
  } catch (error) {
    setStatus(errText(error));
    return;
  }
  state.selected = path;
  ensureExpanded(path);
  renderTree();
}

function toggleWrap() {
  state.wrap = !state.wrap;
  els.wrapToggle.textContent = state.wrap ? "Wrap on" : "Wrap off";
  els.wrapToggle.setAttribute("aria-pressed", String(state.wrap));
  state.editor?.setWrap(state.wrap);
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function focusSearch() {
  els.search.focus();
  els.search.select();
}

function hideResults() {
  state.searchSequence += 1;
  els.searchResults.hidden = true;
  els.resultsList.textContent = "";
  els.resultsEmpty.hidden = true;
}

async function runSearch() {
  const query = els.search.value.trim();
  if (!query) {
    hideResults();
    return;
  }
  const sequence = ++state.searchSequence;
  try {
    const hits = await api.search(query);
    if (sequence !== state.searchSequence) return;
    renderResults(hits);
  } catch (error) {
    if (sequence !== state.searchSequence) return;
    els.resultsList.textContent = "";
    els.resultsEmpty.hidden = false;
    els.resultsEmpty.textContent = errText(error);
    els.searchResults.hidden = false;
  }
}

function renderResults(hits) {
  els.resultsList.textContent = "";
  els.resultsEmpty.hidden = hits.length > 0;
  els.resultsEmpty.textContent = "No matches.";
  for (const hit of hits) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const title = document.createElement("div");
    title.className = "result-title";
    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = basename(hit.path);
    const path = document.createElement("span");
    path.className = "result-path";
    path.textContent = hit.path;
    title.append(name, path);
    button.append(title);
    if (hit.line) {
      const line = document.createElement("div");
      line.className = "result-line";
      const number = document.createElement("span");
      number.className = "line-number";
      number.textContent = `L${hit.line}`;
      const text = document.createElement("span");
      text.textContent = hit.lineText || "";
      line.append(number, text);
      button.append(line);
    }
    button.addEventListener("click", async () => {
      const opened = await openFile(hit.path, hit.line ?? null);
      if (opened) hideResults();
    });
    li.append(button);
    els.resultsList.append(li);
  }
  els.searchResults.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function promptName({ title, copy, label, submit, initial, error }) {
  return new Promise((resolve) => {
    els.promptTitle.textContent = title;
    els.promptCopy.textContent = copy;
    els.promptLabel.textContent = label;
    els.promptSubmit.textContent = submit;
    els.promptInput.value = initial ?? "";
    els.promptError.hidden = !error;
    els.promptError.textContent = error ?? "";
    els.promptDialog.returnValue = "";
    const onClose = () => {
      els.promptDialog.removeEventListener("close", onClose);
      const accepted = els.promptDialog.returnValue === "default";
      resolve(accepted ? els.promptInput.value : null);
    };
    els.promptDialog.addEventListener("close", onClose);
    els.promptDialog.showModal();
    setTimeout(() => {
      els.promptInput.focus();
      els.promptInput.select();
    }, 0);
  });
}

function promptTags(initial) {
  return new Promise((resolve) => {
    els.tagsInput.value = initial ?? "";
    els.tagsError.hidden = true;
    els.tagsDialog.returnValue = "";
    const onClose = () => {
      els.tagsDialog.removeEventListener("close", onClose);
      resolve(els.tagsDialog.returnValue === "default" ? els.tagsInput.value : null);
    };
    els.tagsDialog.addEventListener("close", onClose);
    els.tagsDialog.showModal();
    setTimeout(() => {
      els.tagsInput.focus();
      els.tagsInput.select();
    }, 0);
  });
}

function openSettings() {
  els.settingTheme.value = state.settings.theme ?? "system";
  els.settingFontFamily.value = state.settings.fontFamily ?? "Consolas";
  // Show the size actually in use, so a manual zoom is visible here too.
  els.settingFontSize.value = String(editorFontSize());
  els.settingTabWidth.value = String(state.settings.tabWidth ?? 4);
  els.settingPinnedLimit.value = String(state.settings.pinnedLimit ?? 5);
  els.settingRecentLimit.value = String(state.settings.recentLimit ?? 5);
  els.settingAutosaveMode.value = state.settings.autosaveMode ?? "off";
  els.settingAutosaveIdle.value = String(state.settings.autosaveIdleSecs ?? 20);
  els.settingAutosaveInterval.value = String(
    state.settings.autosaveIntervalSecs ?? 120
  );
  els.settingRevisionHourly.value = String(state.settings.revisionHourly ?? 24);
  els.settingRevisionDaily.value = String(state.settings.revisionDaily ?? 7);
  els.settingRevisionWeekly.value = String(state.settings.revisionWeekly ?? 4);
  els.settingRevisionMonthly.value = String(state.settings.revisionMonthly ?? 12);
  els.settingRevisionYearly.value = String(state.settings.revisionYearly ?? 100);
  els.settingSort.value = state.settings.defaultSort ?? "name";
  state.settingsDraftVault = state.settings.defaultVault ?? null;
  els.settingDefaultVault.value = state.settingsDraftVault ?? "";
  els.settingsError.hidden = true;
  els.settingsDialog.showModal();
}

async function saveSettingsFromForm() {
  const settings = {
    theme: els.settingTheme.value,
    fontFamily: els.settingFontFamily.value.trim() || "Consolas",
    fontSize: Math.min(
      48,
      Math.max(8, Math.round(Number(els.settingFontSize.value) || 14))
    ),
    tabWidth: Math.min(
      16,
      Math.max(1, Math.round(Number(els.settingTabWidth.value) || 4))
    ),
    pinnedLimit: Math.min(
      100,
      Math.max(1, Math.round(Number(els.settingPinnedLimit.value) || 5))
    ),
    recentLimit: Math.min(
      100,
      Math.max(1, Math.round(Number(els.settingRecentLimit.value) || 5))
    ),
    autosaveMode: els.settingAutosaveMode.value,
    autosaveIdleSecs: Math.min(
      60,
      Math.max(1, Math.round(Number(els.settingAutosaveIdle.value) || 20))
    ),
    autosaveIntervalSecs: Math.min(
      3600,
      Math.max(120, Math.round(Number(els.settingAutosaveInterval.value) || 120))
    ),
    revisionHourly: Math.min(
      1000,
      Math.max(0, Math.round(Number(els.settingRevisionHourly.value) || 0))
    ),
    revisionDaily: Math.min(
      1000,
      Math.max(0, Math.round(Number(els.settingRevisionDaily.value) || 0))
    ),
    revisionWeekly: Math.min(
      1000,
      Math.max(0, Math.round(Number(els.settingRevisionWeekly.value) || 0))
    ),
    revisionMonthly: Math.min(
      1000,
      Math.max(0, Math.round(Number(els.settingRevisionMonthly.value) || 0))
    ),
    revisionYearly: Math.min(
      1000,
      Math.max(0, Math.round(Number(els.settingRevisionYearly.value) || 0))
    ),
    defaultSort: els.settingSort.value,
    defaultVault: state.settingsDraftVault,
    desktopShortcutPrompted: Boolean(state.settings.desktopShortcutPrompted),
  };
  try {
    const saved = await api.saveSettings(settings);
    els.settingsDialog.close();
    // A saved font size takes over from any manual zoom.
    state.zoom = null;
    saveZoom();
    applySettings(saved);
    await loadTree();
    setStatus("Settings saved.");
  } catch (error) {
    els.settingsError.hidden = false;
    els.settingsError.textContent = errText(error);
  }
}

async function offerDesktopShortcut() {
  let status;
  try {
    status = await api.desktopShortcutStatus();
  } catch {
    return;
  }
  if (!status.supported || status.prompted || status.exists) return;
  const create = await confirmDialog("Create a Plainfold shortcut on the Desktop?", {
    title: "Desktop shortcut",
    kind: "info",
  });
  try {
    await api.resolveDesktopShortcut(create);
    if (create) setStatus("Desktop shortcut created.");
  } catch (error) {
    setNotice(errText(error), "warn");
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function wirePaneResizer() {
  let dragging = false;
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing");
    saveSidebarWidth();
  };
  const updateFromPointer = (event) => {
    const left = els.layout.getBoundingClientRect().left;
    applySidebarWidth(event.clientX - left);
  };

  els.paneResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    els.paneResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    event.preventDefault();
  });
  els.paneResizer.addEventListener("pointermove", (event) => {
    if (dragging) updateFromPointer(event);
  });
  els.paneResizer.addEventListener("pointerup", finish);
  els.paneResizer.addEventListener("pointercancel", finish);
  els.paneResizer.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
  els.paneResizer.addEventListener("dblclick", () => {
    applySidebarWidth(SIDEBAR_DEFAULT);
    saveSidebarWidth();
  });
  els.paneResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -10 : 10;
    applySidebarWidth(state.sidebarWidth + delta);
    saveSidebarWidth();
  });
}

function wireRootDrop(element) {
  element.addEventListener("dragover", (event) => {
    if (
      !state.dragSource?.parent ||
      event.target.closest?.(".tree-row")
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("drop-root");
  });
  element.addEventListener("dragleave", (event) => {
    if (event.target === element) element.classList.remove("drop-root");
  });
  element.addEventListener("drop", async (event) => {
    if (event.target.closest?.(".tree-row")) return;
    event.preventDefault();
    const source = state.dragSource;
    element.classList.remove("drop-root");
    els.rootDropZone.hidden = true;
    if (source) await movePath(source.path, "");
  });
}

function wireEvents() {
  wirePaneResizer();
  // The editor sits inside the pane, and wheel events bubble, so one
  // listener on the pane covers the whole editing area.
  wireZoom(els.editorPane);
  els.openVault.addEventListener("click", chooseVault);
  els.emptyOpen.addEventListener("click", () => {
    if (state.vault) createItem(targetFolder(), false);
    else chooseVault();
  });

  els.rescan.addEventListener("click", async () => {
    if (!state.vault) return;
    els.rescan.disabled = true;
    setStatus("Rebuilding the search index…");
    try {
      const count = await api.rescan();
      await loadTree();
      await refreshOrganization();
      setStatus(`Rescanned ${count} file${count === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(errText(error));
    } finally {
      els.rescan.disabled = false;
    }
  });

  els.settingsButton.addEventListener("click", openSettings);
  els.chooseDefaultVault.addEventListener("click", async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose the default vault",
    });
    if (selected) {
      state.settingsDraftVault = selected;
      els.settingDefaultVault.value = selected;
    }
  });
  els.useCurrentVault.addEventListener("click", () => {
    if (!state.vault) {
      setStatus("No vault is open.");
      return;
    }
    state.settingsDraftVault = state.vault.path;
    els.settingDefaultVault.value = state.vault.path;
  });
  els.clearDefaultVault.addEventListener("click", () => {
    state.settingsDraftVault = null;
    els.settingDefaultVault.value = "";
  });

  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettingsFromForm();
  });
  els.promptCancel.addEventListener("click", () => els.promptDialog.close("cancel"));
  els.tagsCancel.addEventListener("click", () => els.tagsDialog.close("cancel"));
  els.settingsCancel.addEventListener("click", () => els.settingsDialog.close("cancel"));

  els.sortAlpha.addEventListener("click", () => sortAlphabetically(targetFolder()));
  els.newFile.addEventListener("click", () => createItem(targetFolder(), false));
  els.newFolder.addEventListener("click", () => createItem(targetFolder(), true));
  els.wrapToggle.addEventListener("click", toggleWrap);
  els.saveButton.addEventListener("click", saveCurrent);
  els.undoButton.addEventListener("click", undo);
  els.redoButton.addEventListener("click", redo);
  els.noticeClose.addEventListener("click", dismissNotice);

  els.tree.addEventListener("contextmenu", (event) => {
    if (event.target === els.tree) {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, null);
    }
  });
  els.sidebar.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, null);
  });
  els.tree.addEventListener("keydown", handleTreeKeydown);
  els.treeFilter.addEventListener("input", () => {
    state.fileFilter = els.treeFilter.value.trim();
    renderTree();
    updateControls();
  });
  els.treeFilter.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.treeFilter.value = "";
      state.fileFilter = "";
      renderTree();
      updateControls();
    }
  });
  wireRootDrop(els.tree);
  wireRootDrop(els.rootDropZone);
  wireRootDrop(els.sidebarFooter);
  wireRootDrop(els.treeEmpty);

  els.search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    const query = els.search.value.trim();
    if (!query) {
      state.searchSequence += 1;
      hideResults();
      return;
    }
    state.searchTimer = setTimeout(runSearch, 220);
  });
  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.search.value = "";
      hideResults();
      state.editor?.focus();
    } else if (event.key === "Enter") {
      clearTimeout(state.searchTimer);
      runSearch();
    } else if (event.key === "ArrowDown" && !els.searchResults.hidden) {
      const first = els.resultsList.querySelector("button");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  els.closeResults.addEventListener("click", hideResults);
  els.resultsList.addEventListener("keydown", (event) => {
    const buttons = [...els.resultsList.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(buttons.length - 1, index + 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0) focusSearch();
      else buttons[index - 1].focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideResults();
      focusSearch();
    }
  });

  window.addEventListener("click", (event) => {
    if (!els.contextMenu.hidden && !els.contextMenu.contains(event.target)) {
      hideContextMenu();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (!els.contextMenu.hidden) {
      const items = [
        ...els.contextMenu.querySelectorAll("button:not(:disabled)"),
      ];
      const index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[Math.min(items.length - 1, index + 1)]?.focus();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        items[Math.max(0, index - 1)]?.focus();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideContextMenu();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusSearch();
    } else if (event.key === "Escape") {
      hideContextMenu();
      if (!els.searchResults.hidden) hideResults();
      else dismissNotice();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      if (state.currentFile) {
        event.preventDefault();
        saveCurrent();
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      // The editor handles its own history first and only lets this run once
      // that history is empty, so vault steps are undone from anywhere.
      const typing =
        els.treeFilter === document.activeElement ||
        els.search === document.activeElement ||
        els.promptInput === document.activeElement ||
        els.tagsInput === document.activeElement;
      if (typing) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      const typing =
        els.treeFilter === document.activeElement ||
        els.search === document.activeElement;
      if (typing) return;
      event.preventDefault();
      redo();
    } else if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      // Screen readers and browsers use Ctrl+0 for "actual size" too.
      event.preventDefault();
      resetZoom();
    }
  });
  window.addEventListener("resize", hideContextMenu);
  els.tree.addEventListener("scroll", hideContextMenu, true);

  const appWindow = getCurrentWindow();
  appWindow
    .onCloseRequested(async (event) => {
      if (!(await resolvePendingChanges())) {
        event.preventDefault();
        return;
      }
      try {
        await appWindow.destroy();
      } catch {
        event.preventDefault();
      }
    })
    .catch(() => {});

  listen("vault-changed", async (event) => {
    if (!state.vault) return;
    const paths = event.payload?.paths ?? [];
    await loadTree();
    await refreshOrganization();
    if (state.moving || !state.currentFile) return;
    const current = state.currentFile.path;
    const affected = paths.some(
      (path) => path === current || current.startsWith(`${path}/`)
    );
    if (!affected) return;

    // Watchers report metadata touches (sync clients, backup tools, editors
    // that rewrite on read) as changes. Compare the text on disk before
    // saying anything, so only a real edit counts.
    const onDisk = await readDiskText(current);
    if (!contentChangedSince(onDisk, state.diskContent)) {
      // Nothing actually changed. Unsaved edits are no longer at risk of
      // being overwritten, so autosave can resume.
      if (state.dirty && state.autosavePaused) {
        state.autosavePaused = false;
        scheduleAutosave();
      }
      return;
    }

    if (state.dirty) {
      // Pausing again is idempotent; only warn when the message is not
      // already on screen, so a dismissed warning stays dismissed.
      state.autosavePaused = true;
      clearAutosave();
      const warning =
        "This file changed on disk. Your unsaved edits are kept; save when ready.";
      if (els.notice.hidden || els.noticeText.textContent !== warning) {
        setNotice(warning, "warn");
      }
    } else {
      await reloadCurrent(true);
      setNotice("This file changed on disk and was reloaded.", "info");
    }
  }).catch(() => {});
}

/** Text currently on disk, or null when it cannot be read or is not text. */
async function readDiskText(path) {
  try {
    const file = await api.readFile(path);
    if (file.external) return null;
    return file.content;
  } catch {
    return null;
  }
}

async function init() {
  wireEvents();
  state.zoom = loadZoom();
  applyTheme();
  applySidebarWidth(loadSidebarWidth());
  updateControls();
  try {
    const snapshot = await api.bootstrap();
    applySnapshot(snapshot);
    await refreshOrganization();
    if (snapshot.notices?.length) {
      handleNotices(snapshot.notices);
    }
    await offerDesktopShortcut();
  } catch (error) {
    setStatus(errText(error));
  }
}

init();
