/** Pure tree helpers, kept separate so they can be tested with node:test. */

export function basename(path) {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export function parentOf(path) {
  if (!path) return "";
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function flattenTree(tree) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

export function countFiles(tree) {
  return flattenTree(tree).filter((node) => !node.isDir).length;
}

export function findNode(tree, path) {
  return flattenTree(tree).find((node) => node.path === path) ?? null;
}

/** Keep only files whose path is in `paths`, plus their ancestor folders. */
export function filterTree(tree, paths) {
  const keep = paths instanceof Set ? paths : new Set(paths);
  const walk = (nodes) =>
    nodes
      .map((node) => {
        if (!node.isDir) return keep.has(node.path) ? { ...node, children: [] } : null;
        const children = walk(node.children ?? []);
        if (children.length === 0) return null;
        return { ...node, children };
      })
      .filter(Boolean);
  return walk(tree);
}

export function formatBytes(size) {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(ms) {
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
export function folderPaths(tree) {
  return flattenTree(tree)
    .filter((node) => node.isDir)
    .map((node) => node.path);
}
