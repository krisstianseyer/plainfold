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

export function isPathWithin(path, ancestor) {
  return path === ancestor || path.startsWith(`${ancestor}/`);
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

function globToRegExp(pattern) {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "i");
}

export function matchesTreeQuery(node, query) {
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

export function filterTreeByQuery(tree, query) {
  if (!query.trim()) return tree;
  const walk = (nodes) =>
    nodes
      .map((node) => {
        if (node.isDir) {
          if (matchesTreeQuery(node, query)) {
            return { ...node, children: node.children ?? [] };
          }
          const children = walk(node.children ?? []);
          return children.length ? { ...node, children } : null;
        }
        return matchesTreeQuery(node, query) ? { ...node, children: [] } : null;
      })
      .filter(Boolean);
  return walk(tree);
}

export function formatBytes(size) {  if (!Number.isFinite(size) || size < 0) return "";
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
export function contentChangedSince(diskText, knownText) {
  if (diskText === null || diskText === undefined) return true;
  if (knownText === null || knownText === undefined) return true;
  return diskText !== knownText;
}
