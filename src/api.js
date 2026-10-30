import { invoke } from "@tauri-apps/api/core";

/** Every backend call goes through this module; no network access exists. */
export const api = {
  bootstrap: () => invoke("bootstrap"),
  openRepository: (path) => invoke("open_repository", { path }),
  listTree: () => invoke("list_tree"),
  readFile: (path) => invoke("read_file", { path }),
  openExternal: (path) => invoke("open_external", { path }),
  listRevisions: (path) => invoke("list_revisions", { path }),
  restoreRevision: (path, id) => invoke("restore_revision", { path, id }),
  saveFile: (path, content, encoding, eol) =>
    invoke("save_file", { path, content, encoding, eol }),
  createItem: (parent, name, isDir) =>
    invoke("create_item", { parent, name, isDir }),
  moveItem: (source, targetParent) =>
    invoke("move_item", { source, targetParent }),
  deleteItem: (path) => invoke("delete_item", { path }),
  search: (query) => invoke("search", { query }),
  rescan: () => invoke("rescan"),
  getOrganization: () => invoke("get_organization"),
  removeRecent: (path) => invoke("remove_recent", { path }),
  removeRecentRepository: (path) =>
    invoke("remove_recent_repository", { path }),
  setTags: (path, tags) => invoke("set_tags", { path, tags }),
  setPin: (path, pinned) => invoke("set_pin", { path, pinned }),
  setSortOrder: (parent, names) => invoke("set_sort_order", { parent, names }),
  desktopShortcutStatus: () => invoke("desktop_shortcut_status"),
  resolveDesktopShortcut: (create) => invoke("resolve_desktop_shortcut", { create }),
  saveSettings: (settings) => invoke("save_settings", { settings }),
  undoState: () => invoke("undo_state"),
  undo: () => invoke("undo"),
  redo: () => invoke("redo"),
};
