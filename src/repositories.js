/**
 * Saved-repository rendering and switching.
 *
 * This module is a v1.2 foundation stub. The repositories feature owner will
 * replace the inert implementations below; callers can already import the
 * interface and call it defensively without throwing.
 */

export const REPOSITORY_LIMIT_MIN = 1;
export const REPOSITORY_LIMIT_MAX = 20;

/**
 * Converts snapshot/rpc entries into `{ path, name, exists }` objects.
 * Accepts plain path strings and partial objects, and never throws.
 */
export function normalizeRepositoryEntries(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of value) {
    const path = typeof item === "string" ? item : item?.path;
    if (typeof path !== "string" || !path || seen.has(path)) continue;
    seen.add(path);
    const fallbackName = path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
    entries.push({
      path,
      name:
        typeof item?.name === "string" && item.name ? item.name : fallbackName,
      exists: item?.exists !== false,
    });
  }
  return entries;
}

/** The inert repositories service. */
export const repositories = {
  configured: false,
  /** Render the sidebar Repositories section. */
  renderSidebar() {},
  /** Render the welcome-screen repository list. */
  renderWelcome() {},
  /** Render the saved-repositories list in Settings. */
  renderSettingsList() {},
  /** Switch to a saved repository; the feature owner implements this. */
  switchTo() {
    return false;
  },
  /** Remove a saved repository; the feature owner implements this. */
  removeRecent() {
    return false;
  },
  /** Clear the saved-repository list; the feature owner implements this. */
  clearRecent() {
    return false;
  },
};

/** Configure the repositories service. Inert until the feature lands. */
export function configureRepositories() {
  return false;
}

/** Re-render every repository list. Inert until the feature lands. */
export function renderRepositories() {}

/** Remove a saved repository. Returns false while the stub is inert. */
export function removeRecentRepository() {
  return false;
}

/** Open a saved repository. Returns false while the stub is inert. */
export function openRepositoryEntry() {
  return false;
}
