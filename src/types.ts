/**
 * Shapes exchanged with the Rust backend.
 *
 * Every struct below mirrors a `#[derive(Serialize, Deserialize)]` type in
 * `src-tauri/src` and the serde attributes there use camelCase, so the field
 * names here must match exactly: a mismatch is a silent runtime `undefined`,
 * not a build error on the Rust side. When a Rust struct changes, change this
 * file in the same commit.
 */

/** `Eol` in `encoding.rs` (serde: lowercase). */
export type Eol = "lf" | "crlf";

/** `RepositoryInfo` in `commands.rs`. */
export interface RepositoryInfo {
  path: string;
  name: string;
}

/** `RepositoryEntry` in `commands.rs`. */
export interface RepositoryEntry {
  path: string;
  name: string;
  exists: boolean;
}

/** `TreeNode` in `tree.rs`. `size` is -1 for folders. */
export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedMs: number | null;
  children: TreeNode[];
}

/** `ColorPair` in `settings.rs`. */
export interface ColorPair {
  icon?: string | null;
  label?: string | null;
}

/** `ColorRule` in `settings.rs`. */
export interface ColorRule {
  kind: string;
  target?: string;
  icon?: string | null;
  label?: string | null;
}

/** `Settings` in `settings.rs`. All fields are always present after `sanitize`. */
export interface Settings {
  theme: string;
  accent: string;
  contentBackground: string;
  accentAreas: string[];
  layoutMenuTitlebar: boolean;
  layoutStatusbar: boolean;
  layoutFileActions: boolean;
  fontFamily: string;
  fontSize: number;
  defaultSort: string;
  defaultRepository: string | null;
  tabWidth: number;
  pinnedLimit: number;
  recentLimit: number;
  autosaveEnabled: boolean;
  autosaveIdleSecs: number;
  revisionHourly: number;
  revisionDaily: number;
  revisionWeekly: number;
  revisionMonthly: number;
  revisionYearly: number;
  desktopShortcutPrompted: boolean;
  disabledFeatures: string[];
  recentRepositories: string[];
  lastRepository: string | null;
  recentRepositoryLimit: number;
  colorIcons: boolean;
  colorRules: ColorRule[];
  colorOverrides: Record<string, ColorPair>;
}

/** `TagCount` in `index.rs`. */
export interface TagCount {
  tag: string;
  count: number;
}

/** `Organization` in `commands.rs`. */
export interface Organization {
  tags: Record<string, string[]>;
  tagCounts: TagCount[];
  pins: string[];
  recents: string[];
}

/** `Snapshot` in `commands.rs`; returned by `bootstrap` and `open_repository`. */
export interface Snapshot {
  version: string;
  settings: Settings;
  repository: RepositoryInfo | null;
  recentRepositories: RepositoryEntry[];
  tree: TreeNode[];
  notices: string[];
}

/** `FileRead` in `repository.rs`. */
export interface FileRead {
  path: string;
  name: string;
  content: string;
  encoding: string;
  encodingLabel: string;
  eol: Eol;
  eolLabel: string;
  size: number;
  modifiedMs: number;
  readOnly: boolean;
  external: boolean;
  notice: string | null;
}

/** `SaveOutcome` in `repository.rs`. */
export interface SaveOutcome {
  size: number;
  modifiedMs: number;
}

/** `CreatedItem` in `repository.rs`. */
export interface CreatedItem {
  path: string;
  isDir: boolean;
}

/** `RevisionInfo` in `revisions.rs`. */
export interface RevisionInfo {
  id: string;
  modifiedMs: number;
  size: number;
}

/** `SearchHit` in `index.rs`. `line` is null for a file-name match. */
export interface SearchHit {
  path: string;
  name: string;
  line: number | null;
  lineText: string;
}

/** `UndoState` in `undo.rs`. */
export interface UndoState {
  undoLabel: string | null;
  redoLabel: string | null;
}

/** `DesktopShortcutStatus` in `desktop.rs`. */
export interface DesktopShortcutStatus {
  supported: boolean;
  exists: boolean;
  prompted: boolean;
}
