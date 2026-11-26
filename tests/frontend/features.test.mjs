import test from "node:test";
import assert from "node:assert/strict";

import {
  FEATURE_CATEGORIES,
  FEATURE_CATEGORY_ORDER,
  FEATURE_CONTROLS,
  FEATURE_GROUPS,
  GROUP_LABELS,
  controlsForGroup,
  featureEnabled,
  groupOf,
  labelFor,
  labels,
} from "../../src/features.ts";

const EXPECTED_GROUPS = [
  "search",
  "treeFilter",
  "pinned",
  "recentFiles",
  "tags",
  "revisions",
  "autosave",
  "watcher",
  "repositoryUndo",
  "sortAndOrder",
  "createDelete",
  "wrap",
  "syntaxHighlighting",
  "editorStats",
  "repositoryCounts",
  "recentRepositories",
  "updates",
  "about",
  "desktopShortcut",
  "externalFiles",
];

const EXPECTED_CONTROLS = {
  search: ["search.toolbar", "search.shortcut", "search.results"],
  treeFilter: ["treeFilter.input"],
  pinned: ["pinned.section", "pinned.contextActions"],
  recentFiles: ["recentFiles.section", "recentFiles.removeAction"],
  tags: ["tags.filterBar", "tags.editor", "tags.contextAction"],
  revisions: ["revisions.contextAction", "revisions.settings"],
  autosave: ["autosave.engine", "autosave.settings"],
  watcher: ["watcher.autoReload", "watcher.notice"],
  repositoryUndo: ["repositoryUndo.buttons", "repositoryUndo.shortcuts"],
  sortAndOrder: [
    "sortAndOrder.sortButton",
    "sortAndOrder.dragReorder",
    "sortAndOrder.dragMove",
    "sortAndOrder.resetAction",
  ],
  createDelete: [
    "createDelete.newFile",
    "createDelete.newFolder",
    "createDelete.emptyNewFile",
    "createDelete.deleteAction",
  ],
  wrap: ["wrap.toggle"],
  syntaxHighlighting: ["syntaxHighlighting.editor"],
  editorStats: ["editorStats.statusWords"],
  repositoryCounts: ["repositoryCounts.statusCounts"],
  recentRepositories: [
    "recentRepositories.section",
    "recentRepositories.welcomeList",
    "recentRepositories.removeAction",
  ],
  updates: ["updates.autoCheck", "updates.banner", "updates.settingsSection"],
  about: ["about.brand", "about.version", "about.githubLink", "about.supportLink"],
  desktopShortcut: ["desktopShortcut.firstRunPrompt"],
  externalFiles: ["externalFiles.openDefaultApp"],
};

test("the registry has exactly the specified advanced controls", () => {
  for (const group of FEATURE_GROUPS) {
    assert.deepEqual(
      group.controls.map((control) => control.id),
      EXPECTED_CONTROLS[group.id],
      `controls for ${group.id}`
    );
  }
  assert.equal(
    FEATURE_CONTROLS.length,
    Object.values(EXPECTED_CONTROLS).flat().length
  );
});

test("the registry has exactly the 20 specified groups", () => {
  assert.equal(FEATURE_GROUPS.length, 20);
  assert.deepEqual(
    FEATURE_GROUPS.map((group) => group.id).sort(),
    [...EXPECTED_GROUPS].sort()
  );
});

test("group ids are unique and have labels and descriptions", () => {
  const ids = new Set();
  for (const group of FEATURE_GROUPS) {
    assert.match(group.id, /^[a-z][A-Za-z]*$/);
    assert.ok(!ids.has(group.id), `duplicate group ${group.id}`);
    ids.add(group.id);
    assert.ok(group.label.length > 0);
    assert.ok(group.description.length > 0);
    assert.equal(GROUP_LABELS[group.id], group.label);
  }
});

test("control ids are unique, valid, and belong to their group", () => {
  const ids = new Set();
  for (const control of FEATURE_CONTROLS) {
    assert.match(control.id, /^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/);
    assert.ok(!ids.has(control.id), `duplicate control ${control.id}`);
    ids.add(control.id);
    assert.ok(control.group, `missing group on ${control.id}`);
    assert.ok(
      control.id.startsWith(`${control.group}.`),
      `${control.id} should start with ${control.group}.`
    );
    assert.ok(control.label.length > 0);
    assert.ok(control.description.length > 0);
    assert.equal(groupOf(control.id), control.group);
    assert.ok(
      controlsForGroup(control.group).some((item) => item.id === control.id),
      `${control.id} not in its group's controls`
    );
  }
});

test("the flat control list matches the controls nested in groups", () => {
  const nested = FEATURE_GROUPS.flatMap((group) =>
    group.controls.map((control) => `${group.id}:${control.id}`)
  );
  const flat = FEATURE_CONTROLS.map((control) => `${control.group}:${control.id}`);
  assert.deepEqual(flat.sort(), nested.sort());
});

test("every group maps to a Features category", () => {
  assert.deepEqual(FEATURE_CATEGORY_ORDER, ["Browsing", "Editing", "Application"]);
  for (const group of FEATURE_GROUPS) {
    assert.ok(
      FEATURE_CATEGORY_ORDER.includes(FEATURE_CATEGORIES[group.id]),
      `missing category for ${group.id}`
    );
  }
  assert.equal(Object.keys(FEATURE_CATEGORIES).length, FEATURE_GROUPS.length);
});

test("labels cover every group and control and fall back safely", () => {
  for (const group of FEATURE_GROUPS) {
    assert.equal(labels[group.id], group.label);
    assert.equal(labels(group.id), group.label);
  }
  for (const control of FEATURE_CONTROLS) {
    assert.equal(labels[control.id], control.label);
    assert.equal(labels(control.id), control.label);
    assert.equal(labelFor(control.id), control.label);
  }
  assert.equal(labelFor("not.a.real.feature"), "not.a.real.feature");
  assert.equal(labelFor(undefined), "");
});

test("features default on", () => {
  for (const group of FEATURE_GROUPS) {
    assert.equal(featureEnabled(group.id, []), true);
    assert.equal(featureEnabled(group.id, undefined), true);
    for (const control of group.controls) {
      assert.equal(featureEnabled(control.id, []), true);
      assert.equal(featureEnabled(control.id), true);
    }
  }
});

test("turning a group off disables all of its controls", () => {
  for (const group of FEATURE_GROUPS) {
    const disabled = [group.id];
    assert.equal(featureEnabled(group.id, disabled), false);
    for (const control of group.controls) {
      assert.equal(
        featureEnabled(control.id, disabled),
        false,
        `${control.id} should follow ${group.id}`
      );
    }
    for (const other of FEATURE_GROUPS) {
      if (other.id === group.id) continue;
      assert.equal(featureEnabled(other.id, disabled), true);
    }
  }
});

test("turning a control off leaves its group and siblings on", () => {
  for (const group of FEATURE_GROUPS) {
    for (const control of group.controls) {
      const disabled = [control.id];
      assert.equal(featureEnabled(control.id, disabled), false);
      assert.equal(featureEnabled(group.id, disabled), true);
      for (const sibling of group.controls) {
        if (sibling.id === control.id) continue;
        assert.equal(featureEnabled(sibling.id, disabled), true);
      }
    }
  }
});

test("unknown ids never throw and stay enabled", () => {
  assert.equal(featureEnabled("unknownFeature", []), true);
  assert.equal(featureEnabled("unknownFeature", ["other"]), true);
  assert.equal(featureEnabled("unknownFeature", ["unknownFeature"]), false);
  assert.equal(featureEnabled(undefined, []), true);
  assert.equal(featureEnabled(undefined, [undefined]), false);
  assert.equal(groupOf("unknownFeature"), null);
  assert.deepEqual(controlsForGroup("unknownFeature"), []);
  assert.deepEqual(controlsForGroup(undefined), []);
  assert.deepEqual(controlsForGroup("search").map((item) => item.id), [
    "search.toolbar",
    "search.shortcut",
    "search.results",
  ]);
});
