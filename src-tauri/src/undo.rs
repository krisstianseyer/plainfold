use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::paths::Repository;

/// How many file-system steps Plainfold remembers for Undo.
pub const LIMIT: usize = 100;

/// A copy of a deleted file or folder, kept outside the repository until the undo
/// window closes so the deletion itself can be reversed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedEntry {
    pub path: String,
    pub backup: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UndoAction {
    RestoreTrash { entries: Vec<TrashedEntry> },
    Move { from: String, to: String },
    Create { path: String, is_dir: bool },
    Save { path: String, content: String },
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    /// What Undo would reverse, or None when there is nothing to undo.
    pub undo_label: Option<String>,
    /// What Redo would repeat, or None when there is nothing to redo.
    pub redo_label: Option<String>,
}

struct Entry {
    label: String,
    action: UndoAction,
}

/// History of reversible repository steps. The open file's text is undone inside
/// the editor, so this covers file-system steps only.
#[derive(Default)]
pub struct History {
    stack: Vec<Entry>,
    redo: Vec<Entry>,
}

impl History {
    pub fn reset(&mut self) {
        self.stack.clear();
        self.redo.clear();
    }

    pub fn push(&mut self, label: String, action: UndoAction) {
        self.redo.clear();
        self.push_undo(label, action);
    }

    pub fn push_undo(&mut self, label: String, action: UndoAction) {
        self.stack.push(Entry { label, action });
        if self.stack.len() > LIMIT {
            self.stack.remove(0);
        }
    }

    pub fn push_redo(&mut self, label: String, action: UndoAction) {
        self.redo.push(Entry { label, action });
        if self.redo.len() > LIMIT {
            self.redo.remove(0);
        }
    }

    pub fn peek_undo(&self) -> Option<(&str, &UndoAction)> {
        self.stack
            .last()
            .map(|entry| (entry.label.as_str(), &entry.action))
    }

    pub fn pop_undo(&mut self) -> Option<(String, UndoAction)> {
        self.stack.pop().map(|entry| (entry.label, entry.action))
    }

    pub fn pop_redo(&mut self) -> Option<(String, UndoAction)> {
        self.redo.pop().map(|entry| (entry.label, entry.action))
    }

    pub fn state(&self) -> UndoState {
        UndoState {
            undo_label: self.stack.last().map(|entry| entry.label.clone()),
            redo_label: self.redo.last().map(|entry| entry.label.clone()),
        }
    }
}

/// Copy an item out of the repository before it is deleted. Folders are copied
/// whole, without following symbolic links.
pub fn capture(backup_root: &Path, relative: &str, absolute: &Path) -> AppResult<TrashedEntry> {
    let metadata = std::fs::symlink_metadata(absolute)
        .map_err(|_| AppError::new("The item no longer exists."))?;
    std::fs::create_dir_all(backup_root)
        .map_err(|_| AppError::new("The item could not be kept for undo."))?;

    let mut slot = backup_root.join(sanitize(relative));
    if let Some(parent) = slot.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| AppError::new("The item could not be kept for undo."))?;
    }
    let mut index = 1;
    let stem = slot.clone();
    while std::fs::symlink_metadata(&slot).is_ok() {
        slot = stem.with_file_name(format!(
            "{}.{index}",
            stem.file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default()
        ));
        index += 1;
    }

    copy_tree(absolute, &slot)?;
    Ok(TrashedEntry {
        path: relative.to_string(),
        backup: slot.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
    })
}

fn copy_tree(source: &Path, target: &Path) -> AppResult<()> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|_| AppError::new("The item could not be kept for undo."))?;
    if metadata.file_type().is_symlink() {
        // Links are recorded as plain files so restoring never follows them.
        std::fs::write(target, b"")
            .map_err(|_| AppError::new("The item could not be kept for undo."))?;
        return Ok(());
    }
    if metadata.is_dir() {
        std::fs::create_dir_all(target)
            .map_err(|_| AppError::new("The item could not be kept for undo."))?;
        let entries = std::fs::read_dir(source)
            .map_err(|_| AppError::new("The item could not be kept for undo."))?;
        for entry in entries.flatten() {
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }
    std::fs::copy(source, target)
        .map_err(|_| AppError::new("The item could not be kept for undo."))?;
    Ok(())
}

fn sanitize(relative: &str) -> String {
    relative.replace(['/', '\\'], "__")
}

/// Put a kept copy back in the repository. An occupied path gets a numbered name
/// instead of overwriting anything.
pub fn restore(repository: &Repository, entry: &TrashedEntry) -> AppResult<String> {
    let backup = PathBuf::from(&entry.backup);
    if std::fs::symlink_metadata(&backup).is_err() {
        return Err(AppError::new("The undo copy is no longer available."));
    }
    let relative = crate::paths::normalize_relative(&entry.path)?;
    let target = free_name(&repository.root().join(relative));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| AppError::new("The folder for that item could not be recreated."))?;
    }
    copy_tree(&backup, &target)?;
    Ok(crate::paths::relative_to(repository.root(), &target).unwrap_or_else(|| entry.path.clone()))
}

fn free_name(target: &Path) -> PathBuf {
    if std::fs::symlink_metadata(target).is_err() {
        return target.to_path_buf();
    }
    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name.as_str(), ""),
    };
    let mut index = 1;
    loop {
        let candidate = target.with_file_name(format!("{stem} ({index}){extension}"));
        if std::fs::symlink_metadata(&candidate).is_err() {
            return candidate;
        }
        index += 1;
    }
}

/// Remove undo copies that have outlived their window.
pub fn prune(backup_root: &Path, older_than: std::time::Duration) {
    let Ok(entries) = std::fs::read_dir(backup_root) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default() < older_than {
            continue;
        }
        let path = entry.path();
        let _ = if metadata.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backup_of(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("backup")
    }

    #[test]
    fn copies_restore_to_their_original_path() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let backup = backup_of(&dir);
        std::fs::write(dir.path().join("note.txt"), b"text").unwrap();

        let entry = capture(&backup, "note.txt", &dir.path().join("note.txt")).unwrap();
        std::fs::remove_file(dir.path().join("note.txt")).unwrap();
        assert_eq!(restore(&repository, &entry).unwrap(), "note.txt");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "text"
        );
    }

    #[test]
    fn restore_never_overwrites_a_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let backup = backup_of(&dir);
        std::fs::write(dir.path().join("note.txt"), b"old").unwrap();
        let entry = capture(&backup, "note.txt", &dir.path().join("note.txt")).unwrap();
        std::fs::write(dir.path().join("note.txt"), b"new").unwrap();

        assert_eq!(restore(&repository, &entry).unwrap(), "note (1).txt");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "new"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("note (1).txt")).unwrap(),
            "old"
        );
    }

    #[test]
    fn folders_are_copied_whole_and_restored() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let backup = backup_of(&dir);
        std::fs::create_dir_all(dir.path().join("project/inner")).unwrap();
        std::fs::write(dir.path().join("project/inner/note.txt"), b"keep").unwrap();

        let entry = capture(&backup, "project", &dir.path().join("project")).unwrap();
        assert!(entry.is_dir);
        std::fs::remove_dir_all(dir.path().join("project")).unwrap();
        assert_eq!(restore(&repository, &entry).unwrap(), "project");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("project/inner/note.txt")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn history_tracks_labels_and_clears_redo() {
        let mut history = History::default();
        assert_eq!(history.state().undo_label, None);
        history.push(
            "editing a.txt".to_string(),
            UndoAction::Save {
                path: "a.txt".to_string(),
                content: String::new(),
            },
        );
        assert_eq!(history.state().undo_label.as_deref(), Some("editing a.txt"));
        let (label, action) = history.pop_undo().unwrap();
        history.push_redo(label, action);
        assert_eq!(history.state().redo_label.as_deref(), Some("editing a.txt"));
        history.push(
            "creating b.txt".to_string(),
            UndoAction::Create {
                path: "b.txt".to_string(),
                is_dir: false,
            },
        );
        assert_eq!(history.state().redo_label, None);
        assert_eq!(
            history.state().undo_label.as_deref(),
            Some("creating b.txt")
        );
    }

    #[test]
    fn pruning_removes_only_old_entries() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup");
        std::fs::create_dir_all(backup.join("folder")).unwrap();
        std::fs::write(backup.join("folder/note.txt"), b"x").unwrap();
        prune(&backup, std::time::Duration::from_secs(3600));
        assert!(backup.join("folder/note.txt").exists());
        prune(&backup, std::time::Duration::from_secs(0));
        assert!(!backup.join("folder").exists());
    }
}
