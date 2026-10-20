use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Write a file atomically: a temporary file in the same folder is flushed to
/// disk and then renamed over the destination. The original survives any
/// failure before the rename.
pub fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent"))?;
    let original_permissions = std::fs::metadata(path).ok().map(|m| m.permissions());

    let temp = unique_temp_path(parent);
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(data)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        if let Some(permissions) = original_permissions {
            std::fs::set_permissions(&temp, permissions)?;
        }
        std::fs::rename(&temp, path)?;
        sync_parent(parent);
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Create a new file without ever overwriting an existing one.
pub fn atomic_create(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "exists",
        ));
    }
    atomic_write(path, data)
}

fn unique_temp_path(parent: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let mut attempt = 0u32;
    loop {
        let name = format!(
            "plainfold-save-{}-{}-{}.tmp",
            std::process::id(),
            nanos,
            attempt
        );
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
        attempt += 1;
    }
}

#[cfg(unix)]
fn sync_parent(parent: &Path) {
    if let Ok(file) = std::fs::File::open(parent) {
        let _ = file.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_content_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"old").unwrap();
        atomic_write(&file, b"new").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"new");
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .map(|e| e.file_name().to_string_lossy().starts_with("plainfold-save-"))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn create_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"old").unwrap();
        let error = atomic_create(&file, b"new").unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&file).unwrap(), b"old");
    }
}
