import { invoke } from "@tauri-apps/api/core";

/** Every backend call goes through this module; no network access exists. */
export const api = {
  bootstrap: () => invoke("bootstrap"),
  openVault: (path) => invoke("open_vault", { path }),
  listTree: () => invoke("list_tree"),
  readFile: (path) => invoke("read_file", { path }),
  saveFile: (path, content, encoding, eol) =>
    invoke("save_file", { path, content, encoding, eol }),
  createItem: (parent, name, isDir) =>
    invoke("create_item", { parent, name, isDir }),
  deleteItem: (path) => invoke("delete_item", { path }),
  search: (query) => invoke("search", { query }),
  rescan: () => invoke("rescan"),
  getOrganization: () => invoke("get_organization"),
  setTags: (path, tags) => invoke("set_tags", { path, tags }),
  setPin: (path, pinned) => invoke("set_pin", { path, pinned }),
  setSortOrder: (parent, names) => invoke("set_sort_order", { parent, names }),
  saveSettings: (settings) => invoke("save_settings", { settings }),
};
