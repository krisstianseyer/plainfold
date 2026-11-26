import test from "node:test";
import assert from "node:assert/strict";

import {
  configureColors,
  normalizeColor,
  normalizeColorSettings,
  resolvePathColors,
  resolveRepositoryColors,
  resolveSectionColors,
} from "../../src/colors.ts";

configureColors({ basename: (path) => String(path).split("/").pop() ?? "" });

test("normalizeColor accepts hex and rejects everything else", () => {
  assert.equal(normalizeColor("#ABC"), "#abc");
  assert.equal(normalizeColor(" #3E63DD "), "#3e63dd");
  assert.equal(normalizeColor("#3e63ddff"), "#3e63ddff");
  assert.equal(normalizeColor("blue"), null);
  assert.equal(normalizeColor("#12345"), null);
  assert.equal(normalizeColor(null), null);
});

test("normalizeColorSettings keeps only usable rules", () => {
  const settings = normalizeColorSettings({
    colorRules: [
      { kind: "extension", target: ".MD", icon: "#FF0000" },
      { kind: "extension", target: "md", icon: "#00ff00", label: "#000000" },
      { kind: "bogus", target: "txt", icon: "#111111" },
      { kind: "extension", target: "", icon: "#222222" },
      { kind: "section", target: "Pinned", icon: "#333333" },
      { kind: "section", target: "nope" },
      { kind: "folder", target: "", label: "#444444" },
      { kind: "other", target: "", icon: "#555555" },
      { kind: "extension", target: "weird", icon: "red" },
    ],
    colorOverrides: {
      "notes/today.md": { icon: "#123456", label: null },
      "../outside.md": { icon: "#123456" },
      "/abs/path.md": { icon: "#123456" },
      "C:\\Windows\\x.md": { icon: "#123456" },
      "empty": { icon: null, label: null },
      "": { icon: "#abcdef" },
    },
  });

  assert.equal(settings.colorIcons, true);
  assert.deepEqual(
    settings.colorRules.map((rule) => `${rule.kind}:${rule.target}`),
    ["extension:md", "section:pinned", "folder:", "other:"]
  );
  assert.equal(settings.colorRules[0].icon, "#ff0000");
  assert.equal(settings.colorRules[0].label, null);
  assert.deepEqual(settings.colorOverrides, {
    "notes/today.md": { icon: "#123456", label: null },
  });
});

test("resolvePathColors prefers extension rules and falls back to other", () => {
  const settings = normalizeColorSettings({
    colorRules: [
      { kind: "extension", target: "md", icon: "#3e63dd" },
      { kind: "extension", target: "txt", icon: "#30a46c", label: "#111111" },
      { kind: "folder", icon: "#f2a93b" },
      { kind: "other", icon: "#6b7280" },
    ],
  });

  assert.deepEqual(resolvePathColors(settings, "notes/today.md", false), {
    icon: "#3e63dd",
    label: null,
  });
  assert.deepEqual(resolvePathColors(settings, "notes/a.txt", false), {
    icon: "#30a46c",
    label: "#111111",
  });
  assert.deepEqual(resolvePathColors(settings, "Makefile", false), {
    icon: "#6b7280",
    label: null,
  });
  assert.deepEqual(resolvePathColors(settings, "notes", true), {
    icon: "#f2a93b",
    label: null,
  });
});

test("overrides win per channel without erasing the group color", () => {
  const settings = normalizeColorSettings({
    colorRules: [{ kind: "extension", target: "md", icon: "#3e63dd", label: "#111111" }],
    colorOverrides: { "notes/today.md": { label: "#e5484d" } },
  });

  assert.deepEqual(resolvePathColors(settings, "notes/today.md", false), {
    icon: "#3e63dd",
    label: "#e5484d",
  });
  assert.deepEqual(resolvePathColors(settings, "notes/other.md", false), {
    icon: "#3e63dd",
    label: "#111111",
  });
});

test("section colors resolve independently and honor the master switch", () => {
  const settings = normalizeColorSettings({
    colorRules: [
      { kind: "section", target: "pinned", icon: "#f2a93b" },
      { kind: "section", target: "recent", label: "#3e63dd" },
    ],
  });

  assert.deepEqual(resolveSectionColors(settings, "pinned"), {
    icon: "#f2a93b",
    label: null,
  });
  assert.deepEqual(resolveSectionColors(settings, "recent"), {
    icon: null,
    label: "#3e63dd",
  });
  assert.deepEqual(resolveSectionColors(settings, "files"), { icon: null, label: null });

  settings.colorIcons = false;
  assert.deepEqual(resolveSectionColors(settings, "pinned"), { icon: null, label: null });
  assert.deepEqual(resolvePathColors(settings, "notes/today.md", false), {
    icon: null,
    label: null,
  });
});

test("repository and repositories-header colors resolve by path", () => {
  const settings = normalizeColorSettings({
    colorRules: [
      { kind: "repository", target: "C:\\Repos\\One", icon: "#e5484d" },
      { kind: "repository", target: "C:\\Repos\\One", icon: "#30a46c" },
      { kind: "repository", target: "   ", icon: "#30a46c" },
      { kind: "section", target: "repositories", icon: "#f2a93b" },
    ],
  });

  assert.equal(settings.colorRules.length, 2);
  assert.equal(
    settings.colorRules.filter((rule) => rule.kind === "repository").length,
    1
  );
  assert.deepEqual(resolveRepositoryColors(settings, "C:\\Repos\\One"), {
    icon: "#e5484d",
    label: null,
  });
  assert.deepEqual(resolveRepositoryColors(settings, "C:\\Repos\\Two"), {
    icon: null,
    label: null,
  });
  assert.deepEqual(resolveSectionColors(settings, "repositories"), {
    icon: "#f2a93b",
    label: null,
  });
});

test("multi-dot names use the last extension", () => {
  const settings = normalizeColorSettings({
    colorRules: [{ kind: "extension", target: "gz", icon: "#8fbf3f" }],
  });
  assert.deepEqual(resolvePathColors(settings, "archive.tar.gz", false), {
    icon: "#8fbf3f",
    label: null,
  });
});
