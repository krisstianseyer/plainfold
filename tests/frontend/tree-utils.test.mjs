import test from "node:test";
import assert from "node:assert/strict";

import {
  basename,
  countFiles,
  filterTree,
  findNode,
  flattenTree,
  formatBytes,
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

test("formatBytes is compact and stable", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(10 * 1024), "10 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
