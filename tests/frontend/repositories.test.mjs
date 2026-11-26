import test from "node:test";
import assert from "node:assert/strict";

import {
  REPOSITORY_LIMIT_DEFAULT,
  clampRepositoryLimit,
  configureRepositories,
  findRepositoryEntry,
  limitRepositoryEntries,
  normalizeRepositoryEntries,
  reconcileRepositoryEntries,
  removableRepositoryEntries,
  repositories,
  repositoryEntryIsActive,
  repositoryFallbackName,
  repositoryLastAfterRemoval,
  sameRepositoryPath,
} from "../../src/repositories.ts";

test("normalizeRepositoryEntries accepts paths and partial objects", () => {
  const entries = normalizeRepositoryEntries([
    "C:\\Notes",
    { path: "D:\\Journal", name: "Journal", exists: true },
    { path: "E:\\Missing", name: "Missing", exists: false },
  ]);
  assert.deepEqual(entries, [
    { path: "C:\\Notes", name: "Notes", exists: true },
    { path: "D:\\Journal", name: "Journal", exists: true },
    { path: "E:\\Missing", name: "Missing", exists: false },
  ]);
});

test("normalizeRepositoryEntries fills names and missing exists flags", () => {
  const entries = normalizeRepositoryEntries([
    { path: "C:\\Users\\Krisstian\\Notes" },
    { path: "/home/krisstian/journal" },
    { path: "C:\\", name: "  " },
  ]);
  assert.deepEqual(entries, [
    { path: "C:\\Users\\Krisstian\\Notes", name: "Notes", exists: true },
    { path: "/home/krisstian/journal", name: "journal", exists: true },
    { path: "C:\\", name: "C:\\", exists: true },
  ]);
});

test("normalizeRepositoryEntries only treats an explicit false as missing", () => {
  const entries = normalizeRepositoryEntries([
    { path: "C:\\a", exists: false },
    { path: "C:\\b", exists: true },
    { path: "C:\\c" },
    { path: "C:\\d", exists: 0 },
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.exists),
    [false, true, true, true]
  );
});

test("normalizeRepositoryEntries deduplicates paths", () => {
  const entries = normalizeRepositoryEntries([
    "C:\\Notes",
    "C:\\Notes",
    { path: "c:\\notes", name: "Second" },
    "/home/krisstian/notes",
    "/home/krisstian/notes",
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["C:\\Notes", "/home/krisstian/notes"]
  );
});

test("normalizeRepositoryEntries skips invalid input and never throws", () => {
  assert.deepEqual(normalizeRepositoryEntries(undefined), []);
  assert.deepEqual(normalizeRepositoryEntries(null), []);
  assert.deepEqual(normalizeRepositoryEntries("C:\\Notes"), []);
  assert.deepEqual(
    normalizeRepositoryEntries([
      null,
      {},
      { path: "" },
      { path: 42 },
      "  ",
      "C:\\Notes",
    ]),
    [{ path: "C:\\Notes", name: "Notes", exists: true }]
  );
});

test("repositoryFallbackName uses the last path segment", () => {
  assert.equal(repositoryFallbackName("C:\\Notes"), "Notes");
  assert.equal(repositoryFallbackName("C:\\Notes\\"), "Notes");
  assert.equal(repositoryFallbackName("/home/krisstian/notes/"), "notes");
  assert.equal(repositoryFallbackName("Notes"), "Notes");
  assert.equal(repositoryFallbackName(""), "");
});

test("limitRepositoryEntries slices to the clamped limit", () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    path: `C:\\repo${index}`,
    name: `repo${index}`,
    exists: true,
  }));
  assert.equal(limitRepositoryEntries(entries, 3).length, 3);
  assert.deepEqual(
    limitRepositoryEntries(entries, 3).map((entry) => entry.name),
    ["repo0", "repo1", "repo2"]
  );
  assert.equal(limitRepositoryEntries(entries, 0).length, 1);
  assert.equal(limitRepositoryEntries(entries, 999).length, 20);
  assert.equal(limitRepositoryEntries(entries, 8).length, 8);
  assert.deepEqual(limitRepositoryEntries(undefined, 8), []);
});

test("limitRepositoryEntries preserves rich entry objects", () => {
  const entries = normalizeRepositoryEntries([
    { path: "C:\\Missing", name: "Missing", exists: false },
    { path: "C:\\Present", name: "Present", exists: true },
  ]);
  const limited = limitRepositoryEntries(entries, 1);
  assert.equal(limited.length, 1);
  assert.equal(limited[0].exists, false);
  assert.equal(limited[0].name, "Missing");
});

test("clampRepositoryLimit follows the 1-20 contract", () => {
  assert.equal(REPOSITORY_LIMIT_DEFAULT, 8);
  assert.equal(clampRepositoryLimit(undefined), 8);
  assert.equal(clampRepositoryLimit(null), 8);
  assert.equal(clampRepositoryLimit(""), 8);
  assert.equal(clampRepositoryLimit("nope"), 8);
  assert.equal(clampRepositoryLimit(-3), 1);
  assert.equal(clampRepositoryLimit(0), 1);
  assert.equal(clampRepositoryLimit(1), 1);
  assert.equal(clampRepositoryLimit("7.6"), 8);
  assert.equal(clampRepositoryLimit(20), 20);
  assert.equal(clampRepositoryLimit(99), 20);
  assert.equal(clampRepositoryLimit(4, 12), 4);
});

test("sameRepositoryPath tolerates separators and Windows casing", () => {
  assert.equal(sameRepositoryPath("C:\\Notes", "c:\\notes"), true);
  assert.equal(sameRepositoryPath("C:\\Notes\\", "C:\\Notes"), true);
  assert.equal(sameRepositoryPath("C:\\Notes", "D:\\Notes"), false);
  assert.equal(sameRepositoryPath("/home/krisstian/notes", "/home/krisstian/notes"), true);
  assert.equal(sameRepositoryPath("/home/krisstian/notes", "/home/krisstian/Notes"), false);
  assert.equal(sameRepositoryPath("", ""), true);
  assert.equal(sameRepositoryPath("C:\\", "C:\\"), true);
});

test("repositoryEntryIsActive detects the open repository", () => {
  const entry = { path: "C:\\Notes", name: "Notes", exists: true };
  assert.equal(repositoryEntryIsActive(entry, { path: "c:\\notes" }), true);
  assert.equal(repositoryEntryIsActive(entry, "C:\\Notes\\"), true);
  assert.equal(repositoryEntryIsActive(entry, { path: "C:\\Other" }), false);
  assert.equal(repositoryEntryIsActive(entry, null), false);
  assert.equal(repositoryEntryIsActive({ path: "" }, { path: "" }), false);
  assert.equal(repositoryEntryIsActive(null, { path: "C:\\Notes" }), false);
});

test("findRepositoryEntry matches rich entries by path", () => {
  const entries = normalizeRepositoryEntries([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: false },
  ]);
  assert.equal(findRepositoryEntry(entries, "c:\\two")?.name, "Two");
  assert.equal(findRepositoryEntry(entries, "C:\\Three"), null);
  assert.equal(findRepositoryEntry(undefined, "C:\\One"), null);
});

test("removableRepositoryEntries keeps the active entry", () => {
  const entries = normalizeRepositoryEntries([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: true },
    { path: "C:\\Three", name: "Three", exists: false },
  ]);
  assert.deepEqual(
    removableRepositoryEntries(entries, { path: "c:\\two" }).map(
      (entry) => entry.name
    ),
    ["One", "Three"]
  );
  assert.equal(removableRepositoryEntries(entries, null).length, 3);
  assert.deepEqual(removableRepositoryEntries(undefined, null), []);
});

test("repositoryLastAfterRemoval only moves when the last-opened entry goes", () => {
  const remaining = normalizeRepositoryEntries([{ path: "C:\\Two" }]);
  assert.equal(
    repositoryLastAfterRemoval(remaining, "C:\\Two", "C:\\One"),
    "C:\\Two"
  );
  assert.equal(
    repositoryLastAfterRemoval(remaining, "C:\\One", "C:\\One"),
    "C:\\Two"
  );
  assert.equal(repositoryLastAfterRemoval([], "C:\\One", "C:\\One"), null);
  assert.equal(repositoryLastAfterRemoval(remaining, null, "C:\\One"), null);
});

test("reconcileRepositoryEntries keeps metadata for paths still saved", () => {
  const previous = normalizeRepositoryEntries([
    { path: "C:\\One", name: "One", exists: false },
    { path: "C:\\Two", name: "Two", exists: true },
  ]);
  const reconciled = reconcileRepositoryEntries(previous, [
    "c:\\two",
    "C:\\Three",
  ]);
  assert.deepEqual(reconciled, [
    { path: "C:\\Two", name: "Two", exists: true },
    { path: "C:\\Three", name: "Three", exists: true },
  ]);
});

test("reconcileRepositoryEntries drops removed entries and dedupes paths", () => {
  const previous = normalizeRepositoryEntries([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: true },
  ]);
  const reconciled = reconcileRepositoryEntries(previous, [
    "C:\\Two",
    "C:\\Two",
    "C:\\Three",
  ]);
  assert.deepEqual(
    reconciled.map((entry) => entry.path),
    ["C:\\Two", "C:\\Three"]
  );
  // With no path list, the rich entries are returned untouched.
  assert.deepEqual(reconcileRepositoryEntries(previous, undefined), previous);
});

/* The service takes callbacks, so its removal/clear flow is testable without
   a DOM: rendering helpers simply no-op when no elements are configured. */

function wireTestService(
  initialEntries,
  { activePath = "C:\\One", featuresOn = () => true } = {}
) {
  let entries = normalizeRepositoryEntries(initialEntries);
  let active = activePath
    ? { path: activePath, name: repositoryFallbackName(activePath) }
    : null;
  const calls = { removed: [], activated: [], statuses: [] };
  configureRepositories({
    getState: () => ({ repository: active }),
    getEntries: () => entries,
    getSavedEntries: () => entries,
    setEntries: (next) => {
      entries = next;
    },
    getLimit: () => 20,
    isFeatureOn: featuresOn,
    activateRepository: async (path) => {
      calls.activated.push(path);
      active = { path, name: repositoryFallbackName(path) };
      return true;
    },
    removeRecentRepository: async (path) => {
      calls.removed.push(path);
      entries = entries.filter((entry) => !sameRepositoryPath(entry.path, path));
      return entries;
    },
    setStatus: (text) => calls.statuses.push(text),
    elements: {},
  });
  return {
    calls,
    entries: () => entries,
    setActive: (path) => {
      active = path ? { path, name: repositoryFallbackName(path) } : null;
    },
  };
}

test("the service refuses to remove the active repository", async () => {
  const harness = wireTestService([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: true },
  ]);
  const removed = await repositories.removeRecent("C:\\One");
  assert.equal(removed, false);
  assert.deepEqual(harness.calls.removed, []);
  assert.match(harness.calls.statuses.at(-1), /Switch to another repository/);
});

test("the service removes an inactive entry and keeps the returned rich list", async () => {
  const harness = wireTestService([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: true },
    { path: "C:\\Three", name: "Three", exists: false },
  ]);
  const removed = await repositories.removeRecent("C:\\Two");
  assert.equal(removed, true);
  assert.deepEqual(harness.calls.removed, ["C:\\Two"]);
  assert.deepEqual(
    harness.entries().map((entry) => entry.name),
    ["One", "Three"]
  );
  assert.equal(harness.entries()[1].exists, false);
  assert.match(harness.calls.statuses.at(-1), /No files were deleted/);
});

test("clearRecent removes every entry except the active one", async () => {
  const harness = wireTestService([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: true },
    { path: "C:\\Three", name: "Three", exists: true },
  ]);
  const cleared = await repositories.clearRecent();
  assert.equal(cleared, true);
  assert.deepEqual(harness.calls.removed, ["C:\\Two", "C:\\Three"]);
  assert.deepEqual(
    harness.entries().map((entry) => entry.name),
    ["One"]
  );
  assert.match(harness.calls.statuses.at(-1), /One stays saved/);
});

test("clearRecent removes all entries when no repository is active", async () => {
  const harness = wireTestService(
    [
      { path: "C:\\One", name: "One", exists: true },
      { path: "C:\\Two", name: "Two", exists: true },
    ],
    { activePath: null }
  );
  const cleared = await repositories.clearRecent();
  assert.equal(cleared, true);
  assert.deepEqual(harness.calls.removed, ["C:\\One", "C:\\Two"]);
  assert.deepEqual(harness.entries(), []);
  assert.match(harness.calls.statuses.at(-1), /Cleared 2/);
});

test("clearRecent is inert when saved-repository removal is turned off", async () => {
  const harness = wireTestService(
    [
      { path: "C:\\One", name: "One", exists: true },
      { path: "C:\\Two", name: "Two", exists: true },
    ],
    { featuresOn: (id) => id !== "recentRepositories.removeAction" }
  );
  assert.equal(await repositories.clearRecent(), false);
  assert.deepEqual(harness.calls.removed, []);
  assert.equal(harness.entries().length, 2);
});

test("switching a missing entry only reports a status", async () => {
  const harness = wireTestService(
    [{ path: "C:\\Missing", name: "Missing", exists: false }],
    { activePath: null }
  );
  assert.equal(await repositories.switchTo("C:\\Missing"), false);
  assert.deepEqual(harness.calls.activated, []);
  assert.match(harness.calls.statuses.at(-1), /missing/);
});

test("switching an existing entry activates it through the callback", async () => {
  const harness = wireTestService([
    { path: "C:\\One", name: "One", exists: true },
    { path: "C:\\Two", name: "Two", exists: true },
  ]);
  assert.equal(await repositories.switchTo("C:\\Two"), true);
  assert.deepEqual(harness.calls.activated, ["C:\\Two"]);
});

test("switching the active entry is a no-op", async () => {
  const harness = wireTestService([
    { path: "C:\\One", name: "One", exists: true },
  ]);
  assert.equal(await repositories.switchTo("C:\\One"), false);
  assert.deepEqual(harness.calls.activated, []);
  assert.match(harness.calls.statuses.at(-1), /already open/);
});

