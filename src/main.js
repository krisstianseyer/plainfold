import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";

import { api } from "./api.js";
import { createEditor } from "./editor.js";
import {
  FEATURE_CATEGORIES,
  FEATURE_CATEGORY_ORDER,
  FEATURE_GROUPS,
  controlsForGroup,
  featureEnabled,
  groupOf,
} from "./features.js";
import {
  configureRepositories,
  limitRepositoryEntries,
  normalizeRepositoryEntries,
  reconcileRepositoryEntries,
  repositories,
  repositoryEntryIsActive,
} from "./repositories.js";
import {
  UPDATE_OWNER,
  UPDATE_REPO,
  checkForUpdate,
  dismissUpdate,
  isAllowedReleaseUrl,
  isUpdateDismissed,
  maybeCheckForUpdate,
  readLastChecked,
  updateInactiveStatus,
  updateSourceConfigured,
  updateSourceLabel,
} from "./updater.js";
import {
  basename,
  contentChangedSince,
  countFiles,
  countFolders,
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
  openRepository: $("open-repository"),
  emptyOpen: $("empty-open"),
  emptyState: $("empty-state"),
  emptyTitle: document.querySelector("#empty-state h1"),
  emptyCopy: document.querySelector("#empty-state p"),
  search: $("search"),
  undoButton: $("undo-button"),
  redoButton: $("redo-button"),
  settingsButton: $("settings-button"),
  pinnedList: $("pinned-list"),
  recentList: $("recent-list"),
  repositoryList: $("repository-list"),
  welcomeRepositories: $("welcome-repositories"),
  updateBanner: $("update-banner"),
  updateBannerText: $("update-banner-text"),
  updateBannerNotes: $("update-banner-notes"),
  updateBannerDismiss: $("update-banner-dismiss"),
  tree: $("tree"),
  treeFilter: $("tree-filter"),
  treeEmpty: $("tree-empty"),
  rootDropZone: $("root-drop-zone"),
  sidebarFooter: document.querySelector(".sidebar-footer"),
  tagFilter: $("tag-filter"),
  sortAlpha: $("sort-alpha"),
  newFile: $("new-file"),
  newFolder: $("new-folder"),
  repositoryLabel: $("repository-label"),
  brandButton: $("brand-button"),
  brandPopover: $("brand-popover"),
  repoLink: $("repo-link"),
  windowMinimize: $("window-minimize"),
  windowMaximize: $("window-maximize"),
  windowClose: $("window-close"),
  statusMessage: $("status-message"),
  layout: document.querySelector(".layout"),
  paneResizer: $("pane-resizer"),
  workspace: document.querySelector(".workspace"),
  sidebar: document.querySelector(".sidebar"),
  editorPane: $("editor-pane"),
  fileName: $("file-name"),
  filePathTip: $("file-path-tip"),
  fileTags: $("file-tags"),
  wrapToggle: $("wrap-toggle"),
  saveButton: $("save-button"),
  closeFile: $("close-file"),
  repoLoading: $("repo-loading"),
  repoLoadingTitle: $("repo-loading-title"),
  repoLoadingCopy: $("repo-loading-copy"),
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
  limitDialog: $("limit-dialog"),
  limitForm: $("limit-form"),
  limitTitle: $("limit-title"),
  limitCopy: $("limit-copy"),
  limitInput: $("limit-input"),
  limitError: $("limit-error"),
  limitSubmit: $("limit-submit"),
  limitCancel: $("limit-cancel"),
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
  propertiesDialog: $("properties-dialog"),
  propertiesList: $("properties-list"),
  settingsDialog: $("settings-dialog"),
  settingsSearch: $("settings-search"),
  settingsClose: $("settings-close"),
  settingsSaved: $("settings-saved"),
  settingsNoMatch: $("settings-no-match"),
  settingTheme: $("setting-theme"),
  settingFontFamily: $("setting-font-family"),
  settingFontSize: $("setting-font-size"),
  settingTabWidth: $("setting-tab-width"),
  settingPinnedLimit: $("setting-pinned-limit"),
  settingRecentLimit: $("setting-recent-limit"),
  pinnedTitle: $("pinned-title"),
  recentTitle: $("recent-title"),
  settingAutosaveMode: $("setting-autosave-mode"),
  settingAutosaveIdle: $("setting-autosave-idle"),
  settingAutosaveInterval: $("setting-autosave-interval"),
  settingRevisionHourly: $("setting-revision-hourly"),
  settingRevisionDaily: $("setting-revision-daily"),
  settingRevisionWeekly: $("setting-revision-weekly"),
  settingRevisionMonthly: $("setting-revision-monthly"),
  settingRevisionYearly: $("setting-revision-yearly"),
  settingSort: $("setting-sort"),
  settingDefaultRepository: $("setting-default-repository"),
  settingRecentRepositoryLimit: $("setting-recent-repository-limit"),
  chooseDefaultRepository: $("choose-default-repository"),
  useCurrentRepository: $("use-current-repository"),
  clearDefaultRepository: $("clear-default-repository"),
  settingsRepositoriesList: $("settings-repositories-list"),
  settingUpdateStatus: $("setting-update-status"),
  settingUpdateSource: $("setting-update-source"),
  settingUpdateVersions: $("setting-update-versions"),
  settingUpdateLastChecked: $("setting-update-last-checked"),
  settingUpdateCheck: $("setting-update-check"),
  settingsUpdateAutocheck: $("settings-update-autocheck"),
  settingsFeatures: $("settings-features"),
  settingsSearchInfo: $("settings-search-info"),
  settingsSearchFeatureState: $("settings-search-feature-state"),
  settingsZoomValue: $("settings-zoom-value"),
  resetEditorZoom: $("reset-editor-zoom"),
  searchRescan: $("search-rescan"),
  maintenanceRescan: $("maintenance-rescan"),
  maintenanceClearRecents: $("maintenance-clear-recents"),
  maintenanceResetAll: $("maintenance-reset-all"),
  settingsAboutVersion: $("settings-about-version"),
  settingsAboutSource: $("settings-about-source"),
  settingsAboutGithub: $("settings-about-github"),
  settingsError: $("settings-error"),
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
  defaultRepository: null,
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
  disabledFeatures: [],
  recentRepositories: [],
  lastRepository: null,
  recentRepositoryLimit: 8,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  // Last settings known to be written to disk, used by small popups that save
  // one value without going through the Settings dialog.
  savedSettings: { ...DEFAULT_SETTINGS },
  // Rich saved-repository entries ({ path, name, exists }) for rendering.
  // state.settings.recentRepositories stays the server-managed path list.
  recentRepositoryEntries: [],
  repository: null,
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
  settingsDraftRepository: null,
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
  statusTimer: null,
  undoInfo: { undoLabel: null, redoLabel: null },
  undoBusy: false,
  version: "",
  // Settings dialog state: a draft feature list, debounced auto-save, and
  // which panel/search is showing.
  settingsDraftFeatures: new Set(),
  settingsSaveTimer: null,
  settingsSaveChain: Promise.resolve(),
  settingsDirty: false,
  settingsRevision: 0,
  settingsSaveFailed: false,
  settingsClosing: false,
  settingsSection: "appearance",
  settingsQuery: "",
  expandedFeatureGroups: new Set(),
  savedIndicatorTimer: null,
  searchIndexMessage: "",
  updateInfo: {
    currentVersion: "",
    latestVersion: null,
    lastChecked: null,
    checking: false,
    releaseUrl: null,
    status: "",
  },
};

const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => {
  if ((state.settings.theme ?? "system") === "system") applyTheme();
});

/**
 * True when a feature group or advanced control is enabled. Unknown ids and
 * missing settings are treated as enabled.
 */
function featureOn(id) {
  return featureEnabled(id, state.settings.disabledFeatures);
}

/**
 * Hide every element declared with data-feature and block the corresponding
 * UI. Multiple ids may be space-separated; all of them must be enabled.
 * Data stored by disabled features (tags, pins, recents, revisions) is left
 * untouched.
 */
function applyFeatureVisibility() {
  const disabled = state.settings.disabledFeatures;
  for (const element of document.querySelectorAll("[data-feature]")) {
    const ids = String(element.dataset.feature ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const visible = ids.every((id) => featureEnabled(id, disabled));
    element.classList.toggle("feature-off", !visible);
    if (!visible && element === document.activeElement) {
      element.blur?.();
    }
  }
  if (!featureOn("search") || !featureOn("search.results")) hideResults();
  if (!featureOn("about") || !featureOn("about.brand")) hideBrandPopover();
  state.editor?.setSyntaxHighlighting?.(featureOn("syntaxHighlighting.editor"));
  if (!featureOn("autosave") || !featureOn("autosave.engine")) clearAutosave();
  updateStatusLeft();
  if (state.currentFile) {
    updateFileStats(state.editor?.getValue() ?? "", state.currentFile.size);
  } else {
    els.statusRight.textContent = "";
  }
  updateControls();
  if (els.settingsDialog?.open) {
    const panels = settingsPanels();
    const active = panels.find(
      (panel) => panel.dataset.settingsPanel === state.settingsSection
    );
    if (active?.classList.contains("feature-off")) {
      const fallback = panels.find(
        (panel) => !panel.classList.contains("feature-off")
      );
      if (fallback) activateSettingsSection(fallback.dataset.settingsPanel);
    }
    updateSettingsPanelVisibility();
  }
}

function errText(error) {
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  return "The operation could not be completed.";
}

/** Errors flash in the centre of the status bar, then clear. */
function setStatus(text) {
  els.statusMessage.textContent = text ?? "";
  els.statusMessage.hidden = !text;
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    els.statusMessage.hidden = true;
  }, 4000);
}

/**
 * Repository loading can take a moment on large folders, so a popup covers
 * the workspace while the backend scans. The browser only paints when the
 * main thread is idle, hence the yield before each backend call below.
 */
function showRepositoryLoading(label, copy = "") {
  els.repoLoadingTitle.textContent = label;
  els.repoLoadingCopy.textContent = copy;
  els.repoLoadingCopy.hidden = !copy;
  els.repoLoading.hidden = false;
  document.body.classList.add("repository-loading");
}

function hideRepositoryLoading() {
  els.repoLoading.hidden = true;
  document.body.classList.remove("repository-loading");
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/** Folders and files in the whole repository, shown at the bottom left. */
function updateStatusLeft() {
  if (!featureOn("repositoryCounts") || !featureOn("repositoryCounts.statusCounts")) {
    els.statusLeft.textContent = "";
    return;
  }
  if (!state.repository) {
    els.statusLeft.textContent = "";
    return;
  }
  const folders = countFolders(state.tree);
  const files = countFiles(state.tree);
  els.statusLeft.textContent = `${formatCount(folders)} folder${folders === 1 ? "" : "s"} · ${formatCount(files)} file${files === 1 ? "" : "s"}`;
}

/** Words, characters, and size of the open file, shown at the bottom right. */
function updateFileStats(content, size) {
  if (!featureOn("editorStats") || !featureOn("editorStats.statusWords")) {
    els.statusRight.textContent = "";
    return;
  }
  els.statusRight.textContent = statsText(content, size);
}

function countWords(text) {
  // Same rule as the word count most editors use: runs of non-whitespace.
  let count = 0;
  const re = /\S+/g;
  while (re.exec(text)) count += 1;
  return count;
}

function formatCount(value) {
  return value.toLocaleString();
}

function statsText(content, size) {
  const file = state.currentFile;
  if (!file) return "";
  const text = content ?? "";
  const words = countWords(text);
  const chars = text.replace(/\s/g, "").length;
  return [
    `${formatCount(words)} word${words === 1 ? "" : "s"}`,
    `${formatCount(chars)} char${chars === 1 ? "" : "s"}`,
    formatBytes(size ?? file.size ?? 0),
  ].join(" · ");
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
    document.title = `${state.currentFile.name} — Plainfold`;
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

/** Every theme the settings list offers. Only `system` follows the OS. */
const THEMES = {
  light: { dark: false },
  dark: { dark: true },
  sepia: { dark: false },
  nord: { dark: true },
  "solarized-light": { dark: false },
  "solarized-dark": { dark: true },
  midnight: { dark: true },
  forest: { dark: true },
};

function themeName() {
  const setting = state.settings.theme ?? "system";
  if (setting === "system") return media.matches ? "dark" : "light";
  return THEMES[setting] ? setting : media.matches ? "dark" : "light";
}

function applyTheme() {
  const theme = themeName();
  const dark = THEMES[theme]?.dark ?? false;
  state.dark = dark;
  document.documentElement.dataset.theme = theme;
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
  if (!featureOn("zoom") || !featureOn("zoom.resetShortcut")) return;
  if (state.zoom === null) return;
  state.zoom = null;
  applyZoom();
  saveZoom();
  setStatus("Zoom reset to the size set in Settings.");
  refreshSettingsDynamic();
}

/** Zoom by whole steps, keeping the caret visible. */
function zoomBy(delta) {
  if (!featureOn("zoom") || !featureOn("zoom.wheel")) return;
  const next = clampZoom(editorFontSize() + delta * ZOOM_STEP);
  if (next === editorFontSize()) return;
  state.zoom = next;
  applyZoom();
  saveZoom();
  setStatus(`Zoom ${next}px. Ctrl+wheel to change, Ctrl+0 to reset.`);
  refreshSettingsDynamic();
}

/** Ctrl+wheel is the familiar Notepad gesture. Only the editor reacts; the
 *  rest of the window keeps its normal scrolling. */
function wireZoom(element) {
  element.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!featureOn("zoom") || !featureOn("zoom.wheel")) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false }
  );
}

function applySettings(next) {
  state.settings = { ...DEFAULT_SETTINGS, ...next };
  state.settings.disabledFeatures = Array.isArray(state.settings.disabledFeatures)
    ? [...state.settings.disabledFeatures]
    : [];
  state.settings.recentRepositories = Array.isArray(state.settings.recentRepositories)
    ? [...state.settings.recentRepositories]
    : [];
  state.recentRepositoryEntries = reconcileRepositoryEntries(
    state.recentRepositoryEntries,
    state.settings.recentRepositories
  );
  state.settingsDraftFeatures = new Set(state.settings.disabledFeatures);
  applyTheme();
  state.editor?.setTabWidth(state.settings.tabWidth);
  clearAutosave();
  scheduleAutosave();
  applyFeatureVisibility();
  renderShortLists();
  renderTree();
  renderRepositorySkeletons();
  refreshSettingsDynamic();
  syncFeatureSwitches();
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
  const hasRepository = Boolean(state.repository);
  const hasFile = Boolean(state.currentFile);
  els.search.disabled =
    !hasRepository || !featureOn("search") || !featureOn("search.toolbar");
  const undoLabel = state.undoInfo.undoLabel;
  els.undoButton.disabled =
    !hasRepository ||
    state.undoBusy ||
    !featureOn("repositoryUndo") ||
    !featureOn("repositoryUndo.buttons");
  els.undoButton.title = undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo";
  const redoLabel = state.undoInfo.redoLabel;
  els.redoButton.disabled =
    !hasRepository ||
    state.undoBusy ||
    !featureOn("repositoryUndo") ||
    !featureOn("repositoryUndo.buttons");
  els.redoButton.title = redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : "Nothing to redo";
  els.treeFilter.disabled =
    !hasRepository || !featureOn("treeFilter") || !featureOn("treeFilter.input");
  els.sortAlpha.disabled =
    !hasRepository || !featureOn("sortAndOrder") || !featureOn("sortAndOrder.sortButton");
  els.newFile.disabled =
    !hasRepository || !featureOn("createDelete") || !featureOn("createDelete.newFile");
  els.newFolder.disabled =
    !hasRepository || !featureOn("createDelete") || !featureOn("createDelete.newFolder");
  els.wrapToggle.disabled =
    !hasFile || !featureOn("wrap") || !featureOn("wrap.toggle");
  els.saveButton.disabled = !hasFile || state.currentFile?.readOnly || !state.dirty;
  els.saveButton.title = state.currentFile?.readOnly ? "This file is read-only" : "Save (Ctrl+S)";
  els.closeFile.hidden = !hasFile;
  if (els.maintenanceRescan) {
    els.maintenanceRescan.disabled = !hasRepository;
  }
  if (els.searchRescan) {
    els.searchRescan.disabled = !hasRepository;
  }
  const filtered = Boolean(state.tagFilter || state.fileFilter);
  els.tree.classList.toggle("filtered", filtered);
  if (!hasRepository) {
    els.emptyState.hidden = false;
    els.editorPane.hidden = true;
    els.emptyTitle.textContent = "Plain text, plain files.";
    els.emptyCopy.textContent =
      "Open a folder as your repository. Every note stays a real file on disk, in the encoding and line endings it already uses.";
    els.emptyOpen.textContent = "Open a folder";
  } else if (!hasFile) {
    els.emptyState.hidden = false;
    els.editorPane.hidden = true;
    els.emptyTitle.textContent = "Choose a file.";
    els.emptyCopy.textContent =
      "Select a file in the repository, or create one. Files are opened as plain text, never rendered.";
    els.emptyOpen.textContent = "New file";
  }
}

function handleNotices(notices) {
  if (!notices?.length) return;
  setStatus(notices.join(" "));
  if (state.currentFile) setNotice(notices.join(" "), "info");
}

/* ------------------------------------------------------------------ */
/* Repository and tree                                                 */
/* ------------------------------------------------------------------ */

async function chooseRepository() {
  try {
    if (!(await resolvePendingChanges())) return;
  } catch (error) {
    setStatus(errText(error));
    setNotice(errText(error), "warn");
    return;
  }
  let selected;
  try {
    selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open a repository folder",
    });
  } catch (error) {
    setStatus(errText(error));
    setNotice(errText(error), "warn");
    return;
  }
  if (!selected) return;
  // The unsaved-changes question was already answered before the folder
  // picker, so do not ask a second time.
  await activateRepository(selected, { checkPending: false });
}

async function activateRepository(path, { checkPending = true } = {}) {
  if (checkPending) {
    try {
      // Switching repositories discards the open editor, so use the same
      // unsaved-changes question as opening a file or closing the app.
      if (!(await resolvePendingChanges())) return false;
    } catch (error) {
      setStatus(errText(error));
      setNotice(errText(error), "warn");
      return false;
    }
  }
  try {
    setStatus("Opening repository…");
    showRepositoryLoading(`Opening ${repositoryName(path)}`, "Reading the folder and its files.");
    await nextFrame();
    const snapshot = await api.openRepository(path);
    applySnapshot(snapshot);
    await refreshOrganization();
    handleNotices(snapshot.notices);
    setStatus(state.repository ? `Opened ${state.repository.name}.` : "Ready");
    return true;
  } catch (error) {
    setStatus(errText(error));
    setNotice(errText(error), "warn");
    return false;
  } finally {
    hideRepositoryLoading();
  }
}

/** Last path segment of a folder, for the loading popup title. */
function repositoryName(path) {
  const parts = String(path ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? String(path ?? "");
}

function applySnapshot(snapshot) {
  closeEditor({ silent: true });
  els.search.value = "";
  els.treeFilter.value = "";
  hideResults();
  state.settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
  // Snapshot-level repository data is server-managed and may be present even
  // when an older backend omits it from settings. Keep the rich entries for
  // rendering, but mirror only their paths into settings for persistence.
  state.settings.disabledFeatures = Array.isArray(state.settings.disabledFeatures)
    ? [...state.settings.disabledFeatures]
    : [];
  state.settings.recentRepositories = Array.isArray(state.settings.recentRepositories)
    ? [...state.settings.recentRepositories]
    : [];
  if (Array.isArray(snapshot.recentRepositories)) {
    state.recentRepositoryEntries = normalizeRepositoryEntries(
      snapshot.recentRepositories
    );
    state.settings.recentRepositories = state.recentRepositoryEntries.map(
      (entry) => entry.path
    );
  } else {
    state.recentRepositoryEntries = reconcileRepositoryEntries(
      state.recentRepositoryEntries,
      state.settings.recentRepositories
    );
  }
  if (snapshot.lastRepository !== undefined) {
    state.settings.lastRepository = snapshot.lastRepository;
  }
  state.savedSettings = { ...state.settings };
  state.settingsDraftFeatures = new Set(state.settings.disabledFeatures);
  state.searchIndexMessage = "";
  state.version = snapshot.version ?? "";
  els.appVersion.textContent = snapshot.version ? `v${snapshot.version}` : "";
  if (els.settingsAboutVersion) {
    els.settingsAboutVersion.textContent = snapshot.version
      ? `Plainfold v${snapshot.version}`
      : "Plainfold";
  }
  state.repository = snapshot.repository;
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
  els.repositoryLabel.textContent = state.repository ? state.repository.name : "Repository";
  const repositoryPath = state.repository ? state.repository.path : "";
  els.repositoryLabel.title = repositoryPath;
  els.repositoryLabel.style.cursor = repositoryPath ? "help" : "";
  applyFeatureVisibility();
  renderTree();
  renderShortLists();
  renderRepositorySkeletons();
  renderTagFilter();
  refreshSettingsDynamic();
  updateControls();
  updateStatusLeft();
  updateTitle();
}

async function loadTree() {
  if (!state.repository) {
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
    updateStatusLeft();
    updateControls();
  } catch (error) {
    setStatus(errText(error));
  }
  refreshUndoState();
}

async function refreshOrganization() {
  if (!state.repository) {
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
  els.pinnedTitle.title = `Pinned (showing up to ${pinnedLimit}) — click to change how many are shown`;
  els.recentTitle.title = `Recent (showing up to ${recentLimit}) — click to change how many are shown`;
  renderShortList(els.pinnedList, state.pins.slice(0, pinnedLimit), "Nothing pinned.", "pinned");
  renderShortList(
    els.recentList,
    state.recents.slice(0, recentLimit),
    "No recent files.",
    "recent"
  );
}

/* ------------------------------------------------------------------ */
/* Saved repositories                                                 */
/* ------------------------------------------------------------------ */

function recentRepositoryLimit() {
  return Math.min(
    20,
    Math.max(1, Math.round(Number(state.settings.recentRepositoryLimit) || 8))
  );
}

/** Rich entries ({ path, name, exists }) capped by the display limit. */
function savedRepositoryEntries() {
  return limitRepositoryEntries(
    state.recentRepositoryEntries,
    recentRepositoryLimit()
  );
}

/**
 * Wire the saved-repositories service. The service never imports main.js;
 * every bit of state and every action is supplied as a callback here.
 */
function configureRepositoryService() {
  configureRepositories({
    getState: () => state,
    getEntries: () => state.recentRepositoryEntries,
    getSavedEntries: savedRepositoryEntries,
    setEntries: (entries) => {
      state.recentRepositoryEntries = normalizeRepositoryEntries(entries);
      // Settings persistence keeps a plain path list; rendering uses the rich
      // entries above.
      state.settings.recentRepositories = state.recentRepositoryEntries.map(
        (entry) => entry.path
      );
      // The backend points lastRepository at the newest remaining entry when
      // one is removed; mirror that for this session.
      state.settings.lastRepository =
        state.recentRepositoryEntries[0]?.path ?? null;
      state.savedSettings = {
        ...state.savedSettings,
        recentRepositories: [...state.settings.recentRepositories],
        lastRepository: state.settings.lastRepository,
      };
    },
    getLimit: recentRepositoryLimit,
    isFeatureOn: featureOn,
    activateRepository,
    removeRecentRepository: (path) => api.removeRecentRepository(path),
    setStatus,
    elements: {
      sidebar: els.repositoryList,
      welcome: els.welcomeRepositories,
      settings: els.settingsRepositoriesList,
    },
  });
}

/** Sidebar and welcome-screen repositories. */
function renderRepositorySkeletons() {
  repositories.renderSidebar();
  repositories.renderWelcome();
}

function renderSettingsRepositories() {
  repositories.renderSettingsList();
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
  if (!state.repository) {
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
      : "This repository is empty.";
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
    row.draggable =
      !filtered && featureOn("sortAndOrder") && featureOn("sortAndOrder.dragReorder");

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
      if (
        filtered ||
        state.saving ||
        state.moving ||
        !featureOn("sortAndOrder") ||
        !featureOn("sortAndOrder.dragReorder")
      ) {
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
  if (!featureOn("sortAndOrder") || !featureOn("sortAndOrder.dragReorder")) return;
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
  if (!featureOn("sortAndOrder") || !featureOn("sortAndOrder.dragMove")) return;
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
  if (!featureOn("sortAndOrder") || !featureOn("sortAndOrder.sortButton")) return;
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
  if (!featureOn("sortAndOrder") || !featureOn("sortAndOrder.resetAction")) return;
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

  const can = (id) => featureOn(id);
  const rule = () => {
    if (els.contextMenu.children.length) separator();
  };

  if (!node) {
    if (can("createDelete.newFile")) add("New file…", () => createItem("", false));
    if (can("createDelete.newFolder")) add("New folder…", () => createItem("", true));
    if (can("sortAndOrder.sortButton")) {
      add("Sort alphabetically", () => sortAlphabetically(""));
    }
    if (can("sortAndOrder.resetAction")) {
      rule();
      add("Reset custom order", () => resetOrder(""));
    }
  } else if (node.isDir) {
    if (can("createDelete.newFile")) add("New file…", () => createItem(node.path, false));
    if (can("createDelete.newFolder")) add("New folder…", () => createItem(node.path, true));
    if (can("sortAndOrder.sortButton")) {
      add("Sort alphabetically", () => sortAlphabetically(node.path));
    }
    if (can("sortAndOrder.dragMove")) {
      if (node.path.includes("/")) {
        add("Move to repository root", () => movePath(node.path, ""));
      }
      const siblings = siblingNodes(node);
      const index = siblings.findIndex((sibling) => sibling.path === node.path);
      add("Move up", () => moveNode(node, -1), false, index <= 0);
      add("Move down", () => moveNode(node, 1), false, index === siblings.length - 1);
    }
    if (can("sortAndOrder.resetAction")) {
      add("Reset custom order", () => resetOrder(node.path));
    }
    if (can("createDelete.deleteAction")) {
      rule();
      add("Delete folder…", () => deleteItem(node), true);
    }
  } else {
    add("Open", () => openFile(node.path));
    add("Properties…", () => showProperties(node.path));
    if (can("revisions.contextAction")) {
      add("Show revisions…", () => showRevisions(node.path));
    }
    if (can("pinned.contextActions")) {
      const pinned = state.pins.includes(node.path);
      if (source === "pinned") {
        add("Unpin from Pinned", () => togglePin(node.path));
      } else {
        add(pinned ? "Unpin" : "Pin", () => togglePin(node.path));
      }
    }
    if (source === "recent" && can("recentFiles.removeAction")) {
      add("Remove from Recent", () => removeRecent(node.path));
    }
    if (source) {
      add("Reveal in repository", () => revealInTree(node.path));
    }
    if (can("tags.contextAction")) {
      add("Edit tags…", () => editTags(node.path));
    }
    if (can("sortAndOrder.sortButton")) {
      add("Sort alphabetically", () => sortAlphabetically(parentOf(node.path)));
    }
    if (can("sortAndOrder.dragMove")) {
      if (node.path.includes("/")) {
        add("Move to repository root", () => movePath(node.path, ""));
      }
      const siblings = siblingNodes(node);
      const index = siblings.findIndex((sibling) => sibling.path === node.path);
      add("Move up", () => moveNode(node, -1), false, index <= 0);
      add("Move down", () => moveNode(node, 1), false, index === siblings.length - 1);
    }
    if (can("sortAndOrder.resetAction")) {
      add("Reset custom order", () => resetOrder(parentOf(node.path)));
    }
    if (can("createDelete.deleteAction")) {
      rule();
      add("Delete file…", () => deleteItem(node), true);
    }
  }

  els.contextMenu.hidden = false;
  const rect = els.contextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, left)}px`;
  els.contextMenu.style.top = `${Math.max(8, top)}px`;
  els.contextMenu.querySelector("button")?.focus();
}

function showFileContextMenu(x, y) {
  els.contextMenu.textContent = "";
  state.menuReturnFocus = document.activeElement;
  const add = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", async () => {
      hideContextMenu();
      await action();
    });
    els.contextMenu.append(button);
  };
  const path = state.currentFile.path;
  add("Properties…", () => showProperties(path));
  if (featureOn("revisions") && featureOn("revisions.contextAction")) {
    add("Show revisions…", () => showRevisions(path));
  }
  add("Copy full path", () => copyText(state.repository ? `${state.repository.path}\\${path.replaceAll("/", "\\")}` : path));
  els.contextMenu.hidden = false;
  const rect = els.contextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, left)}px`;
  els.contextMenu.style.top = `${Math.max(8, top)}px`;
  els.contextMenu.querySelector("button")?.focus();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Path copied.");
  } catch {
    setStatus("The path could not be copied.");
  }
}

function toggleBrandPopover() {
  if (!featureOn("about") || !featureOn("about.brand")) return;
  if (els.brandPopover.hidden) {
    els.brandPopover.hidden = false;
    els.brandButton.setAttribute("aria-expanded", "true");
  } else {
    hideBrandPopover();
  }
}

function hideBrandPopover() {
  els.brandPopover.hidden = true;
  els.brandButton.setAttribute("aria-expanded", "false");
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

async function createItem(parent, isDir, { fromEmpty = false } = {}) {
  if (!state.repository) return;
  const allowed = fromEmpty
    ? featureOn("createDelete") && featureOn("createDelete.emptyNewFile")
    : featureOn("createDelete") &&
      featureOn(isDir ? "createDelete.newFolder" : "createDelete.newFile");
  if (!allowed) return;
  ensureExpanded(parent);
  renderTree();
  let initial = "";
  let error = "";
  for (;;) {
    const name = await promptName({
      title: isDir ? "New folder" : "New file",
      copy: parent ? `Inside ${parent}` : "Inside the repository root",
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
  if (!featureOn("createDelete") || !featureOn("createDelete.deleteAction")) return;
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
  if (
    !featureOn("pinned") ||
    !featureOn("pinned.contextActions")
  ) {
    return;
  }
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
  if (!featureOn("recentFiles") || !featureOn("recentFiles.removeAction")) {
    return;
  }
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
    setStatus("That file is no longer in the repository.");
    return;
  }
  ensureExpanded(path);
  state.selected = path;
  state.pendingTreeFocus = path;
  renderTree();
  setStatus(`Revealed ${basename(path)} in the repository tree.`);
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
  state.currentFile.name = basename(state.currentFile.path);
  els.fileName.textContent = state.currentFile.name;
  els.filePathTip.textContent = state.currentFile.path;
  els.filePathTip.title = parentOf(state.currentFile.path)
    ? `${parentOf(state.currentFile.path)}/`
    : "";
  updateTitle();
}

async function movePath(sourcePath, targetParent) {
  if (!featureOn("sortAndOrder") || !featureOn("sortAndOrder.dragMove")) return;
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
  if (!featureOn("tags") || !featureOn("tags.contextAction")) return;
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
  if (!featureOn("revisions") || !featureOn("revisions.contextAction")) return;
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

/** Encoding, line endings, size, and counts for a file.
 *  Uses the live editor text when the file on screen is the one asked for. */
async function showProperties(path) {
  let file;
  try {
    file = await api.readFile(path);
  } catch (error) {
    setStatus(errText(error));
    return;
  }
  const live = state.currentFile?.path === file.path && state.editor;
  const content = live ? state.editor.getValue() : file.content ?? "";
  const size = live && state.currentFile.size != null ? state.currentFile.size : file.size;
  const words = countWords(content);
  const chars = content.replace(/\s/g, "").length;
  const lines = content ? content.split(/\r\n|\r|\n/).length : 0;
  const rows = [
    ["Name", file.name],
    ["Location", `${state.repository?.path ?? ""}${parentOf(file.path) ? `\\${parentOf(file.path).replaceAll("/", "\\")}` : ""}`],
    ["Encoding", file.encodingLabel],
    ["Line endings", file.eolLabel],
    ["Size", formatBytes(size ?? 0)],
    ["Words", formatCount(words)],
    ["Characters", `${formatCount(chars)} (without spaces)`],
    ["Lines", formatCount(lines)],
    ["Modified", formatDate(file.modifiedMs)],
  ];
  els.propertiesList.textContent = "";
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value ?? "";
    els.propertiesList.append(dt, dd);
  }
  els.propertiesDialog.showModal();
}

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
    // showModal() throws if another dialog is already modal; close those first.
    document.querySelectorAll("dialog[open]").forEach((dialog) => {
      if (dialog !== els.unsavedDialog) dialog.close();
    });
    if (els.unsavedDialog.open) {
      els.unsavedDialog.close();
    }
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
  if (!state.repository) return false;
  if (state.currentFile?.path === path) {
    if (line) state.editor?.openAtLine(line);
    ensureExpanded(path);
    renderTree();
    return true;
  }
  try {
    const file = await api.readFile(path);
    if (file.external) {
      if (!featureOn("externalFiles") || !featureOn("externalFiles.openDefaultApp")) {
        setStatus("Opening non-text files outside Plainfold is turned off.");
        return false;
      }
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
    name: file.name,
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
  els.filePathTip.textContent = file.path;
  els.filePathTip.title = parentOf(file.path) ? `${parentOf(file.path)}/` : "";
  updateFileStats(file.content, file.size);
  updateTitle();
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
    syntaxHighlighting: featureOn("syntaxHighlighting.editor"),
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

/** Closes the open file, asking about unsaved changes before letting it go. */
async function closeCurrentFile({ silent = false } = {}) {
  if (!state.currentFile) return false;
  const name = state.currentFile.name;
  const path = state.currentFile.path;
  if (!(await resolvePendingChanges())) return false;
  // Saving or cancelling inside the dialog may already have moved on.
  if (state.currentFile?.path !== path) return true;
  closeEditor({ silent: true });
  if (state.selected === path) state.selected = null;
  renderTree();
  updateControls();
  if (!silent) setStatus(`Closed ${name}.`);
  return true;
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
  els.filePathTip.textContent = "";
  els.filePathTip.title = "";
  updateFileStats("", 0);
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
  if (!featureOn("autosave") || !featureOn("autosave.engine")) return;
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
  if (!featureOn("autosave") || !featureOn("autosave.engine")) return;
  if (state.autosavePaused || !state.dirty) return;
  const saved = await saveCurrent();
  if (!saved && state.dirty) scheduleAutosave();
}

function markDirty() {
  if (!state.currentFile || state.currentFile.readOnly) return;
  updateFileStats(state.editor?.getValue() ?? "", state.currentFile.size);
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
    updateFileStats(state.editor?.getValue() ?? "", outcome.size);
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
  if (!state.repository) {
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
  if (!featureOn("repositoryUndo")) return;
  if (!state.repository || state.undoBusy) return;
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
  if (!featureOn("repositoryUndo")) return;
  if (!state.repository || state.undoBusy || !state.undoInfo.redoLabel) return;
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
 *  with the repository after a step was undone or redone. */
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
      setStatus("The open file is no longer in the repository.");
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
  if (!featureOn("wrap") || !featureOn("wrap.toggle")) return;
  state.wrap = !state.wrap;
  els.wrapToggle.textContent = state.wrap ? "Wrap on" : "Wrap off";
  els.wrapToggle.setAttribute("aria-pressed", String(state.wrap));
  state.editor?.setWrap(state.wrap);
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function focusSearch() {
  if (
    !featureOn("search") ||
    !featureOn("search.toolbar") ||
    !featureOn("search.shortcut")
  ) {
    return;
  }
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
  if (!featureOn("search")) return;
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
  if (!featureOn("search.results")) {
    hideResults();
    return;
  }
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

/* ------------------------------------------------------------------ */
/* Short-list limit popup                                              */
/* ------------------------------------------------------------------ */

let limitTarget = "pinned";

function openLimitDialog(target) {
  limitTarget = target === "recent" ? "recent" : "pinned";
  const pinned = limitTarget === "pinned";
  const current = state.settings[pinned ? "pinnedLimit" : "recentLimit"] ?? 5;
  els.limitTitle.textContent = pinned ? "Pinned" : "Recent";
  els.limitCopy.textContent = pinned
    ? "How many pinned files to show in the sidebar."
    : "How many recent files to show in the sidebar.";
  els.limitInput.value = String(current);
  els.limitError.hidden = true;
  els.limitDialog.showModal();
  setTimeout(() => {
    els.limitInput.focus();
    els.limitInput.select();
  }, 0);
}

async function saveLimitFromForm() {
  const value = Math.round(Number(els.limitInput.value));
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    els.limitError.hidden = false;
    els.limitError.textContent = "Enter a whole number from 1 to 100.";
    return;
  }
  const key = limitTarget === "pinned" ? "pinnedLimit" : "recentLimit";
  if (value === (state.settings[key] ?? 5)) {
    els.limitDialog.close();
    return;
  }
  const settings = { ...state.savedSettings, [key]: value };
  try {
    const saved = await api.saveSettings(settings);
    els.limitDialog.close();
    const merged = mergeSettingsResponse(settings, saved);
    state.savedSettings = merged;
    applySettings(merged);
    setStatus(
      limitTarget === "pinned"
        ? `Showing ${value} pinned ${value === 1 ? "file" : "files"}.`
        : `Showing ${value} recent ${value === 1 ? "file" : "files"}.`
    );
  } catch (error) {
    els.limitError.hidden = false;
    els.limitError.textContent = errText(error);
  }
}

const SETTING_ELEMENT_IDS = {
  theme: "setting-theme",
  fontFamily: "setting-font-family",
  fontSize: "setting-font-size",
  tabWidth: "setting-tab-width",
  pinnedLimit: "setting-pinned-limit",
  recentLimit: "setting-recent-limit",
  autosaveMode: "setting-autosave-mode",
  autosaveIdleSecs: "setting-autosave-idle",
  autosaveIntervalSecs: "setting-autosave-interval",
  revisionHourly: "setting-revision-hourly",
  revisionDaily: "setting-revision-daily",
  revisionWeekly: "setting-revision-weekly",
  revisionMonthly: "setting-revision-monthly",
  revisionYearly: "setting-revision-yearly",
  defaultSort: "setting-sort",
  recentRepositoryLimit: "setting-recent-repository-limit",
};

const SETTINGS_SECTIONS = {
  appearance: {
    fields: ["theme", "fontFamily", "fontSize"],
    features: [],
  },
  editor: {
    fields: [
      "tabWidth",
      "autosaveMode",
      "autosaveIdleSecs",
      "autosaveIntervalSecs",
      "revisionHourly",
      "revisionDaily",
      "revisionWeekly",
      "revisionMonthly",
      "revisionYearly",
    ],
    features: [
      "autosave",
      "revisions",
      "watcher",
      "wrap",
      "syntaxHighlighting",
      "editorStats",
    ],
  },
  sidebar: {
    fields: ["pinnedLimit", "recentLimit", "defaultSort"],
    features: [
      "pinned",
      "recentFiles",
      "tags",
      "treeFilter",
      "sortAndOrder",
      "createDelete",
      "repositoryCounts",
    ],
  },
  search: {
    fields: [],
    features: ["search"],
  },
  repositories: {
    fields: ["recentRepositoryLimit"],
    features: ["recentRepositories"],
  },
  updates: {
    fields: [],
    features: ["updates"],
  },
  features: {
    fields: [],
    features: FEATURE_GROUPS.map((group) => group.id),
  },
  maintenance: {
    fields: [],
    features: [],
  },
  about: {
    fields: [],
    features: ["about"],
  },
};

function settingsElement(key) {
  const id = SETTING_ELEMENT_IDS[key];
  return id ? $(id) : null;
}

function showSettingsError(message) {
  if (!els.settingsError) return;
  if (!message) {
    els.settingsError.hidden = true;
    els.settingsError.textContent = "";
    return;
  }
  els.settingsError.hidden = false;
  els.settingsError.textContent = message;
}

function showSavedIndicator() {
  if (!els.settingsSaved) return;
  els.settingsSaved.hidden = false;
  clearTimeout(state.savedIndicatorTimer);
  state.savedIndicatorTimer = setTimeout(() => {
    els.settingsSaved.hidden = true;
  }, 1600);
}

/**
 * Merge a backend settings response over the local object. Fields the server
 * omits (older backends, or client-only v1.2 fields) keep their local values.
 */
function mergeSettingsResponse(local, response) {
  const merged = { ...local };
  if (response && typeof response === "object" && !Array.isArray(response)) {
    for (const [key, value] of Object.entries(response)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  if (!Array.isArray(merged.disabledFeatures)) {
    merged.disabledFeatures = Array.isArray(local.disabledFeatures)
      ? [...local.disabledFeatures]
      : [];
  }
  if (!Array.isArray(merged.recentRepositories)) {
    merged.recentRepositories = Array.isArray(local.recentRepositories)
      ? [...local.recentRepositories]
      : [];
  }
  if (merged.lastRepository === undefined) {
    merged.lastRepository = local.lastRepository ?? null;
  }
  if (merged.recentRepositoryLimit === undefined) {
    merged.recentRepositoryLimit = local.recentRepositoryLimit ?? 8;
  }
  return merged;
}

function clampSettingNumber(element, min, max, fallback, label, issues) {
  const raw = element?.value?.trim() ?? "";
  let value = Math.round(Number(raw));
  if (raw === "" || !Number.isFinite(value)) {
    issues.push(`${label} must be a number; using ${fallback}.`);
    return fallback;
  }
  if (value < min || value > max) {
    const clamped = Math.min(max, Math.max(min, value));
    issues.push(`${label} must be from ${min} to ${max}; using ${clamped}.`);
    value = clamped;
  }
  return value;
}

/** Build a complete settings object from the current dialog fields. */
function buildSettingsFromForm() {
  const issues = [];

  const settings = {
    theme: els.settingTheme?.value ?? "system",
    fontFamily: els.settingFontFamily?.value.trim() || "Consolas",
    fontSize: clampSettingNumber(
      els.settingFontSize,
      8,
      48,
      14,
      "Font size",
      issues
    ),
    tabWidth: clampSettingNumber(els.settingTabWidth, 1, 16, 4, "Tab width", issues),
    pinnedLimit: clampSettingNumber(
      els.settingPinnedLimit,
      1,
      100,
      5,
      "Pinned limit",
      issues
    ),
    recentLimit: clampSettingNumber(
      els.settingRecentLimit,
      1,
      100,
      5,
      "Recent limit",
      issues
    ),
    autosaveMode: els.settingAutosaveMode?.value ?? "off",
    autosaveIdleSecs: clampSettingNumber(
      els.settingAutosaveIdle,
      1,
      60,
      20,
      "Autosave idle",
      issues
    ),
    autosaveIntervalSecs: clampSettingNumber(
      els.settingAutosaveInterval,
      120,
      3600,
      120,
      "Autosave interval",
      issues
    ),
    revisionHourly: clampSettingNumber(
      els.settingRevisionHourly,
      0,
      1000,
      24,
      "Hourly revisions",
      issues
    ),
    revisionDaily: clampSettingNumber(
      els.settingRevisionDaily,
      0,
      1000,
      7,
      "Daily revisions",
      issues
    ),
    revisionWeekly: clampSettingNumber(
      els.settingRevisionWeekly,
      0,
      1000,
      4,
      "Weekly revisions",
      issues
    ),
    revisionMonthly: clampSettingNumber(
      els.settingRevisionMonthly,
      0,
      1000,
      12,
      "Monthly revisions",
      issues
    ),
    revisionYearly: clampSettingNumber(
      els.settingRevisionYearly,
      0,
      1000,
      100,
      "Yearly revisions",
      issues
    ),
    defaultSort: els.settingSort?.value ?? "name",
    defaultRepository: state.settingsDraftRepository ?? null,
    recentRepositoryLimit: clampSettingNumber(
      els.settingRecentRepositoryLimit,
      1,
      20,
      8,
      "Recent repository limit",
      issues
    ),
    desktopShortcutPrompted: Boolean(state.settings.desktopShortcutPrompted),
    disabledFeatures: [...state.settingsDraftFeatures],
    // Server-managed fields are sent back exactly as they were received so a
    // save cannot erase the saved repository list.
    recentRepositories: Array.isArray(state.settings.recentRepositories)
      ? [...state.settings.recentRepositories]
      : [],
    lastRepository: state.settings.lastRepository ?? null,
  };

  return { settings, issues };
}

function syncSettingsFields(values = state.settings) {
  for (const [key, id] of Object.entries(SETTING_ELEMENT_IDS)) {
    const element = $(id);
    if (!element) continue;
    const value = values[key];
    element.value = value === null || value === undefined ? "" : String(value);
  }
  if (els.settingDefaultRepository) {
    els.settingDefaultRepository.value = state.settingsDraftRepository ?? "";
  }
}

/* ------------------------------------------------------------------ */
/* Features UI                                                         */
/* ------------------------------------------------------------------ */

function makeFeatureSwitch(id, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "switch";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", "true");
  button.setAttribute("aria-label", label);
  button.dataset.featureToggle = id;
  return button;
}

function featureControlRow(control) {
  const row = document.createElement("div");
  row.className = "feature-control";
  const copy = document.createElement("div");
  copy.className = "feature-control-copy";
  const label = document.createElement("div");
  label.className = "feature-control-label";
  label.textContent = control.label;
  const description = document.createElement("p");
  description.className = "feature-control-description";
  description.textContent = control.description;
  copy.append(label, description);
  row.append(makeFeatureSwitch(control.id, `Toggle ${control.label}`), copy);
  return row;
}

function renderFeatures() {
  if (!els.settingsFeatures) return;
  els.settingsFeatures.textContent = "";
  for (const category of FEATURE_CATEGORY_ORDER) {
    const categoryElement = document.createElement("div");
    categoryElement.className = "feature-category";
    const heading = document.createElement("h4");
    heading.textContent = category;
    categoryElement.append(heading);

    const groups = FEATURE_GROUPS.filter(
      (group) => FEATURE_CATEGORIES[group.id] === category
    );
    for (const group of groups) {
      const wrapper = document.createElement("div");
      wrapper.className = "feature-group";
      wrapper.dataset.featureGroup = group.id;
      wrapper.dataset.featureSearch = [
        group.label,
        group.description,
        ...group.controls.flatMap((control) => [
          control.label,
          control.description,
        ]),
      ]
        .join(" ")
        .toLowerCase();

      const head = document.createElement("div");
      head.className = "feature-group-head";
      head.append(makeFeatureSwitch(group.id, `Toggle ${group.label}`));

      const copy = document.createElement("div");
      copy.className = "feature-group-copy";
      const label = document.createElement("div");
      label.className = "feature-group-label";
      label.textContent = group.label;
      const description = document.createElement("p");
      description.className = "feature-group-description";
      description.textContent = group.description;
      copy.append(label, description);

      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "feature-expand";
      expand.textContent = "Advanced";
      expand.dataset.featureExpand = group.id;
      const controlsId = `feature-controls-${group.id}`;
      expand.setAttribute("aria-controls", controlsId);
      expand.setAttribute(
        "aria-label",
        `Advanced controls for ${group.label}`
      );
      expand.setAttribute(
        "aria-expanded",
        state.expandedFeatureGroups.has(group.id) ? "true" : "false"
      );
      head.append(copy, expand);

      const controls = document.createElement("div");
      controls.className = "feature-controls";
      controls.id = controlsId;
      controls.hidden = !state.expandedFeatureGroups.has(group.id);
      for (const control of group.controls) {
        controls.append(featureControlRow(control));
      }

      wrapper.append(head, controls);
      categoryElement.append(wrapper);
    }
    els.settingsFeatures.append(categoryElement);
  }
  syncFeatureSwitches();
}

function renderUpdateAutoCheckSwitch() {
  if (!els.settingsUpdateAutocheck) return;
  const control = controlsForGroup("updates").find(
    (item) => item.id === "updates.autoCheck"
  );
  if (!control) return;
  els.settingsUpdateAutocheck.textContent = "";
  const label = document.createElement("span");
  label.className = "settings-label";
  label.textContent = control.label;
  const row = document.createElement("div");
  row.className = "feature-inline-switch";
  const copy = document.createElement("div");
  copy.className = "feature-control-copy";
  const description = document.createElement("p");
  description.className = "feature-control-description";
  description.textContent = control.description;
  copy.append(description);
  row.append(makeFeatureSwitch(control.id, `Toggle ${control.label}`), copy);
  els.settingsUpdateAutocheck.append(label, row);
  syncFeatureSwitches();
}

/** Update every rendered switch from the draft feature list. */
function syncFeatureSwitches() {
  const draft = state.settingsDraftFeatures;
  for (const button of document.querySelectorAll("[data-feature-toggle]")) {
    const id = button.dataset.featureToggle;
    if (!id) continue;
    const group = groupOf(id);
    const isGroup = group === id;
    const groupOff = !isGroup && group ? draft.has(group) : false;
    const checked = !draft.has(id) && !groupOff;
    button.setAttribute("aria-checked", String(checked));
    button.disabled = groupOff;
  }
  for (const row of document.querySelectorAll("[data-feature-group]")) {
    const groupId = row.dataset.featureGroup;
    row.classList.toggle("feature-group-off", draft.has(groupId));
  }
}

function setFeatureEnabled(id, enabled) {
  const group = groupOf(id);
  if (!group) return;
  if (enabled) state.settingsDraftFeatures.delete(id);
  else state.settingsDraftFeatures.add(id);
  state.settings.disabledFeatures = [...state.settingsDraftFeatures];
  state.settingsDirty = true;
  state.settingsRevision += 1;
  applyFeatureVisibility();
  syncFeatureSwitches();
  saveSettingsNow();
}

/* ------------------------------------------------------------------ */
/* Settings panels, search, and auto-save                              */
/* ------------------------------------------------------------------ */

function settingsNavButtons() {
  return [...(els.settingsDialog?.querySelectorAll("[data-settings-category]") ?? [])];
}

function settingsPanels() {
  return [...(els.settingsDialog?.querySelectorAll("[data-settings-panel]") ?? [])];
}

function activateSettingsSection(sectionId) {
  const panels = settingsPanels();
  const target = panels.find((panel) => panel.dataset.settingsPanel === sectionId);
  if (!target) return;
  state.settingsSection = sectionId;
  const buttons = settingsNavButtons();
  for (const button of buttons) {
    const active = button.dataset.settingsCategory === sectionId;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }
  updateSettingsPanelVisibility();
}

function updateSettingsPanelVisibility() {
  for (const panel of settingsPanels()) {
    const active = panel.dataset.settingsPanel === state.settingsSection;
    panel.hidden = !active || panel.dataset.searchVisible === "false";
  }
}

function settingFieldSearchText(field) {
  const input = field.querySelector("input, select, textarea");
  return [
    field.dataset.settingsLabel ?? "",
    field.dataset.settingsHelp ?? "",
    input?.id ?? "",
    field.textContent ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function filterFeatureGroupsInSettings(query, categoryMatch) {
  let visible = 0;
  for (const category of els.settingsFeatures?.querySelectorAll(".feature-category") ?? []) {
    let categoryVisible = 0;
    for (const group of category.querySelectorAll("[data-feature-group]")) {
      const match =
        !query || categoryMatch || (group.dataset.featureSearch ?? "").includes(query);
      group.hidden = !match;
      if (match) categoryVisible += 1;
    }
    category.hidden = Boolean(query) && categoryVisible === 0;
    visible += categoryVisible;
  }
  return visible;
}

function applySettingsSearch() {
  if (!els.settingsDialog) return;
  const query = state.settingsQuery.trim().toLowerCase();
  const navButtons = settingsNavButtons();
  const panels = settingsPanels();
  let anyVisible = false;
  let firstVisible = null;
  const currentPanel = panels.find(
    (panel) => panel.dataset.settingsPanel === state.settingsSection
  );
  const currentNav = navButtons.find(
    (button) => button.dataset.settingsCategory === state.settingsSection
  );

  for (const panel of panels) {
    const nav = navButtons.find(
      (button) => button.dataset.settingsCategory === panel.dataset.settingsPanel
    );
    const categoryMatch = Boolean(
      query && (nav?.textContent ?? "").toLowerCase().includes(query)
    );
    let visibleFields = 0;
    for (const field of panel.querySelectorAll(".settings-field")) {
      const match =
        !query || categoryMatch || settingFieldSearchText(field).includes(query);
      field.hidden = !match;
      if (match) visibleFields += 1;
    }
    if (panel.dataset.settingsPanel === "features") {
      visibleFields += filterFeatureGroupsInSettings(query, categoryMatch);
    }
    const panelVisible = !query || categoryMatch || visibleFields > 0;
    panel.dataset.searchVisible = panelVisible ? "true" : "false";
    if (nav) nav.hidden = !panelVisible;
    if (panelVisible && !panel.classList.contains("feature-off")) {
      anyVisible = true;
      if (!firstVisible && panel === currentPanel) firstVisible = panel;
      if (!firstVisible) firstVisible = panel;
    }
  }

  if (!query) {
    for (const panel of panels) panel.dataset.searchVisible = "true";
    for (const nav of navButtons) nav.hidden = false;
  }

  if (els.settingsNoMatch) els.settingsNoMatch.hidden = !query || anyVisible;

  const currentVisible =
    currentPanel?.dataset.searchVisible !== "false" &&
    currentNav &&
    !currentNav.hidden &&
    !currentPanel?.classList.contains("feature-off");
  if (!currentVisible && firstVisible) {
    activateSettingsSection(firstVisible.dataset.settingsPanel);
  } else {
    updateSettingsPanelVisibility();
  }
}

function refreshSettingsDynamic() {
  if (els.settingsZoomValue) {
    const zoomed = state.zoom !== null;
    els.settingsZoomValue.textContent = `${editorFontSize()}px${zoomed ? " (manual zoom)" : ""}`;
  }
  if (els.settingsSearchInfo) {
    if (!state.repository) {
      els.settingsSearchInfo.textContent =
        "Open a repository to see index information and rebuild the index.";
    } else if (state.searchIndexMessage) {
      els.settingsSearchInfo.textContent = state.searchIndexMessage;
    } else {
      els.settingsSearchInfo.textContent = `Search index available for ${state.repository.name}.`;
    }
  }
  if (els.settingsSearchFeatureState) {
    const on = featureOn("search") && featureOn("search.toolbar");
    els.settingsSearchFeatureState.textContent = on
      ? "Search is enabled. Turn it off under Features to hide the toolbar and shortcut."
      : "Search is turned off. It can be restored under Features.";
  }
  const configured = updateSourceConfigured();
  if (els.settingUpdateSource) {
    els.settingUpdateSource.textContent = updateSourceLabel();
  }
  if (els.settingUpdateStatus) {
    els.settingUpdateStatus.textContent = configured
      ? state.updateInfo.status || "No update check has run yet."
      : updateInactiveStatus();
  }
  if (els.settingUpdateVersions) {
    const current = state.version || state.updateInfo.currentVersion;
    const latest = state.updateInfo.latestVersion;
    els.settingUpdateVersions.textContent = [
      current ? `Current v${String(current).replace(/^v/i, "")}` : "",
      latest ? `Latest v${String(latest).replace(/^v/i, "")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (els.settingUpdateLastChecked) {
    els.settingUpdateLastChecked.textContent = state.updateInfo.lastChecked
      ? `Last checked ${new Date(state.updateInfo.lastChecked).toLocaleString()}.`
      : "No check recorded yet.";
  }
  if (els.settingUpdateCheck) {
    els.settingUpdateCheck.disabled = !configured || state.updateInfo.checking;
  }
  if (els.settingsAboutVersion) {
    els.settingsAboutVersion.textContent = state.version
      ? `Plainfold v${state.version}`
      : "Plainfold";
  }
  if (els.settingsAboutSource) {
    els.settingsAboutSource.textContent = updateSourceLabel();
  }
  if (els.settingsAboutGithub) {
    els.settingsAboutGithub.textContent = configured
      ? `github.com/${UPDATE_OWNER}/${UPDATE_REPO}`
      : "Repository link not configured.";
  }
  renderSettingsRepositories();
  syncFeatureSwitches();
}

function openSettings() {
  state.settingsDraftRepository = state.settings.defaultRepository ?? null;
  state.settingsDraftFeatures = new Set(
    Array.isArray(state.settings.disabledFeatures)
      ? state.settings.disabledFeatures
      : []
  );
  state.settingsDirty = false;
  state.settingsSaveFailed = false;
  state.settingsQuery = "";
  if (els.settingsSearch) els.settingsSearch.value = "";
  syncSettingsFields();
  // Show the size actually in use, so a manual zoom is visible here too.
  if (state.zoom !== null && els.settingFontSize) {
    els.settingFontSize.value = String(editorFontSize());
  }
  showSettingsError("");
  if (els.settingsSaved) els.settingsSaved.hidden = true;
  renderFeatures();
  renderUpdateAutoCheckSwitch();
  refreshSettingsDynamic();
  applySettingsSearch();
  const usablePanels = settingsPanels().filter(
    (panel) => !panel.classList.contains("feature-off")
  );
  const preferred = usablePanels.some(
    (panel) => panel.dataset.settingsPanel === state.settingsSection
  )
    ? state.settingsSection
    : usablePanels[0]?.dataset.settingsPanel ?? "appearance";
  activateSettingsSection(preferred);
  els.settingsDialog.showModal();
}

function scheduleSettingsSave() {
  clearTimeout(state.settingsSaveTimer);
  state.settingsSaveTimer = setTimeout(() => {
    state.settingsSaveTimer = null;
    saveSettingsNow();
  }, 500);
}

function flushSettingsSave() {
  clearTimeout(state.settingsSaveTimer);
  state.settingsSaveTimer = null;
  if (state.settingsDirty) return saveSettingsNow();
  return state.settingsSaveChain.then(
    (result) => result !== false && !state.settingsSaveFailed
  );
}

/**
 * Auto-save the complete settings object. Requests are serialized so rapid
 * changes cannot race; each request reads the current fields when it runs.
 */
function saveSettingsNow() {
  clearTimeout(state.settingsSaveTimer);
  state.settingsSaveTimer = null;
  if (!state.settingsDirty) return Promise.resolve(true);

  const run = async () => {
    const { settings, issues } = buildSettingsFromForm();
    const builtRevision = state.settingsRevision;
    state.settingsDirty = false;
    try {
      const saved = await api.saveSettings(settings);
      const merged = mergeSettingsResponse(settings, saved);
      const pending = state.settingsRevision !== builtRevision;
      const pendingDraft = pending ? new Set(state.settingsDraftFeatures) : null;
      const fontChanged = merged.fontSize !== state.settings.fontSize;
      state.savedSettings = merged;
      state.settingsDraftFeatures = new Set(
        Array.isArray(merged.disabledFeatures) ? merged.disabledFeatures : []
      );
      if (fontChanged) {
        // A saved font size takes over from any manual zoom.
        state.zoom = null;
        saveZoom();
      }
      applySettings(merged);
      if (!pending) {
        state.settingsDraftRepository = merged.defaultRepository ?? null;
        syncSettingsFields(merged);
      }
      if (pending) {
        // Changes made while the request was in flight have not been saved.
        state.settingsDirty = true;
        if (pendingDraft) {
          state.settingsDraftFeatures = pendingDraft;
          state.settings.disabledFeatures = [...pendingDraft];
          applyFeatureVisibility();
        }
      }
      state.settingsSaveFailed = false;
      showSettingsError(issues.join(" "));
      showSavedIndicator();
      await loadTree();
      refreshSettingsDynamic();
      if (pending) scheduleSettingsSave();
      else setStatus("Settings saved.");
      return true;
    } catch (error) {
      state.settingsDirty = true;
      state.settingsSaveFailed = true;
      showSettingsError(errText(error));
      return false;
    }
  };

  const task = state.settingsSaveChain.then(run, run);
  state.settingsSaveChain = task.catch(() => false);
  return task;
}

async function closeSettings() {
  if (state.settingsClosing) return;
  state.settingsClosing = true;
  try {
    const ok = await flushSettingsSave();
    if (!ok && state.settingsSaveFailed) return;
    els.settingsDialog.close();
  } finally {
    state.settingsClosing = false;
  }
}

function resetSettingsSection(sectionId) {
  const section = SETTINGS_SECTIONS[sectionId];
  if (!section) return;
  for (const key of section.fields) {
    const element = settingsElement(key);
    if (!element) continue;
    const value = DEFAULT_SETTINGS[key];
    element.value = value === null || value === undefined ? "" : String(value);
  }
  if (sectionId === "appearance") {
    state.zoom = null;
    applyZoom();
    saveZoom();
  }
  if (sectionId === "repositories") {
    state.settingsDraftRepository = null;
    if (els.settingDefaultRepository) els.settingDefaultRepository.value = "";
  }
  for (const groupId of section.features) {
    state.settingsDraftFeatures.delete(groupId);
    for (const control of controlsForGroup(groupId)) {
      state.settingsDraftFeatures.delete(control.id);
    }
  }
  state.settings.disabledFeatures = [...state.settingsDraftFeatures];
  state.settingsDirty = true;
  state.settingsRevision += 1;
  applyFeatureVisibility();
  syncFeatureSwitches();
  refreshSettingsDynamic();
  saveSettingsNow();
}

async function resetAllSettings() {
  const confirmed = await confirmDialog(
    "Reset all settings and feature switches to their defaults? Your files, tags, pins, recents, and revisions are kept.",
    { title: "Reset all settings", kind: "warning" }
  );
  if (!confirmed) return;
  state.settingsDraftRepository = null;
  state.settingsDraftFeatures = new Set();
  state.settings.disabledFeatures = [];
  state.zoom = null;
  applyZoom();
  saveZoom();
  syncSettingsFields({
    ...DEFAULT_SETTINGS,
    recentRepositories: state.settings.recentRepositories,
    lastRepository: state.settings.lastRepository,
  });
  if (els.settingDefaultRepository) els.settingDefaultRepository.value = "";
  state.settingsDirty = true;
  state.settingsRevision += 1;
  applyFeatureVisibility();
  renderFeatures();
  renderUpdateAutoCheckSwitch();
  refreshSettingsDynamic();
  saveSettingsNow();
}

async function clearRecentRepositories() {
  if (!savedRepositoryEntries().length) {
    setStatus("There are no saved repositories to clear.");
    return;
  }
  const removable = state.recentRepositoryEntries.filter(
    (entry) => !repositoryEntryIsActive(entry, state.repository)
  );
  if (!removable.length) {
    setStatus(
      state.repository
        ? "Only the active repository is saved; there is nothing to clear."
        : "There are no saved repositories to clear."
    );
    return;
  }
  const confirmed = await confirmDialog(
    "Clear saved repositories? Every saved repository except the active one is removed from this list. Files on disk are never deleted.",
    { title: "Clear recent repositories", kind: "warning" }
  );
  if (!confirmed) return;
  await repositories.clearRecent();
}

async function rebuildSearchIndex() {
  if (!state.repository) {
    setStatus("Open a repository first.");
    refreshSettingsDynamic();
    return;
  }
  const buttons = [els.maintenanceRescan, els.searchRescan].filter(Boolean);
  for (const button of buttons) button.disabled = true;
  setStatus("Rebuilding the search index…");
  if (els.settingsSearchInfo) {
    els.settingsSearchInfo.textContent = "Rebuilding the search index…";
  }
  try {
    const indexed = await api.rescan();
    await loadTree();
    await refreshOrganization();
    const count = Number(indexed);
    const text = Number.isFinite(count)
      ? `Search index rebuilt: ${formatCount(count)} file${count === 1 ? "" : "s"} indexed.`
      : "Search index rebuilt.";
    state.searchIndexMessage = text;
    setStatus(text);
  } catch (error) {
    state.searchIndexMessage = errText(error);
    setStatus(errText(error));
  } finally {
    refreshSettingsDynamic();
    updateControls();
  }
}

/** Show the notify-only banner. The banner mirrors state.updateInfo. */
function showUpdateBanner(result) {
  if (!els.updateBanner) return;
  if (
    !result?.configured ||
    !result.updateAvailable ||
    !result.latestVersion ||
    !featureOn("updates") ||
    !featureOn("updates.banner") ||
    isUpdateDismissed(result.latestVersion)
  ) {
    hideUpdateBanner();
    return;
  }
  els.updateBannerText.textContent = `Plainfold ${result.latestVersion} is available.`;
  if (els.updateBannerNotes) {
    els.updateBannerNotes.disabled = !isAllowedReleaseUrl(result.releaseUrl);
  }
  els.updateBanner.hidden = false;
}

function hideUpdateBanner() {
  if (els.updateBanner) els.updateBanner.hidden = true;
}

/** Plain-language status for Settings > Updates. */
function updateStatusFor(result) {
  if (!result.configured) return updateInactiveStatus();
  if (result.error) return result.error;
  if (result.updateAvailable && result.latestVersion) {
    return `Plainfold ${result.latestVersion} is available.`;
  }
  if (result.latestVersion) return "Plainfold is up to date.";
  return "No published release is available.";
}

function applyUpdateResult(result) {
  state.updateInfo = {
    currentVersion: result.currentVersion || state.version,
    latestVersion: result.latestVersion ?? null,
    lastChecked: result.checkedAt ?? Date.now(),
    checking: false,
    releaseUrl: result.releaseUrl ?? null,
    status: updateStatusFor(result),
  };
  if (result.updateAvailable) showUpdateBanner(result);
  else if (!result.error) hideUpdateBanner();
  refreshSettingsDynamic();
}

/**
 * Launch check: guarded by the updates group and auto-check control, cached
 * for 24 hours, and deliberately not awaited so startup is never blocked.
 */
async function runLaunchUpdateCheck() {
  if (!featureOn("updates") || !featureOn("updates.autoCheck")) return;
  if (!updateSourceConfigured()) {
    state.updateInfo.status = updateInactiveStatus();
    refreshSettingsDynamic();
    return;
  }
  try {
    const result = await maybeCheckForUpdate({ currentVersion: state.version });
    if (result) {
      applyUpdateResult(result);
    } else if (state.updateInfo.lastChecked) {
      // The 24-hour cache skipped the request; keep the timestamp readable.
      state.updateInfo.status = "A check already ran in the last 24 hours.";
      refreshSettingsDynamic();
    }
  } catch (error) {
    state.updateInfo = {
      ...state.updateInfo,
      checking: false,
      lastChecked: Date.now(),
      status: errText(error),
    };
    refreshSettingsDynamic();
  }
}

async function checkUpdatesNow() {
  // Manual checks stay available when only automatic checks are off.
  if (!featureOn("updates") || !featureOn("updates.settingsSection")) return;
  if (!updateSourceConfigured()) {
    state.updateInfo.status = updateInactiveStatus();
    refreshSettingsDynamic();
    return;
  }
  if (state.updateInfo.checking) return;
  state.updateInfo.checking = true;
  state.updateInfo.status = "Checking for updates…";
  if (els.settingUpdateCheck) els.settingUpdateCheck.disabled = true;
  refreshSettingsDynamic();
  try {
    const result = await checkForUpdate({ currentVersion: state.version });
    applyUpdateResult(result);
  } catch (error) {
    state.updateInfo = {
      ...state.updateInfo,
      checking: false,
      lastChecked: Date.now(),
      status: errText(error),
    };
  } finally {
    state.updateInfo.checking = false;
    refreshSettingsDynamic();
  }
}

async function offerDesktopShortcut() {
  if (
    !featureOn("desktopShortcut") ||
    !featureOn("desktopShortcut.firstRunPrompt")
  ) {
    return;
  }
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

function wireSettingsDialog() {
  const dialog = els.settingsDialog;
  if (!dialog) return;

  dialog.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-feature-toggle]");
    if (toggle && !toggle.disabled) {
      setFeatureEnabled(
        toggle.dataset.featureToggle,
        toggle.getAttribute("aria-checked") !== "true"
      );
      return;
    }
    const expand = event.target.closest?.("[data-feature-expand]");
    if (expand) {
      const groupId = expand.dataset.featureExpand;
      const controls = $(`feature-controls-${groupId}`);
      const open = !state.expandedFeatureGroups.has(groupId);
      if (open) state.expandedFeatureGroups.add(groupId);
      else state.expandedFeatureGroups.delete(groupId);
      if (controls) controls.hidden = !open;
      expand.setAttribute("aria-expanded", String(open));
      return;
    }
    const reset = event.target.closest?.("[data-settings-reset]");
    if (reset) {
      resetSettingsSection(reset.dataset.settingsReset);
      return;
    }
    const nav = event.target.closest?.("[data-settings-category]");
    if (nav) {
      activateSettingsSection(nav.dataset.settingsCategory);
    }
  });

  els.settingsSearch?.addEventListener("input", () => {
    state.settingsQuery = els.settingsSearch.value;
    applySettingsSearch();
  });
  els.settingsSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.settingsSearch.value) {
      event.preventDefault();
      event.stopPropagation();
      els.settingsSearch.value = "";
      state.settingsQuery = "";
      applySettingsSearch();
    }
  });

  dialog.addEventListener("input", (event) => {
    const target = event.target;
    if (target === els.settingsSearch) return;
    if (!target.matches?.("input, select, textarea")) return;
    if (target.tagName === "SELECT" || target.type === "checkbox") return;
    state.settingsDirty = true;
    state.settingsRevision += 1;
    scheduleSettingsSave();
  });

  dialog.addEventListener("change", (event) => {
    const target = event.target;
    if (target === els.settingsSearch) return;
    if (!target.matches?.("select, input[type='checkbox']")) return;
    state.settingsDirty = true;
    state.settingsRevision += 1;
    saveSettingsNow();
  });

  // Enter flushes pending text/number edits without closing the dialog.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (!event.target.matches?.("input:not([type='checkbox']), select")) return;
    event.preventDefault();
    state.settingsDirty = true;
    state.settingsRevision += 1;
    saveSettingsNow();
  });

  // Escape is the native dialog close gesture; flush before letting it close.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSettings();
  });

  dialog.addEventListener("close", () => {
    if (state.savedIndicatorTimer) clearTimeout(state.savedIndicatorTimer);
    if (els.settingsSaved) els.settingsSaved.hidden = true;
    if (state.settingsDirty) saveSettingsNow();
  });
}

function wireEvents() {
  wirePaneResizer();
  // The editor sits inside the pane, and wheel events bubble, so one
  // listener on the pane covers the whole editing area.
  wireZoom(els.editorPane);
  els.openRepository.addEventListener("click", chooseRepository);
  els.emptyOpen.addEventListener("click", () => {
    if (state.repository) createItem(targetFolder(), false, { fromEmpty: true });
    else chooseRepository();
  });

  els.maintenanceRescan?.addEventListener("click", rebuildSearchIndex);
  els.searchRescan?.addEventListener("click", rebuildSearchIndex);
  els.maintenanceClearRecents?.addEventListener("click", clearRecentRepositories);
  els.maintenanceResetAll?.addEventListener("click", resetAllSettings);
  els.settingUpdateCheck?.addEventListener("click", checkUpdatesNow);
  els.resetEditorZoom?.addEventListener("click", resetZoom);
  els.updateBannerDismiss?.addEventListener("click", () => {
    if (state.updateInfo.latestVersion) {
      dismissUpdate(state.updateInfo.latestVersion);
    }
    hideUpdateBanner();
  });
  els.updateBannerNotes?.addEventListener("click", async () => {
    const url = state.updateInfo.releaseUrl;
    if (!isAllowedReleaseUrl(url)) {
      setStatus("That update link could not be opened.");
      return;
    }
    try {
      await api.openUpdatePage(url);
    } catch (error) {
      setStatus(errText(error));
    }
  });

  els.settingsButton.addEventListener("click", openSettings);
  wireSettingsDialog();
  els.pinnedTitle.addEventListener("click", () => openLimitDialog("pinned"));
  els.recentTitle.addEventListener("click", () => openLimitDialog("recent"));
  els.limitForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveLimitFromForm();
  });
  els.limitCancel.addEventListener("click", () => els.limitDialog.close());
  els.chooseDefaultRepository.addEventListener("click", async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose the default repository",
    });
    if (selected) {
      state.settingsDraftRepository = selected;
      els.settingDefaultRepository.value = selected;
      state.settingsDirty = true;
      state.settingsRevision += 1;
      saveSettingsNow();
    }
  });
  els.useCurrentRepository.addEventListener("click", () => {
    if (!state.repository) {
      setStatus("No repository is open.");
      return;
    }
    state.settingsDraftRepository = state.repository.path;
    els.settingDefaultRepository.value = state.repository.path;
    state.settingsDirty = true;
    state.settingsRevision += 1;
    saveSettingsNow();
  });
  els.clearDefaultRepository.addEventListener("click", () => {
    state.settingsDraftRepository = null;
    els.settingDefaultRepository.value = "";
    state.settingsDirty = true;
    state.settingsRevision += 1;
    saveSettingsNow();
  });

  els.promptCancel.addEventListener("click", () => els.promptDialog.close("cancel"));
  els.tagsCancel.addEventListener("click", () => els.tagsDialog.close("cancel"));

  els.sortAlpha.addEventListener("click", () => sortAlphabetically(targetFolder()));
  els.newFile.addEventListener("click", () => createItem(targetFolder(), false));
  els.newFolder.addEventListener("click", () => createItem(targetFolder(), true));
  els.wrapToggle.addEventListener("click", toggleWrap);
  els.saveButton.addEventListener("click", saveCurrent);
  els.closeFile.addEventListener("click", () => {
    closeCurrentFile();
  });
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
  els.editorPane.addEventListener("contextmenu", (event) => {
    if (!state.currentFile) return;
    event.preventDefault();
    showFileContextMenu(event.clientX, event.clientY);
  });
  els.brandButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleBrandPopover();
  });
  document.addEventListener("click", (event) => {
    if (els.brandPopover.hidden) return;
    if (els.brandPopover.contains(event.target)) return;
    hideBrandPopover();
  });
  els.treeFilter.addEventListener("input", () => {
    if (!featureOn("treeFilter") || !featureOn("treeFilter.input")) return;
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
    if (!featureOn("search") || !featureOn("search.toolbar")) return;
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
      if (featureOn("search") && featureOn("search.shortcut")) focusSearch();
    } else if (event.key === "Escape") {
      hideContextMenu();
      if (!els.searchResults.hidden) hideResults();
      else dismissNotice();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      if (state.currentFile) {
        event.preventDefault();
        saveCurrent();
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
      // The window is closed from the title bar, so this only closes the file.
      if (state.currentFile) {
        event.preventDefault();
        closeCurrentFile();
      }
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      // The editor handles its own history first and only lets this run once
      // that history is empty, so repository steps are undone from anywhere.
      const typing =
        els.treeFilter === document.activeElement ||
        els.search === document.activeElement ||
        els.promptInput === document.activeElement ||
        els.tagsInput === document.activeElement;
      if (typing) return;
      event.preventDefault();
      if (!featureOn("repositoryUndo") || !featureOn("repositoryUndo.shortcuts")) {
        return;
      }
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      const typing =
        els.treeFilter === document.activeElement ||
        els.search === document.activeElement;
      if (typing) return;
      event.preventDefault();
      if (!featureOn("repositoryUndo") || !featureOn("repositoryUndo.shortcuts")) {
        return;
      }
      redo();
    } else if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      // Screen readers and browsers use Ctrl+0 for "actual size" too.
      event.preventDefault();
      if (featureOn("zoom") && featureOn("zoom.resetShortcut")) resetZoom();
    }
  });
  window.addEventListener("resize", hideContextMenu);
  els.tree.addEventListener("scroll", hideContextMenu, true);

  const appWindow = getCurrentWindow();
  els.windowMinimize?.addEventListener("click", () => {
    appWindow.minimize().catch(() => {});
  });
  els.windowMaximize?.addEventListener("click", () => {
    appWindow.toggleMaximize().catch(() => {});
  });
  els.windowClose?.addEventListener("click", () => {
    appWindow.close().catch(() => {});
  });
  const syncMaximized = async () => {
    try {
      const maximized = await appWindow.isMaximized();
      document.body.classList.toggle("maximized", maximized);
      if (els.windowMaximize) {
        els.windowMaximize.title = maximized ? "Restore" : "Maximize";
        els.windowMaximize.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
        els.windowMaximize.classList.toggle("is-maximized", maximized);
      }
    } catch {
      /* window may be closing */
    }
  };
  appWindow.onResized(() => {
    syncMaximized();
  }).catch(() => {});
  syncMaximized();

  // The window has no native frame, so the edges are dragged by hand.
  for (const direction of [
    "North",
    "South",
    "East",
    "West",
    "NorthEast",
    "NorthWest",
    "SouthEast",
    "SouthWest",
  ]) {
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.dataset.resize = direction;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      appWindow.startResizeDragging(direction).catch(() => {});
    });
    document.body.append(handle);
  }

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

  listen("repository-changed", async (event) => {
    if (!state.repository) return;
    if (!featureOn("watcher")) return;
    const paths = event.payload?.paths ?? [];
    await loadTree();
    await refreshOrganization();
    if (!featureOn("watcher.autoReload")) return;
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

    const showNotice = featureOn("watcher.notice");
    if (state.dirty) {
      // Pausing again is idempotent; only warn when the message is not
      // already on screen, so a dismissed warning stays dismissed.
      state.autosavePaused = true;
      clearAutosave();
      const warning =
        "This file changed on disk. Your unsaved edits are kept; save when ready.";
      if (showNotice && (els.notice.hidden || els.noticeText.textContent !== warning)) {
        setNotice(warning, "warn");
      }
    } else {
      await reloadCurrent(true);
      if (showNotice) {
        setNotice("This file changed on disk and was reloaded.", "info");
      }
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
  configureRepositoryService();
  wireEvents();
  state.zoom = loadZoom();
  applyTheme();
  applySidebarWidth(loadSidebarWidth());
  applyFeatureVisibility();
  updateControls();
  updateStatusLeft();
  try {
    const snapshot = await api.bootstrap();
    applySnapshot(snapshot);
    await refreshOrganization();
    if (snapshot.notices?.length) {
      handleNotices(snapshot.notices);
    }
    state.updateInfo.currentVersion = state.version;
    state.updateInfo.lastChecked = readLastChecked();
    refreshSettingsDynamic();
    // Start the cached launch check immediately; it is never awaited here.
    void runLaunchUpdateCheck();
    await offerDesktopShortcut();
  } catch (error) {
    setStatus(errText(error));
    setNotice(errText(error), "warn");
  }
}

init();
