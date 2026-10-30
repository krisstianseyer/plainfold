use std::cmp::Ordering;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::encoding;
use crate::index::Index;
use crate::paths::Repository;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortOrder {
    Name,
    Modified,
    Size,
}

impl SortOrder {
    pub fn parse(value: &str) -> Self {
        match value {
            "modified" => Self::Modified,
            "size" => Self::Size,
            _ => Self::Name,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: i64,
    pub modified_ms: Option<i64>,
    pub children: Vec<TreeNode>,
}

pub fn build_tree(repository: &Repository, sort: SortOrder, index: Option<&Index>) -> Vec<TreeNode> {
    build_dir(repository, repository.root(), sort, index, 0)
}

fn is_revisions_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(crate::paths::REVISIONS_DIR)
}

fn build_dir(
    repository: &Repository,
    directory: &Path,
    sort: SortOrder,
    index: Option<&Index>,
    depth: usize,
) -> Vec<TreeNode> {
    if depth > 128 {
        return Vec::new();
    }
    let Ok(relative_parent) = repository.relative(directory).ok_or(()) else {
        return Vec::new();
    };
    let positions = index
        .map(|index| index.sort_positions(&relative_parent))
        .unwrap_or_default();

    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            crate::log::path_event("warn", "list-folder-failed", directory);
            return Vec::new();
        }
    };

    let mut nodes = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("plainfold-save-") || is_revisions_name(&name) {
            continue;
        }
        let path = entry.path();
        let link_meta = match std::fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let is_symlink = link_meta.file_type().is_symlink();
        let metadata = if is_symlink {
            link_meta
        } else {
            match std::fs::metadata(&path) {
                Ok(meta) => meta,
                Err(_) => continue,
            }
        };
        let is_dir = metadata.is_dir() && !is_symlink;
        let relative = match repository.relative(&path) {
            Some(relative) => relative,
            None => continue,
        };
        let children = if is_dir {
            build_dir(repository, &path, sort, index, depth + 1)
        } else {
            Vec::new()
        };
        nodes.push(TreeNode {
            name,
            path: relative,
            is_dir,
            is_symlink,
            size: metadata.len() as i64,
            modified_ms: metadata.modified().ok().map(system_ms),
            children,
        });
    }

    let (mut folders, mut files): (Vec<TreeNode>, Vec<TreeNode>) = nodes
        .into_iter()
        .partition(|node| node.is_dir);
    sort_group(&mut folders, sort, &positions);
    sort_group(&mut files, sort, &positions);
    folders.extend(files);
    folders
}

fn sort_group(nodes: &mut [TreeNode], sort: SortOrder, positions: &std::collections::HashMap<String, i64>) {
    nodes.sort_by(|a, b| {
        let a_position = positions.get(&a.name).copied();
        let b_position = positions.get(&b.name).copied();
        match (a_position, b_position) {
            (Some(a_pos), Some(b_pos)) if a_pos != b_pos => a_pos.cmp(&b_pos),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            _ => match sort {
                SortOrder::Name => compare_names(a, b),
                SortOrder::Modified => b
                    .modified_ms
                    .unwrap_or(i64::MIN)
                    .cmp(&a.modified_ms.unwrap_or(i64::MIN))
                    .then_with(|| compare_names(a, b)),
                SortOrder::Size => a
                    .size
                    .cmp(&b.size)
                    .then_with(|| compare_names(a, b)),
            },
        }
    });
}

fn compare_names(a: &TreeNode, b: &TreeNode) -> Ordering {
    a.name
        .to_lowercase()
        .cmp(&b.name.to_lowercase())
        .then_with(|| a.name.cmp(&b.name))
}

fn system_ms(time: std::time::SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

/// Rebuild the content index for a repository. Organization data (tags, pins,
/// recents, custom order) is preserved. Returns the number of files indexed.
pub fn rescan_index(index: &mut Index, repository: &Repository) -> Result<usize, String> {
    index.clear_files()?;
    let mut count = 0usize;
    walk_for_index(index, repository, repository.root(), &mut count, 0)?;
    Ok(count)
}

fn walk_for_index(
    index: &mut Index,
    repository: &Repository,
    directory: &Path,
    count: &mut usize,
    depth: usize,
) -> Result<(), String> {
    if depth > 128 {
        return Ok(());
    }
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            crate::log::path_event("warn", "list-folder-failed-while-indexing", directory);
            return Ok(());
        }
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("plainfold-save-") || is_revisions_name(&name) {
            continue;
        }
        let path = entry.path();
        let link_meta = match std::fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if link_meta.file_type().is_symlink() {
            continue;
        }
        if link_meta.is_dir() {
            walk_for_index(index, repository, &path, count, depth + 1)?;
            continue;
        }
        let Some(relative) = repository.relative(&path) else {
            continue;
        };
        let size = link_meta.len();
        let mtime = link_meta
            .modified()
            .ok()
            .map(system_ms)
            .unwrap_or_default();
        let body = indexable_body(&path, size);
        index.upsert_file(&relative, &name, size as i64, mtime, body.as_deref())?;
        *count += 1;
    }
    Ok(())
}

pub fn indexable_body(path: &Path, size: u64) -> Option<String> {
    if !encoding::should_index_size(size) {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let decoded = crate::encoding::decode(&bytes);
    if decoded.read_only.is_some() {
        return None;
    }
    Some(decoded.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_come_before_files_and_names_sort() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("z-folder")).unwrap();
        std::fs::write(dir.path().join("b.txt"), "b").unwrap();
        std::fs::write(dir.path().join("A.txt"), "a").unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let tree = build_tree(&repository, SortOrder::Name, None);
        assert!(tree[0].is_dir);
        assert_eq!(tree[0].name, "z-folder");
        assert_eq!(tree[1].name, "A.txt");
        assert_eq!(tree[2].name, "b.txt");
    }

    #[test]
    fn revision_folder_is_hidden_from_tree() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".revisions")).unwrap();
        std::fs::write(dir.path().join(".revisions/note.txt.gz"), b"hidden").unwrap();
        std::fs::write(dir.path().join("note.txt"), "visible").unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let tree = build_tree(&repository, SortOrder::Name, None);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "note.txt");
    }

    #[test]
    fn custom_order_overrides_name_order() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "a").unwrap();
        std::fs::write(dir.path().join("b.txt"), "b").unwrap();
        let mut index = Index::open(&dir.path().join("index.sqlite"), dir.path()).unwrap();
        index
            .set_sort_order("", &["b.txt".into(), "a.txt".into()])
            .unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let tree = build_tree(&repository, SortOrder::Name, Some(&index));
        assert_eq!(tree[0].name, "b.txt");
    }

    #[test]
    fn custom_order_inside_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("folder")).unwrap();
        std::fs::write(dir.path().join("folder/a.txt"), "a").unwrap();
        std::fs::write(dir.path().join("folder/b.txt"), "b").unwrap();
        let mut index = Index::open(&dir.path().join("index.sqlite"), dir.path()).unwrap();
        index
            .set_sort_order("folder", &["b.txt".into(), "a.txt".into()])
            .unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let tree = build_tree(&repository, SortOrder::Name, Some(&index));
        let folder = tree.iter().find(|node| node.name == "folder").unwrap();
        assert_eq!(folder.children[0].name, "b.txt");
        assert_eq!(folder.children[1].name, "a.txt");
    }
}
