import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";

import { api } from "./api.js";
import { createEditor } from "./editor.js";
import {
  basename,
  countFiles,
  filterTree,
  findNode,
  flattenTree,
  formatBytes,
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
  rescan: $("rescan"),
  settingsButton: $("settings-button"),
  pinnedList: $("pinned-list"),
  recentList: $("recent-list"),
  tree: $("tree"),
  treeEmpty: $("tree-empty"),
  tagFilter: $("tag-filter"),
  newFile: $("new-file"),
  newFolder: $("new-folder"),
  vaultName: $("vault-name"),
  workspace: document.querySelector(".workspace"),
  editorPane: $("editor-pane"),
  fileName: $("file-name"),
  filePath: $("file-path"),
  fileMeta: $("file-meta"),
  fileTags: $("file-tags"),
  wrapToggle: $("wrap-toggle"),
  saveButton: $("save-button"),
  editor: $("editor"),
  notice: $("notice"),
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
  settingsDialog: $("settings-dialog"),
  settingsForm: $("settings-form"),
  settingTheme: $("setting-theme"),
  settingFontFamily: $("setting-font-family"),
  settingFontSize: $("setting-font-size"),
  settingTabWidth: $("setting-tab-width"),
  settingSort: $("setting-sort"),
  settingDefaultVault: $("setting-default-vault"),
  chooseDefaultVault: $("choose-default-vault"),
  useCurrentVault: $("use-current-vault"),
  clearDefaultVault: $("clear-default-vault"),
  settingsError: $("settings-error"),
  settingsCancel: $("settings-cancel"),
};

const DEFAULT_SETTINGS = {
  theme: "system",
  fontFamily: "Consolas",
  fontSize: 14,
  defaultSort: "name",
  defaultVault: null,
  tabWidth: 4,
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
  searchTimer: null,
  searchSequence: 0,
  dragSource: null,
  settingsDraftVault: null,
  dark: false,
  saving: false,
  menuReturnFocus: null,
  pendingTreeFocus: null,
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
    els.notice.textContent = "";
    return;
  }
  els.notice.textContent = text;
  els.notice.className = kind === "info" ? "notice info" : "notice";
  els.notice.hidden = false;
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
  document.documentElement.style.setProperty(
    "--editor-size",
    `${Math.min(Math.max(Number(state.settings.fontSize) || 14, 8), 48)}px`
  );
  state.editor?.setTheme(dark);
}

function applySettings(next) {
  state.settings = { ...DEFAULT_SETTINGS, ...next };
  applyTheme();
  state.editor?.setTabWidth(state.settings.tabWidth);
  renderTree();
}

function updateControls() {
  const hasVault = Boolean(state.vault);
  const hasFile = Boolean(state.currentFile);
  els.search.disabled = !hasVault;
  els.rescan.disabled = !hasVault;
  els.newFile.disabled = !hasVault;
  els.newFolder.disabled = !hasVault;
  els.wrapToggle.disabled = !hasFile;
  els.saveButton.disabled = !hasFile || state.currentFile?.readOnly || !state.dirty;
  els.saveButton.title = state.currentFile?.readOnly ? "This file is read-only" : "Save (Ctrl+S)";
  const hasCustomOrder = state.tagFilter !== null;
  els.tree.classList.toggle("filtered", hasCustomOrder);
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
  if (!(await canDiscardChanges())) return;
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
  hideResults();
  state.settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
  state.vault = snapshot.vault;
  state.tree = snapshot.tree ?? [];
  state.expanded = new Set();
  state.selected = null;
  state.tagFilter = null;
  state.tags = new Map();
  state.tagCounts = [];
  state.pins = [];
  state.recents = [];
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
  renderShortList(els.pinnedList, state.pins, "Nothing pinned.");
  renderShortList(els.recentList, state.recents.slice(0, 20), "No recent files.");
}

function renderShortList(element, paths, emptyText) {
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
      showContextMenu(event.clientX, event.clientY, node);
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
  if (!state.tagFilter) return state.tree;
  const needle = state.tagFilter.toLowerCase();
  const matching = new Set();
  for (const [path, tags] of state.tags) {
    if (tags.some((tag) => tag.toLowerCase() === needle)) matching.add(path);
  }
  return filterTree(state.tree, matching);
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
    : "This vault is empty.";
  const filtered = Boolean(state.tagFilter);
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
    row.dataset.path = node.path;
    row.dataset.parent = parentOf(node.path);
    row.dataset.isDir = node.isDir ? "true" : "false";
    row.dataset.name = node.name;
    row.style.paddingLeft = `${depth * 14}px`;
    if (state.selected === node.path) row.classList.add("selected");
    row.draggable = !filtered;

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "tree-disclosure";
    disclosure.setAttribute("aria-hidden", "true");
    const expanded = filtered || state.expanded.has(node.path);
    if (node.isDir) {
      disclosure.textContent = expanded ? "▾" : "▸";
      disclosure.setAttribute(
        "aria-label",
        expanded ? `Collapse ${node.name}` : `Expand ${node.name}`
      );
      disclosure.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.expanded.has(node.path)) state.expanded.delete(node.path);
        else state.expanded.add(node.path);
        state.pendingTreeFocus = node.path;
        renderTree();
      });
    } else {
      disclosure.classList.add("leaf");
      disclosure.tabIndex = -1;
    }
    disclosure.tabIndex = -1;

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
      if (filtered) {
        event.preventDefault();
        return;
      }
      state.dragSource = {
        path: node.path,
        parent: parentOf(node.path),
        name: node.name,
      };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.path);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      state.dragSource = null;
      row.classList.remove("dragging");
      els.tree.querySelectorAll(".drop-target").forEach((element) => {
        element.classList.remove("drop-target");
      });
    });
    row.addEventListener("dragover", (event) => {
      const source = state.dragSource;
      if (!source || source.parent !== parentOf(node.path) || source.path === node.path) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drop-target");
      await dropReorder(node, event);
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

async function resetOrder(parent) {
  try {
    await api.setSortOrder(parent, []);
    await loadTree();
    setStatus("Custom order reset.");
  } catch (error) {
    setStatus(errText(error));
  }
}

function showContextMenu(x, y, node) {
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
    separator();
    add("Reset custom order", () => resetOrder(""));
  } else if (node.isDir) {
    add("New file…", () => createItem(node.path, false));
    add("New folder…", () => createItem(node.path, true));
    const siblings = siblingNodes(node);
    const index = siblings.findIndex((sibling) => sibling.path === node.path);
    add("Move up", () => moveNode(node, -1), false, index <= 0);
    add("Move down", () => moveNode(node, 1), false, index === siblings.length - 1);
    add("Reset custom order", () => resetOrder(node.path));
    separator();
    add("Delete folder…", () => deleteItem(node), true);
  } else {
    add("Open", () => openFile(node.path));
    const pinned = state.pins.includes(node.path);
    add(pinned ? "Unpin" : "Pin", () => togglePin(node.path));
    add("Edit tags…", () => editTags(node.path));
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
  if (affectsCurrent && state.dirty && !(await canDiscardChanges())) return;
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

/* ------------------------------------------------------------------ */
/* Files and editor                                                    */
/* ------------------------------------------------------------------ */

async function canDiscardChanges() {
  if (!state.dirty) return true;
  return confirmDialog("Discard unsaved changes in the open file?", {
    title: "Unsaved changes",
    kind: "warning",
  });
}

async function openFile(path, line = null) {
  if (!state.vault) return false;
  if (state.currentFile?.path === path) {
    if (line) state.editor?.openAtLine(line);
    ensureExpanded(path);
    renderTree();
    return true;
  }
  if (!(await canDiscardChanges())) return false;
  try {
    const file = await api.readFile(path);
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
  });
  if (line) state.editor.openAtLine(line);
  else state.editor.focus();
  setStatus(file.readOnly ? "Opened read-only." : "Opened.");
}

function closeEditor({ silent = false } = {}) {
  state.editor?.destroy();
  state.editor = null;
  state.currentFile = null;
  state.dirty = false;
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

function markDirty() {
  if (!state.currentFile || state.currentFile.readOnly) return;
  if (!state.dirty) {
    state.dirty = true;
    updateControls();
    updateTitle();
    setStatus("Unsaved changes.");
  }
}

async function saveCurrent() {
  if (!state.currentFile) return;
  if (state.currentFile.readOnly) {
    setStatus("This file is read-only.");
    return;
  }
  if (state.saving) return;
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
    state.dirty = false;
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
  } catch (error) {
    setNotice(errText(error), "warn");
    setStatus("The file could not be saved.");
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
  els.settingFontSize.value = String(state.settings.fontSize ?? 14);
  els.settingTabWidth.value = String(state.settings.tabWidth ?? 4);
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
    defaultSort: els.settingSort.value,
    defaultVault: state.settingsDraftVault,
  };
  try {
    const saved = await api.saveSettings(settings);
    els.settingsDialog.close();
    applySettings(saved);
    await loadTree();
    setStatus("Settings saved.");
  } catch (error) {
    els.settingsError.hidden = false;
    els.settingsError.textContent = errText(error);
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function wireEvents() {
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

  els.newFile.addEventListener("click", () => createItem(targetFolder(), false));
  els.newFolder.addEventListener("click", () => createItem(targetFolder(), true));
  els.wrapToggle.addEventListener("click", toggleWrap);
  els.saveButton.addEventListener("click", saveCurrent);

  els.tree.addEventListener("contextmenu", (event) => {
    if (event.target === els.tree) {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, null);
    }
  });
  els.tree.addEventListener("keydown", handleTreeKeydown);

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
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      if (state.currentFile) {
        event.preventDefault();
        saveCurrent();
      }
    }
  });
  window.addEventListener("resize", hideContextMenu);
  els.tree.addEventListener("scroll", hideContextMenu, true);

  const appWindow = getCurrentWindow();
  appWindow
    .onCloseRequested(async (event) => {
      if (state.dirty) {
        const discard = await confirmDialog(
          "Discard unsaved changes and close Plainfold?",
          { title: "Unsaved changes", kind: "warning" }
        );
        if (!discard) {
          event.preventDefault();
          return;
        }
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
    if (!state.currentFile) return;
    const current = state.currentFile.path;
    const affected = paths.some(
      (path) => path === current || current.startsWith(`${path}/`)
    );
    if (!affected) return;
    if (state.dirty) {
      setNotice(
        "This file changed on disk. Your unsaved edits are kept; save when ready.",
        "warn"
      );
    } else {
      await reloadCurrent(true);
      setNotice("This file changed on disk and was reloaded.", "info");
    }
  }).catch(() => {});
}

async function init() {
  wireEvents();
  applyTheme();
  updateControls();
  try {
    const snapshot = await api.bootstrap();
    applySnapshot(snapshot);
    await refreshOrganization();
    if (snapshot.notices?.length) {
      handleNotices(snapshot.notices);
    }
  } catch (error) {
    setStatus(errText(error));
  }
}

init();
