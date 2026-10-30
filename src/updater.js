/**
 * Optional GitHub Releases update check.
 *
 * This module is a v1.2 foundation stub. `updateSourceConfigured()` stays
 * false while the owner placeholder is in place, so the app never performs
 * network requests and the update banner stays hidden. The update feature
 * owner will complete the launch check and banner rendering.
 */

export const UPDATE_OWNER = "your-github-user";
export const UPDATE_REPO = "plainfold";
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
export const UPDATE_LAST_CHECK_KEY = "plainfold.update.lastCheck";
export const UPDATE_DISMISSED_KEY = "plainfold.update.dismissed";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 8000;

/** True once a real GitHub owner/repository has been configured. */
export function updateSourceConfigured() {
  return Boolean(
    UPDATE_OWNER &&
      UPDATE_REPO &&
      UPDATE_OWNER !== "your-github-user"
  );
}

/** Human-readable source line for Settings > Updates and About. */
export function updateSourceLabel() {
  return updateSourceConfigured()
    ? `GitHub Releases (${UPDATE_OWNER}/${UPDATE_REPO})`
    : "GitHub Releases (not configured)";
}

function versionParts(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0];
  return text.split(".").map((part) => {
    const number = Number.parseInt(part, 10);
    return Number.isFinite(number) ? number : 0;
  });
}

/** Compare numeric X.Y.Z versions. Returns -1, 0, or 1. */
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const one = left[index] ?? 0;
    const two = right[index] ?? 0;
    if (one < two) return -1;
    if (one > two) return 1;
  }
  return 0;
}

/**
 * Inert update check. Returns the agreed result shape without touching the
 * network until the update source is configured by the feature owner.
 */
export async function checkForUpdate({ currentVersion = "" } = {}) {
  return {
    configured: updateSourceConfigured(),
    currentVersion: String(currentVersion ?? ""),
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    error: null,
  };
}

/** Launch check hook. The update feature owner implements the caching. */
export async function maybeCheckForUpdate() {
  return null;
}

/** Render the update banner. The update feature owner implements this. */
export function renderUpdateBanner() {}

/** Initialize the update checker. Inert until the feature lands. */
export function initUpdater() {}
