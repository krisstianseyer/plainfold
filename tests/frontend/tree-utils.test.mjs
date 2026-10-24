import test from "node:test";
import assert from "node:assert/strict";

import {
  basename,
  contentChangedSince,
  countFiles,
  filterTree,
  filterTreeByQuery,
  findNode,
  flattenTree,
  formatBytes,
  isPathWithin,
  parentOf,
} from "../../src/tree-utils.js";

const tree = [
  {
    name: "notes",
    path: "notes",
    isDir: true,
    children: [
      {
        name: "a.txt",
        path: "notes/a.txt",
        isDir: false,
        children: [],
      },
      {
        name: "deep",
        path: "notes/deep",
        isDir: true,
        children: [
          { name: "b.txt", path: "notes/deep/b.txt", isDir: false, children: [] },
        ],
      },
    ],
  },
  { name: "root.txt", path: "root.txt", isDir: false, children: [] },
];

test("basename and parentOf use vault separators", () => {
  assert.equal(basename("notes/deep/b.txt"), "b.txt");
  assert.equal(basename("root.txt"), "root.txt");
  assert.equal(parentOf("notes/deep/b.txt"), "notes/deep");
  assert.equal(parentOf("root.txt"), "");
});

test("flattenTree and countFiles walk every branch", () => {
  assert.equal(flattenTree(tree).length, 5);
  assert.equal(countFiles(tree), 3);
});

test("findNode returns a node or null", () => {
  assert.equal(findNode(tree, "notes/deep/b.txt").name, "b.txt");
  assert.equal(findNode(tree, "missing"), null);
});

test("filterTree keeps matches and only their ancestors", () => {
  const filtered = filterTree(tree, new Set(["notes/deep/b.txt"]));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].path, "notes");
  assert.equal(filtered[0].children.length, 1);
  assert.equal(filtered[0].children[0].path, "notes/deep");
  assert.equal(filtered[0].children[0].children[0].path, "notes/deep/b.txt");
});

test("filterTree can return nothing", () => {
  assert.deepEqual(filterTree(tree, new Set()), []);
});

test("filterTreeByQuery includes matching folders and their descendants", () => {
  const folder = filterTreeByQuery(tree, "deep");
  assert.equal(folder.length, 1);
  assert.equal(folder[0].path, "notes");
  assert.equal(folder[0].children[0].path, "notes/deep");
  assert.equal(folder[0].children[0].children[0].path, "notes/deep/b.txt");

  const fullFolder = filterTreeByQuery(tree, "notes");
  assert.equal(fullFolder[0].path, "notes");
  assert.equal(fullFolder[0].children.length, 2);

  const file = filterTreeByQuery(tree, "b.txt");
  assert.equal(file[0].children[0].children[0].path, "notes/deep/b.txt");
});

test("filterTreeByQuery supports glob wildcards", () => {
  const txt = flattenTree(filterTreeByQuery(tree, "*.txt"));
  assert.deepEqual(
    txt.filter((node) => !node.isDir).map((node) => node.path),
    ["notes/a.txt", "notes/deep/b.txt", "root.txt"]
  );
  assert.equal(filterTreeByQuery(tree, "*.jpg").length, 0);
  assert.equal(filterTreeByQuery(tree, "*eep")[0].children[0].path, "notes/deep");
});

test("isPathWithin checks exact and descendant paths", () => {
  assert.equal(isPathWithin("notes", "notes"), true);
  assert.equal(isPathWithin("notes/deep/b.txt", "notes"), true);
  assert.equal(isPathWithin("notes2/b.txt", "notes"), false);
});

test("formatBytes is compact and stable", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(10 * 1024), "10 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("contentChangedSince ignores metadata-only touches", () => {
  // A sync client or backup tool touching the file changes the mtime but
  // not the text; that must not be reported as a change.
  assert.equal(contentChangedSince("same\n", "same\n"), false);
  // Real edits are reported.
  assert.equal(contentChangedSince("new\n", "old\n"), true);
  // Whitespace-only differences are real changes to the text.
  assert.equal(contentChangedSince("a\n", "a"), true);
  // An unreadable or non-text file is honoured rather than dropped.
  assert.equal(contentChangedSince(null, "old\n"), true);
  assert.equal(contentChangedSince(undefined, "old\n"), true);
  // An empty file that stays empty is not a change.
  assert.equal(contentChangedSince("", ""), false);
  // An empty file that gains text is.
  assert.equal(contentChangedSince("text", ""), true);
});
