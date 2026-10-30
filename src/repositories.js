/**
 * Saved-repository helpers, rendering, switching, and removal.
 *
 * The pure helpers are exported for tests. The `repositories` service is wired
 * from `main.js` with callbacks so this module never imports application state
 * or the Tauri API directly.
 */

export const REPOSITORY_LIMIT_MIN = 1;
export const REPOSITORY_LIMIT_MAX = 20;
export const REPOSITORY_LIMIT_DEFAULT = 8;
export const REPOSITORY_FEATURE = "recentRepositories";
export const REPOSITORY_REMOVE_FEATURE = "recentRepositories.removeAction";

/** Last path segment, used when the backend does not supply a name. */
export function repositoryFallbackName(path) {
  const text = String(path ?? "");
  // A drive root has no last segment; show the root itself rather than "C:".
  if (/^[A-Za-z]:[\\/]*$/.test(text) || text === "/") return text;
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

function windowsPath(path) {
  const text = String(path ?? "");
  // Canonical saved paths are absolute: drive roots and UNC shares are
  // Windows paths, POSIX paths stay case-sensitive.
  return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\");
}

/** Compare keys the same way the backend does: case-insensitive on Windows. */
export function repositoryPathKey(path) {
  const text = String(path ?? "");
  return windowsPath(text) ? text.toLowerCase() : text;
}

/** True when two paths point at the same saved repository. */
export function sameRepositoryPath(left, right) {
  let one = String(left ?? "");
  let two = String(right ?? "");
  // Ignore a trailing separator on normal paths, but leave drive roots and
  // the POSIX root intact.
  if (one.length > 3 && /[\\/]$/.test(one)) one = one.slice(0, -1);
  if (two.length > 3 && /[\\/]$/.test(two)) two = two.slice(0, -1);
  return repositoryPathKey(one) === repositoryPathKey(two);
}

/**
 * Converts snapshot/rpc entries into normalized `{ path, name, exists }`
 * objects. Accepts plain path strings and partial objects, deduplicates paths,
 * never throws, and treats a missing `exists` flag as present.
 */
export function normalizeRepositoryEntries(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of value) {
    const rawPath = typeof item === "string" ? item : item?.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) continue;
    const key = repositoryPathKey(rawPath);
    if (seen.has(key)) continue;
    seen.add(key);
    const rawName = typeof item?.name === "string" ? item.name.trim() : "";
    entries.push({
      path: rawPath,
      name: rawName || repositoryFallbackName(rawPath),
      exists: item?.exists !== false,
    });
  }
  return entries;
}

/** Clamp the saved-repository display limit to the agreed 1-20 range. */
export function clampRepositoryLimit(value, fallback = REPOSITORY_LIMIT_DEFAULT) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(
    REPOSITORY_LIMIT_MAX,
    Math.max(REPOSITORY_LIMIT_MIN, number)
  );
}

/** Keep at most `limit` rich entries, in their existing order. */
export function limitRepositoryEntries(entries, limit = REPOSITORY_LIMIT_DEFAULT) {
  const list = Array.isArray(entries) ? entries : [];
  return list.slice(0, clampRepositoryLimit(limit));
}

/**
 * Keep the rich metadata for paths the server still reports, in server order.
 * Used when a settings response refreshes the path list without `exists`.
 */
export function reconcileRepositoryEntries(entries, paths) {
  const rich = normalizeRepositoryEntries(entries);
  if (!Array.isArray(paths)) return rich;
  const byKey = new Map(rich.map((entry) => [repositoryPathKey(entry.path), entry]));
  const result = [];
  const seen = new Set();
  for (const raw of paths) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = repositoryPathKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(
      byKey.get(key) ?? {
        path: raw,
        name: repositoryFallbackName(raw),
        exists: true,
      }
    );
  }
  return result;
}

/** Find a saved entry by path, preserving rich metadata. */
export function findRepositoryEntry(entries, path) {
  const list = Array.isArray(entries) ? entries : [];
  return list.find((entry) => sameRepositoryPath(entry.path, path)) ?? null;
}

/** True when an entry is the currently open repository. */
export function repositoryEntryIsActive(entry, repository) {
  const entryPath = typeof entry === "string" ? entry : entry?.path;
  const repositoryPath =
    typeof repository === "string" ? repository : repository?.path;
  if (!entryPath || !repositoryPath) return false;
  return sameRepositoryPath(entryPath, repositoryPath);
}

/** Entries that may be removed: everything except the active repository. */
export function removableRepositoryEntries(entries, repository) {
  return normalizeRepositoryEntries(entries).filter(
    (entry) => !repositoryEntryIsActive(entry, repository)
  );
}

function errorMessage(error, fallback) {
  if (typeof error === "string" && error) return error;
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return fallback ?? "The operation could not be completed.";
}

/**
 * One saved-repository row. Entries are buttons. The remove control is a
 * sibling button so interactive elements are never nested.
 */
export function createRepositoryListItem(entry, options = {}) {
  const li = document.createElement("li");
  const active = Boolean(options.active);
  li.dataset.repositoryPath = entry.path;
  li.classList.toggle("active", active);
  li.classList.toggle("missing", entry.exists === false);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "repository-entry";
  button.dataset.repositoryPath = entry.path;
  button.title =
    entry.exists === false ? `${entry.path} (missing)` : entry.path;
  button.disabled = entry.exists === false;
  button.classList.toggle("active", active);
  button.classList.toggle("missing", entry.exists === false);
  if (active) button.setAttribute("aria-current", "true");

  const nameRow = document.createElement("span");
  nameRow.className = "repository-name-row";
  const name = document.createElement("span");
  name.className = "repository-name";
  name.textContent = entry.name;
  nameRow.append(name);
  if (entry.exists === false) {
    const missing = document.createElement("span");
    missing.className = "repository-missing";
    missing.textContent = "Missing";
    nameRow.append(missing);
  }
  if (active) {
    const badge = document.createElement("span");
    badge.className = "repository-active";
    badge.textContent = "Active";
    nameRow.append(badge);
  }
  const path = document.createElement("span");
  path.className = "repository-path";
  path.textContent = entry.path;
  button.append(nameRow, path);
  button.addEventListener("click", () => options.onActivate?.(entry));

  li.append(button);

  if (!active && options.canRemove !== false) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "repository-remove";
    remove.textContent = "×";
    remove.dataset.repositoryPath = entry.path;
    remove.title = `Remove ${entry.name} from saved repositories`;
    remove.setAttribute(
      "aria-label",
      `Remove ${entry.name} from saved repositories`
    );
    remove.dataset.feature = `${REPOSITORY_FEATURE} ${REPOSITORY_REMOVE_FEATURE}`;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onRemove?.(entry);
    });
    li.append(remove);
  }

  return li;
}

/** Render a list of rich entries into a `ul`. Empty wording is configurable. */
export function renderRepositoryList(list, entries, options = {}) {
  if (!list) return;
  list.textContent = "";
  const items = Array.isArray(entries) ? entries : [];
  if (!items.length) {
    if (!options.emptyText) return;
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = options.emptyText;
    list.append(empty);
    return;
  }
  for (const entry of items) {
    list.append(
      createRepositoryListItem(entry, {
        ...options,
        active: options.isActive?.(entry) ?? false,
      })
    );
  }
}

let dependencies = null;
let busy = false;

/** Wire the service from main.js. No application imports live in this module. */
export function configureRepositories(options) {
  dependencies = options && typeof options === "object" ? options : null;
  return repositories;
}

function state() {
  return dependencies?.getState?.() ?? null;
}

function activeRepository() {
  return state()?.repository ?? null;
}

function allEntries() {
  return normalizeRepositoryEntries(dependencies?.getEntries?.() ?? []);
}

function currentRepositoryList() {
  if (typeof document === "undefined") return null;
  return (
    document.activeElement?.closest?.(
      "#settings-repositories-list, #repository-list, #welcome-repositories"
    ) ?? null
  );
}

function focusEntry(path, preferredList = null) {
  if (!path || typeof document === "undefined") return false;
  for (const list of [
    preferredList,
    dependencies?.elements?.sidebar,
    dependencies?.elements?.welcome,
    dependencies?.elements?.settings,
  ]) {
    if (!list) continue;
    const buttons = list.querySelectorAll?.("button.repository-entry") ?? [];
    for (const button of buttons) {
      if (
        !button.disabled &&
        sameRepositoryPath(button.dataset.repositoryPath, path)
      ) {
        button.focus();
        return true;
      }
    }
  }
  return false;
}

function nextFocusPath(entries, path) {
  const index = entries.findIndex((entry) =>
    sameRepositoryPath(entry.path, path)
  );
  if (index === -1) return null;
  return (entries[index + 1] ?? entries[index - 1])?.path ?? null;
}

function setEntries(entries) {
  const normalized = normalizeRepositoryEntries(entries);
  dependencies?.setEntries?.(normalized);
  return normalized;
}

/**
 * Update the saved list from a `remove_recent_repository` response. Older
 * backends that return only a boolean fall back to filtering the old list.
 */
function applyRemovalResult(path, returned) {
  if (Array.isArray(returned)) return setEntries(returned);
  return setEntries(
    allEntries().filter((entry) => !sameRepositoryPath(entry.path, path))
  );
}

function listOptions() {
  return {
    isActive: (entry) => repositoryEntryIsActive(entry, activeRepository()),
    canRemove:
      Boolean(dependencies?.isFeatureOn?.(REPOSITORY_FEATURE)) &&
      Boolean(dependencies?.isFeatureOn?.(REPOSITORY_REMOVE_FEATURE)),
    onActivate: (entry) => repositories.switchTo(entry),
    onRemove: (entry) => repositories.removeRecent(entry),
  };
}

export const repositories = {
  get configured() {
    return Boolean(dependencies);
  },

  /** Every rich entry, including ones hidden by the display limit. */
  entries() {
    return allEntries();
  },

  /** The entries the sidebar and welcome screen show, capped by the limit. */
  savedEntries() {
    const provided = dependencies?.getSavedEntries?.();
    if (Array.isArray(provided)) return provided;
    return limitRepositoryEntries(
      allEntries(),
      dependencies?.getLimit?.() ?? REPOSITORY_LIMIT_DEFAULT
    );
  },

  renderSidebar() {
    if (!dependencies) return;
    renderRepositoryList(
      dependencies.elements?.sidebar,
      this.savedEntries(),
      {
        ...listOptions(),
        emptyText: "No saved repositories yet.",
      }
    );
  },

  renderWelcome() {
    if (!dependencies) return;
    // The welcome screen hides an empty list so the Open a folder button
    // stays the dominant action.
    renderRepositoryList(
      dependencies.elements?.welcome,
      this.savedEntries(),
      listOptions()
    );
  },

  renderSettingsList() {
    if (!dependencies) return;
    renderRepositoryList(
      dependencies.elements?.settings,
      this.savedEntries(),
      {
        ...listOptions(),
        emptyText: "No saved repositories yet.",
      }
    );
  },

  renderAll() {
    this.renderSidebar();
    this.renderWelcome();
    this.renderSettingsList();
  },

  /**
   * Switch through the normal activateRepository() flow: unsaved-changes
   * question, loading overlay, snapshot, organization refresh, notices.
   */
  async switchTo(entryOrPath) {
    if (!dependencies || busy) return false;
    const path =
      typeof entryOrPath === "string" ? entryOrPath : entryOrPath?.path;
    if (!path) return false;
    const entry = findRepositoryEntry(allEntries(), path);
    if (!entry) {
      dependencies.setStatus?.("That repository is no longer saved.");
      return false;
    }
    if (entry.exists === false) {
      dependencies.setStatus?.(`${entry.name} is missing at ${entry.path}.`);
      return false;
    }
    if (repositoryEntryIsActive(entry, activeRepository())) {
      dependencies.setStatus?.(`${entry.name} is already open.`);
      return false;
    }
    busy = true;
    try {
      const switched = await dependencies.activateRepository?.(entry.path);
      if (switched === false) return false;
      this.renderAll();
      return true;
    } finally {
      busy = false;
    }
  },

  /**
   * Remove one saved entry. Files are never touched, and the active entry is
   * refused here as well as by the backend.
   */
  async removeRecent(entryOrPath) {
    if (!dependencies || busy) return false;
    if (
      !dependencies.isFeatureOn?.(REPOSITORY_FEATURE) ||
      !dependencies.isFeatureOn?.(REPOSITORY_REMOVE_FEATURE)
    ) {
      return false;
    }
    const path =
      typeof entryOrPath === "string" ? entryOrPath : entryOrPath?.path;
    if (!path) return false;
    const entries = allEntries();
    const entry = findRepositoryEntry(entries, path);
    if (!entry) return false;
    if (repositoryEntryIsActive(entry, activeRepository())) {
      dependencies.setStatus?.(
        "Switch to another repository before removing this one."
      );
      return false;
    }

    const focusPath = nextFocusPath(this.savedEntries(), path);
    const focusList = currentRepositoryList();
    busy = true;
    try {
      const returned = await dependencies.removeRecentRepository?.(entry.path);
      applyRemovalResult(entry.path, returned);
      this.renderAll();
      dependencies.setStatus?.(
        `Removed ${entry.name} from saved repositories. No files were deleted.`
      );
      focusEntry(focusPath, focusList);
      return true;
    } catch (error) {
      // The backend may refuse if the repository became active in the
      // meantime; surface its message verbatim.
      dependencies.setStatus?.(
        errorMessage(error, "The saved repository could not be removed.")
      );
      this.renderAll();
      return false;
    } finally {
      busy = false;
    }
  },

  /**
   * Remove every saved entry except the active one, sequentially, through the
   * same backend command. Keeps the active repository saved.
   */
  async clearRecent() {
    if (!dependencies || busy) return false;
    const active = activeRepository();
    const removable = removableRepositoryEntries(allEntries(), active);
    if (!removable.length) {
      dependencies.setStatus?.(
        active
          ? "Only the active repository is saved; there is nothing to clear."
          : "There are no saved repositories to clear."
      );
      return false;
    }

    busy = true;
    let removed = 0;
    let failure = null;
    try {
      for (const entry of removable) {
        try {
          const returned = await dependencies.removeRecentRepository?.(entry.path);
          applyRemovalResult(entry.path, returned);
          removed += 1;
        } catch (error) {
          failure = errorMessage(
            error,
            "The saved repositories could not be cleared."
          );
          break;
        }
      }
    } finally {
      busy = false;
    }
    this.renderAll();

    if (failure) {
      dependencies.setStatus?.(
        `Removed ${removed} of ${removable.length} saved repositories. ${failure}`
      );
      return false;
    }
    const noun = `saved ${removed === 1 ? "repository" : "repositories"}`;
    if (active) {
      dependencies.setStatus?.(
        `Removed ${removed} ${noun}. ${active.name} stays saved; no files were deleted.`
      );
    } else {
      dependencies.setStatus?.(
        `Cleared ${removed} ${noun}. No files were deleted.`
      );
    }
    return true;
  },
};
