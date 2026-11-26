import { invoke } from "@tauri-apps/api/core";
import type {
  CreatedItem,
  DesktopShortcutStatus,
  Eol,
  FileRead,
  Organization,
  RepositoryEntry,
  RevisionInfo,
  SaveOutcome,
  SearchHit,
  Settings,
  Snapshot,
  TreeNode,
  UndoState,
} from "./types.ts";

/** Every backend call goes through this module. The only network request is
 *  the optional update check in updater.js; no IPC call here uses the network. */
export const api = {
  bootstrap: (): Promise<Snapshot> => invoke<Snapshot>("bootstrap"),
  openRepository: (path: string): Promise<Snapshot> =>
    invoke<Snapshot>("open_repository", { path }),
  listTree: (): Promise<TreeNode[]> => invoke<TreeNode[]>("list_tree"),
  readFile: (path: string): Promise<FileRead> =>
    invoke<FileRead>("read_file", { path }),
  openExternal: (path: string): Promise<void> =>
    invoke<void>("open_external", { path }),
  openUpdatePage: (url: string): Promise<void> =>
    invoke<void>("open_update_page", { url }),
  openSupportPage: (): Promise<void> => invoke<void>("open_support_page"),
  listRevisions: (path: string): Promise<RevisionInfo[]> =>
    invoke<RevisionInfo[]>("list_revisions", { path }),
  restoreRevision: (path: string, id: string): Promise<void> =>
    invoke<void>("restore_revision", { path, id }),
  saveFile: (
    path: string,
    content: string,
    encoding: string,
    eol: Eol,
  ): Promise<SaveOutcome> =>
    invoke<SaveOutcome>("save_file", { path, content, encoding, eol }),
  createItem: (
    parent: string,
    name: string,
    isDir: boolean,
  ): Promise<CreatedItem> =>
    invoke<CreatedItem>("create_item", { parent, name, isDir }),
  moveItem: (source: string, targetParent: string): Promise<string> =>
    invoke<string>("move_item", { source, targetParent }),
  deleteItem: (path: string): Promise<void> =>
    invoke<void>("delete_item", { path }),
  search: (query: string): Promise<SearchHit[]> =>
    invoke<SearchHit[]>("search", { query }),
  rescan: (): Promise<number> => invoke<number>("rescan"),
  getOrganization: (): Promise<Organization> =>
    invoke<Organization>("get_organization"),
  removeRecent: (path: string): Promise<void> =>
    invoke<void>("remove_recent", { path }),
  removeRecentRepository: (path: string): Promise<RepositoryEntry[]> =>
    invoke<RepositoryEntry[]>("remove_recent_repository", { path }),
  setTags: (path: string, tags: string[]): Promise<string[]> =>
    invoke<string[]>("set_tags", { path, tags }),
  setPin: (path: string, pinned: boolean): Promise<void> =>
    invoke<void>("set_pin", { path, pinned }),
  setSortOrder: (parent: string, names: string[]): Promise<void> =>
    invoke<void>("set_sort_order", { parent, names }),
  desktopShortcutStatus: (): Promise<DesktopShortcutStatus> =>
    invoke<DesktopShortcutStatus>("desktop_shortcut_status"),
  resolveDesktopShortcut: (create: boolean): Promise<DesktopShortcutStatus> =>
    invoke<DesktopShortcutStatus>("resolve_desktop_shortcut", { create }),
  saveSettings: (settings: Settings): Promise<Settings> =>
    invoke<Settings>("save_settings", { settings }),
  undoState: (): Promise<UndoState> => invoke<UndoState>("undo_state"),
  undo: (): Promise<string> => invoke<string>("undo"),
  redo: (): Promise<string> => invoke<string>("redo"),
};
