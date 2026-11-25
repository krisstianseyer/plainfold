import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_DISMISSED_KEY,
  UPDATE_LAST_CHECK_KEY,
  checkForUpdate,
  compareVersions,
  dismissUpdate,
  isUpdateDismissed,
  maybeCheckForUpdate,
  readDismissedVersion,
  readLastChecked,
  recordUpdateCheck,
  updateInactiveStatus,
  updateSourceConfigured,
} from "../../src/updater.js";

const OWNER = "octocat";
const REPO = "plainfold";
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

function installStorage() {
  const values = new Map();
  const storage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return storage;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function fetchDouble(response, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return response;
  };
}

function sourceOptions(extra = {}) {
  return { owner: OWNER, repo: REPO, currentVersion: "1.1.27", ...extra };
}

test("compareVersions compares numeric X.Y.Z parts", () => {
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("v1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.9.9", "1.10.0"), -1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.2", "1.2.1"), -1);
  assert.equal(compareVersions("1", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});

test("compareVersions ignores pre-release and build suffixes", () => {
  assert.equal(compareVersions("v1.3.0-beta.2", "1.3.0"), 0);
  assert.equal(compareVersions("1.3.0+build.7", "1.3.0"), 0);
  assert.equal(compareVersions("1.3.0-rc.1+meta", "1.2.9"), 1);
});

test("compareVersions treats missing or unreadable parts as zero", () => {
  assert.equal(compareVersions("", "0.0.0"), 0);
  assert.equal(compareVersions("1.x.3", "1.0.3"), 0);
  assert.equal(compareVersions("1.2.3.4", "1.2.3"), 1);
});

test("placeholder source is inert and makes no request", async () => {
  installStorage();
  let requested = false;
  const result = await checkForUpdate({
    currentVersion: "1.1.27",
    owner: "your-github-user",
    repo: "plainfold",
    fetchImpl: async () => {
      requested = true;
      throw new Error("network must not be used");
    },
  });

  assert.equal(requested, false);
  assert.equal(updateSourceConfigured("your-github-user", "plainfold"), false);
  assert.deepEqual(result, {
    configured: false,
    currentVersion: "1.1.27",
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    error: null,
    checkedAt: null,
  });
  assert.equal(updateInactiveStatus(), "Update checks are inactive until an update source is configured.");
});

test("configured check requests the GitHub latest-release endpoint", async () => {
  const calls = [];
  const result = await checkForUpdate(
    sourceOptions({
      fetchImpl: fetchDouble(
        jsonResponse({
          tag_name: "v1.2.0",
          html_url: "https://github.com/octocat/plainfold/releases/tag/v1.2.0",
          draft: false,
          prerelease: false,
        }),
        calls
      ),
    })
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, API_URL);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Accept, "application/vnd.github+json");
  assert.equal(calls[0].options.cache, "no-store");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.configured, true);
  assert.equal(result.currentVersion, "1.1.27");
  assert.equal(result.latestVersion, "1.2.0");
  assert.equal(result.updateAvailable, true);
  assert.equal(
    result.releaseUrl,
    "https://github.com/octocat/plainfold/releases/tag/v1.2.0"
  );
  assert.equal(result.error, null);
  assert.equal(typeof result.checkedAt, "number");
});

test("same latest version is not an update", async () => {
  const result = await checkForUpdate(
    sourceOptions({
      currentVersion: "v1.1.27",
      fetchImpl: fetchDouble(
        jsonResponse({ tag_name: "v1.1.27", html_url: "https://github.com/x/y" })
      ),
    })
  );

  assert.equal(result.latestVersion, "1.1.27");
  assert.equal(result.updateAvailable, false);
  assert.equal(result.error, null);
});

test("draft and prerelease releases are ignored", async () => {
  for (const flags of [{ draft: true }, { prerelease: true }]) {
    const result = await checkForUpdate(
      sourceOptions({
        fetchImpl: fetchDouble(
          jsonResponse({
            tag_name: "v9.9.9",
            html_url: "https://github.com/x/y",
            draft: false,
            prerelease: false,
            ...flags,
          })
        ),
      })
    );

    assert.equal(result.latestVersion, null);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.error, null);
  }
});

test("404 means there are no published releases", async () => {
  const result = await checkForUpdate(
    sourceOptions({
      fetchImpl: fetchDouble(jsonResponse({ message: "Not Found" }, 404)),
    })
  );

  assert.equal(result.error, "No published releases were found.");
  assert.equal(result.latestVersion, null);
  assert.equal(result.updateAvailable, false);
  assert.equal(typeof result.checkedAt, "number");
});

test("403 and 429 are reported as rate limiting without a raw HTTP code", async () => {
  for (const status of [403, 429]) {
    const result = await checkForUpdate(
      sourceOptions({ fetchImpl: fetchDouble(jsonResponse({}, status)) })
    );
    assert.equal(result.error, "GitHub did not allow the check right now.");
  }
});

test("other HTTP failures report the status", async () => {
  const result = await checkForUpdate(
    sourceOptions({ fetchImpl: fetchDouble(jsonResponse({}, 500)) })
  );
  assert.equal(result.error, "GitHub returned an error (HTTP 500).");
});

test("network failures never throw", async () => {
  const result = await checkForUpdate(
    sourceOptions({
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    })
  );
  assert.equal(result.error, "GitHub could not be reached.");
  assert.equal(result.updateAvailable, false);
});

test("aborted checks report a timeout-like error", async () => {
  const result = await checkForUpdate(
    sourceOptions({
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    })
  );
  assert.equal(result.error, "The update check timed out.");
});

test("an external abort is reported as cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await checkForUpdate(
    sourceOptions({
      signal: controller.signal,
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    })
  );
  assert.equal(result.error, "The update check was cancelled.");
});

test("unreadable JSON and missing tags return plain errors", async () => {
  const unreadable = await checkForUpdate(
    sourceOptions({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      }),
    })
  );
  assert.equal(unreadable.error, "GitHub sent an unreadable response.");

  const missingTag = await checkForUpdate(
    sourceOptions({ fetchImpl: fetchDouble(jsonResponse({ html_url: "https://github.com/x/y" })) })
  );
  assert.equal(missingTag.error, "GitHub did not return a release version.");
});

test("a missing fetch implementation is an error, not a crash", async () => {
  const result = await checkForUpdate(
    sourceOptions({ fetchImpl: null })
  );
  assert.equal(result.error, "GitHub could not be reached.");
});

test("maybeCheckForUpdate skips checks made within 24 hours", async () => {
  const storage = installStorage();
  const calls = [];
  const first = await maybeCheckForUpdate(
    sourceOptions({
      fetchImpl: fetchDouble(jsonResponse({ tag_name: "v1.2.0", html_url: "https://github.com/x/y" }), calls),
    })
  );

  assert.equal(calls.length, 1);
  assert.equal(first.latestVersion, "1.2.0");
  assert.equal(readLastChecked(), first.checkedAt);
  assert.equal(storage.getItem(UPDATE_LAST_CHECK_KEY), String(first.checkedAt));

  const second = await maybeCheckForUpdate(
    sourceOptions({
      lastChecked: Date.now(),
      fetchImpl: async () => {
        calls.push({ url: "should not run" });
        throw new Error("unexpected request");
      },
    })
  );
  assert.equal(second, null);
  assert.equal(calls.length, 1);
});

test("maybeCheckForUpdate checks again after 24 hours", async () => {
  installStorage();
  const stale = Date.now() - UPDATE_CHECK_INTERVAL_MS - 1000;
  let calls = 0;
  const result = await maybeCheckForUpdate(
    sourceOptions({
      lastChecked: stale,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ tag_name: "v1.2.0", html_url: "https://github.com/x/y" });
      },
    })
  );

  assert.equal(calls, 1);
  assert.equal(result.updateAvailable, true);
  assert.ok(readLastChecked() > stale);
});

test("maybeCheckForUpdate is inert with the placeholder source", async () => {
  installStorage();
  let calls = 0;
  const result = await maybeCheckForUpdate({
    currentVersion: "1.1.27",
    owner: "your-github-user",
    repo: "plainfold",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.equal(readLastChecked(), null);
});

test("a manual check timestamp is recorded for the next start", () => {
  const storage = installStorage();
  const stamp = 1_800_000_000_000;
  assert.equal(recordUpdateCheck(stamp), stamp);
  assert.equal(readLastChecked(), stamp);
  assert.equal(storage.getItem(UPDATE_LAST_CHECK_KEY), String(stamp));
  assert.equal(recordUpdateCheck(0), null);
  assert.equal(readLastChecked(), stamp);
});

test("dismissal stores and matches the version", () => {
  installStorage();
  assert.equal(readDismissedVersion(), null);
  assert.equal(isUpdateDismissed("1.2.0"), false);

  dismissUpdate("v1.2.0");
  assert.equal(readDismissedVersion(), "1.2.0");
  assert.equal(isUpdateDismissed("1.2.0"), true);
  assert.equal(isUpdateDismissed("v1.2.0"), true);
  assert.equal(isUpdateDismissed("1.3.0"), false);
  assert.equal(globalThis.localStorage.getItem(UPDATE_DISMISSED_KEY), "1.2.0");
});
