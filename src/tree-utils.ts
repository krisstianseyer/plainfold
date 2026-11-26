import type { TreeNode } from "./types.ts";

/** Pure tree helpers, kept separate so they can be tested with node:test. */

export function basename(path: string): string {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export function parentOf(path: string): string {
  if (!path) return "";
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function isPathWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function flattenTree(tree: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

export function countFiles(tree: TreeNode[]): number {
  return flattenTree(tree).filter((node) => !node.isDir).length;
}

export function countFolders(tree: TreeNode[]): number {
  return flattenTree(tree).filter((node) => node.isDir).length;
}

export function findNode(tree: TreeNode[], path: string): TreeNode | null {
  return flattenTree(tree).find((node) => node.path === path) ?? null;
}

/** Keep only files whose path is in `paths`, plus their ancestor folders. */
export function filterTree(
  tree: TreeNode[],
  paths: Set<string> | readonly string[],
): TreeNode[] {
  const keep = paths instanceof Set ? paths : new Set(paths);
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node): TreeNode | null => {
        if (!node.isDir) return keep.has(node.path) ? { ...node, children: [] } : null;
        const children = walk(node.children ?? []);
        if (children.length === 0) return null;
        return { ...node, children };
      })
      .filter((node): node is TreeNode => node !== null);
  return walk(tree);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "i");
}

export function matchesTreeQuery(node: TreeNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (/[*?]/.test(needle)) {
    const pattern = globToRegExp(needle);
    return pattern.test(node.name.toLowerCase()) || pattern.test(node.path.toLowerCase());
  }
  return (
    node.name.toLowerCase().includes(needle) ||
    node.path.toLowerCase().includes(needle)
  );
}

export function filterTreeByQuery(tree: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return tree;
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node): TreeNode | null => {
        if (node.isDir) {
          if (matchesTreeQuery(node, query)) {
            return { ...node, children: node.children ?? [] };
          }
          const children = walk(node.children ?? []);
          return children.length ? { ...node, children } : null;
        }
        return matchesTreeQuery(node, query) ? { ...node, children: [] } : null;
      })
      .filter((node): node is TreeNode => node !== null);
  return walk(tree);
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

/** Paths of every folder, used to preserve expansion across refreshes. */
export function folderPaths(tree: TreeNode[]): string[] {
  return flattenTree(tree)
    .filter((node) => node.isDir)
    .map((node) => node.path);
}

/**
 * Decide whether an on-disk event means the open file really changed.
 *
 * File watchers fire for metadata touches too: sync clients, backup tools and
 * editors that rewrite a file just for reading it all produce events even
 * though the text is identical. Only a different text counts.
 *
 * Returns true when the file should be treated as changed. A null reading
 * means the file could not be read as text (removed, binary, unreadable), so
 * the event is honoured rather than silently dropped.
 */
export function contentChangedSince(
  diskText: string | null | undefined,
  knownText: string | null | undefined,
): boolean {
  if (diskText === null || diskText === undefined) return true;
  if (knownText === null || knownText === undefined) return true;
  return diskText !== knownText;
}
