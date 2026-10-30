use std::path::{Component, Path, PathBuf};

use crate::errors::{AppError, AppResult};

pub const REVISIONS_DIR: &str = ".revisions";

/// A user-selected folder. Every operation resolves through this type so a
/// path can never escape the canonical repository root.
#[derive(Debug, Clone)]
pub struct Repository {
    root: PathBuf,
}

impl Repository {
    pub fn open(path: &Path) -> AppResult<Self> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|_| AppError::new("That folder could not be opened."))?;
        let metadata = std::fs::metadata(&canonical)
            .map_err(|_| AppError::new("That folder could not be opened."))?;
        if !metadata.is_dir() {
            return Err(AppError::new("Choose a folder, not a file."));
        }
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn relative(&self, absolute: &Path) -> Option<String> {
        let canonical = std::fs::canonicalize(absolute).ok();
        let candidate = canonical.as_deref().unwrap_or(absolute);
        relative_to(&self.root, candidate)
    }

    /// Resolve an existing path, following links only when they stay inside.
    pub fn resolve_existing(&self, relative: &str) -> AppResult<PathBuf> {
        let joined = self.root.join(normalize_relative(relative)?);
        let canonical = std::fs::canonicalize(&joined)
            .map_err(|_| AppError::new("The file or folder no longer exists."))?;
        if !is_inside(&self.root, &canonical) {
            return Err(AppError::new("That path is outside the repository."));
        }
        Ok(canonical)
    }

    /// Resolve an existing file for writing. Symbolic links are refused so a
    /// save can never replace a link that points elsewhere.
    pub fn resolve_for_write(&self, relative: &str) -> AppResult<PathBuf> {
        let joined = self.root.join(normalize_relative(relative)?);
        let link_meta = std::fs::symlink_metadata(&joined)
            .map_err(|_| AppError::new("The file no longer exists."))?;
        if link_meta.file_type().is_symlink() {
            return Err(AppError::new(
                "Symbolic links cannot be edited or deleted from Plainfold.",
            ));
        }
        let canonical = std::fs::canonicalize(&joined)
            .map_err(|_| AppError::new("The file no longer exists."))?;
        if !is_inside(&self.root, &canonical) {
            return Err(AppError::new("That path is outside the repository."));
        }
        Ok(canonical)
    }

    /// Resolve a parent folder that already exists and is inside the repository.
    pub fn resolve_dir(&self, relative: &str) -> AppResult<PathBuf> {
        let resolved = self.resolve_existing(relative)?;
        let metadata = std::fs::metadata(&resolved)
            .map_err(|_| AppError::new("The folder no longer exists."))?;
        if !metadata.is_dir() {
            return Err(AppError::new("That is a file, not a folder."));
        }
        Ok(resolved)
    }

    /// Create and validate an intermediate directory for a new item.
    pub fn ensure_dir(&self, relative: &str) -> AppResult<PathBuf> {
        let normalized = normalize_relative(relative)?;
        let parent_rel = normalized
            .parent()
            .map(|value| value.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let parent = if parent_rel.is_empty() {
            self.root.clone()
        } else {
            self.resolve_dir(&parent_rel)?
        };
        let leaf = normalized
            .file_name()
            .ok_or_else(|| AppError::new("The folder could not be created."))?;
        let joined = parent.join(leaf);
        if !joined.exists() {
            std::fs::create_dir(&joined)
                .map_err(|_| AppError::new("The folder could not be created."))?;
        }
        let canonical = std::fs::canonicalize(&joined)
            .map_err(|_| AppError::new("The folder could not be created."))?;
        if !is_inside(&self.root, &canonical) {
            return Err(AppError::new("That path is outside the repository."));
        }
        let metadata = std::fs::metadata(&canonical)
            .map_err(|_| AppError::new("The folder could not be created."))?;
        if !metadata.is_dir() {
            return Err(AppError::new("A file is in the way of that folder name."));
        }
        Ok(canonical)
    }
}

/// Validate a repository-relative path supplied by the front end. Only normal
/// components are accepted; absolute paths, drive prefixes, `.` and `..` are
/// rejected.
pub fn normalize_relative(relative: &str) -> AppResult<PathBuf> {
    if relative.is_empty() {
        return Err(AppError::new("Select a file first."));
    }
    if relative.contains('\0') {
        return Err(AppError::new("That path is not valid."));
    }
    if relative.contains('\\') {
        return Err(AppError::new("That path is not valid."));
    }
    let mut out = PathBuf::new();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(AppError::new("That path is not valid."));
        }
        if part == REVISIONS_DIR || part.eq_ignore_ascii_case(REVISIONS_DIR) {
            return Err(AppError::new(
                "That name is reserved for revision history.",
            ));
        }
        out.push(part);
    }
    for component in out.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err(AppError::new("That path is not valid.")),
        }
    }
    Ok(out)
}

pub fn normalize_relative_allow_empty(relative: &str) -> AppResult<PathBuf> {
    if relative.is_empty() {
        return Ok(PathBuf::new());
    }
    normalize_relative(relative)
}

pub fn is_revisions_path(relative: &str) -> bool {
    relative == REVISIONS_DIR || relative.starts_with(&format!("{REVISIONS_DIR}/"))
}

pub fn relative_to(root: &Path, candidate: &Path) -> Option<String> {
    if !is_inside(root, candidate) {
        return None;
    }
    let relative = candidate.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return Some(String::new());
    }
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => parts.push(value.to_str()?.to_string()),
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

/// Compare paths component by component so Windows casing differences do not
/// cause a false escape.
pub fn is_inside(root: &Path, candidate: &Path) -> bool {
    let root_components: Vec<_> = root.components().collect();
    let candidate_components: Vec<_> = candidate.components().collect();
    if candidate_components.len() < root_components.len() {
        return false;
    }
    root_components
        .iter()
        .zip(candidate_components.iter())
        .all(|(a, b)| component_eq(a, b))
}

fn component_eq(a: &Component<'_>, b: &Component<'_>) -> bool {
    let (Component::Normal(a), Component::Normal(b)) = (a, b) else {
        return a == b;
    };
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// A path for display in the interface. Windows canonical paths carry the
/// `\\?\` verbatim prefix and UNC form, which mean nothing to a reader.
pub fn display_path(path: &Path) -> String {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
        text.into_owned()
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        assert!(normalize_relative("../x").is_err());
        assert!(normalize_relative("a/../../x").is_err());
        assert!(normalize_relative("/etc/passwd").is_err());
        assert!(normalize_relative("a//b").is_err());
        assert!(normalize_relative("a\\b").is_err());
        assert!(normalize_relative("a/./b").is_err());
    }

    #[test]
    fn accepts_normal_paths() {
        assert_eq!(
            normalize_relative("notes/2026/day.txt").unwrap(),
            PathBuf::from("notes/2026/day.txt")
        );
    }

    #[test]
    fn repository_stays_inside() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Repository");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(temp.path().join("outside")).unwrap();
        std::fs::write(root.join("inside.txt"), "ok").unwrap();
        std::fs::write(temp.path().join("outside/secret.txt"), "no").unwrap();

        let repository = Repository::open(&root).unwrap();
        assert!(repository.resolve_existing("inside.txt").is_ok());
        assert!(repository.resolve_existing("../outside/secret.txt").is_err());
        assert!(repository
            .resolve_existing(temp.path().join("outside/secret.txt").to_str().unwrap())
            .is_err());
    }

    #[test]
    fn display_path_drops_verbatim_prefix() {
        let shown = display_path(Path::new(r"\\?\C:\Users\me\Notes"));
        assert!(!shown.contains(r"\\?\"));
        assert!(shown.ends_with(r"Notes"));
    }
}
