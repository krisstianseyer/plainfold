/**
 * Optional GitHub Releases update check.
 *
 * Plainfold only ever notifies. Nothing is downloaded, installed, or sent
 * anywhere else, and no request happens while `updateSourceConfigured()` is
 * false. The owner of the source edits UPDATE_OWNER/UPDATE_REPO to turn the
 * feature on.
 */

export const UPDATE_OWNER = "krisstianseyer";
export const UPDATE_REPO = "plainfold";
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
export const UPDATE_LAST_CHECK_KEY = "plainfold.update.lastCheck";
export const UPDATE_DISMISSED_KEY = "plainfold.update.dismissed";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_TIMEOUT_MS = 8000;

const PLACEHOLDER_OWNER = "your-github-user";
const GITHUB_API_HOST = "https://api.github.com";
const GITHUB_RELEASE_HOST = "https://github.com/";

const ERROR_NO_RELEASES = "No published releases were found.";
const ERROR_NOT_ALLOWED = "GitHub did not allow the check right now.";
const ERROR_UNREADABLE = "GitHub sent an unreadable response.";
const ERROR_NO_VERSION = "GitHub did not return a release version.";
const ERROR_UNREACHABLE = "GitHub could not be reached.";
const ERROR_TIMEOUT = "The update check timed out.";
const ERROR_CANCELLED = "The update check was cancelled.";
const ERROR_UNCONFIGURED =
  "Update checks are inactive until an update source is configured.";

/** True once a real GitHub owner/repository has been configured. */
export function updateSourceConfigured(
  owner = UPDATE_OWNER,
  repo = UPDATE_REPO
) {
  return Boolean(owner && repo && owner !== PLACEHOLDER_OWNER);
}

/** Human-readable source line for Settings > Updates and About. */
export function updateSourceLabel() {
  return updateSourceConfigured()
    ? `GitHub Releases (${UPDATE_OWNER}/${UPDATE_REPO})`
    : "GitHub Releases (not configured)";
}

/** Settings > Updates status line for the inert placeholder state. */
export function updateInactiveStatus() {
  return ERROR_UNCONFIGURED;
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

/** Plain display form of a release tag: "v1.2.0" becomes "1.2.0". */
function normalizeVersion(value) {
  return String(value ?? "")
    .trim()
    .replace(/^v/i, "");
}

function releaseApiUrl(owner, repo) {
  return `${GITHUB_API_HOST}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
}

/**
 * Optional source override exists only so tests can exercise the configured
 * path without editing the constants. The app never passes it.
 */
function resultFor(options, fields) {
  const owner = options?.owner ?? UPDATE_OWNER;
  const repo = options?.repo ?? UPDATE_REPO;
  return {
    configured: updateSourceConfigured(owner, repo),
    currentVersion: normalizeVersion(options?.currentVersion),
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    error: null,
    checkedAt: null,
    ...fields,
  };
}

function safeStorageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    /* localStorage can be unavailable or full; the check still works. */
  }
}

/** Milliseconds of the last launch check, or null when never recorded. */
export function readLastChecked() {
  const raw = Number(safeStorageGet(UPDATE_LAST_CHECK_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Version the user dismissed, or null. */
export function readDismissedVersion() {
  const value = safeStorageGet(UPDATE_DISMISSED_KEY);
  return value ? normalizeVersion(value) : null;
}

/** Remember a dismissed version so its banner is not shown again. */
export function dismissUpdate(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return;
  safeStorageSet(UPDATE_DISMISSED_KEY, normalized);
}

/** True when this exact release version was dismissed. */
export function isUpdateDismissed(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return false;
  return readDismissedVersion() === normalized;
}

/**
 * Check GitHub Releases for a newer version. Never throws for HTTP, network,
 * or JSON problems: those come back as a plain `error` string.
 */
export async function checkForUpdate({
  currentVersion = "",
  fetchImpl = globalThis.fetch,
  signal,
  owner = UPDATE_OWNER,
  repo = UPDATE_REPO,
} = {}) {
  const options = { currentVersion, owner, repo };
  if (!updateSourceConfigured(owner, repo)) {
    return resultFor(options, {});
  }

  if (typeof fetchImpl !== "function") {
    return resultFor(options, {
      error: ERROR_UNREACHABLE,
      checkedAt: Date.now(),
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  let removeExternalAbort = null;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPDATE_TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) controller.abort();
    else {
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      removeExternalAbort = () => signal.removeEventListener("abort", onAbort);
    }
  }

  const checkedAt = () => Date.now();

  try {
    const response = await fetchImpl(releaseApiUrl(owner, repo), {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      const status = Number(response?.status);
      let error;
      if (status === 404) error = ERROR_NO_RELEASES;
      else if (status === 403 || status === 429) error = ERROR_NOT_ALLOWED;
      else if (Number.isFinite(status) && status > 0) {
        error = `GitHub returned an error (HTTP ${status}).`;
      } else {
        error = ERROR_UNREACHABLE;
      }
      return resultFor(options, { error, checkedAt: checkedAt() });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return resultFor(options, {
        error: ERROR_UNREADABLE,
        checkedAt: checkedAt(),
      });
    }

    if (!payload || typeof payload !== "object") {
      return resultFor(options, {
        error: ERROR_UNREADABLE,
        checkedAt: checkedAt(),
      });
    }

    if (payload.draft === true || payload.prerelease === true) {
      // Drafts and prereleases are not offered to users of the stable line.
      return resultFor(options, { checkedAt: checkedAt() });
    }

    const latestVersion = normalizeVersion(payload.tag_name);
    if (!latestVersion) {
      return resultFor(options, {
        error: ERROR_NO_VERSION,
        checkedAt: checkedAt(),
      });
    }

    const releaseUrl =
      typeof payload.html_url === "string" && payload.html_url
        ? payload.html_url
        : null;

    return resultFor(options, {
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl,
      checkedAt: checkedAt(),
    });
  } catch (error) {
    let message = ERROR_UNREACHABLE;
    if (timedOut) message = ERROR_TIMEOUT;
    else if (signal?.aborted) message = ERROR_CANCELLED;
    else if (error?.name === "AbortError") message = ERROR_TIMEOUT;
    return resultFor(options, { error: message, checkedAt: checkedAt() });
  } finally {
    clearTimeout(timer);
    if (removeExternalAbort) removeExternalAbort();
  }
}

/** Remember when a check finished, including a manual Settings check. */
export function recordUpdateCheck(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  safeStorageSet(UPDATE_LAST_CHECK_KEY, value);
  return value;
}

/**
 * Launch check. Runs at most once per 24 hours using localStorage, and returns
 * null when it is skipped. The caller performs the feature guard and does not
 * await this during startup.
 */
export async function maybeCheckForUpdate({
  currentVersion = "",
  lastChecked,
  fetchImpl,
  owner = UPDATE_OWNER,
  repo = UPDATE_REPO,
} = {}) {
  if (!updateSourceConfigured(owner, repo)) return null;

  const previous = Number(lastChecked ?? readLastChecked());
  const now = Date.now();
  if (Number.isFinite(previous) && previous > 0 && now - previous < UPDATE_CHECK_INTERVAL_MS) {
    return null;
  }

  const result = await checkForUpdate({
    currentVersion,
    fetchImpl,
    owner,
    repo,
  });
  if (result.configured) {
    recordUpdateCheck(result.checkedAt ?? Date.now());
  }
  return result;
}

/** The release URL is opened by the backend; the front end never navigates. */
export function isAllowedReleaseUrl(url) {
  if (typeof url !== "string" || url.length > 2048) return false;
  return url.startsWith(GITHUB_RELEASE_HOST);
}
