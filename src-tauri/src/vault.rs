use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::atomic::atomic_write;
use crate::encoding::{self, Eol, TextEncoding, MAX_DISPLAY_BYTES, MAX_EDIT_BYTES};
use crate::errors::{AppError, AppResult};
use crate::names;
use crate::paths::{normalize_relative_allow_empty, Vault};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub path: String,
    pub name: String,
    pub content: String,
    pub encoding: String,
    pub encoding_label: String,
    pub eol: Eol,
    pub eol_label: String,
    pub size: i64,
    pub modified_ms: i64,
    pub read_only: bool,
    pub notice: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub size: i64,
    pub modified_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedItem {
    pub path: String,
    pub is_dir: bool,
}

pub fn read_file(vault: &Vault, relative: &str) -> AppResult<FileRead> {
    let absolute = vault.resolve_existing(relative)?;
    let metadata = std::fs::metadata(&absolute)
        .map_err(|_| AppError::new("The file no longer exists."))?;
    if !metadata.is_file() {
        return Err(AppError::new("That is a folder, not a file."));
    }
    let large = metadata.len() > MAX_EDIT_BYTES;
    let bytes = if large {
        read_prefix(&absolute, MAX_DISPLAY_BYTES)?
    } else {
        std::fs::read(&absolute).map_err(|_| AppError::new("The file could not be read."))?
    };
    let decoded = encoding::decode(&bytes);

    let mut notices = Vec::new();
    if large {
        if metadata.len() > MAX_DISPLAY_BYTES {
            notices.push(
                "This file is larger than 5 MB, so it is read-only. Only the beginning is shown.",
            );
        } else {
            notices.push("This file is larger than 5 MB, so it is read-only.");
        }
    }
    if let Some(notice) = decoded.read_only.as_deref() {
        notices.push(notice);
    }
    let read_only = !notices.is_empty();
    let notice = if notices.is_empty() {
        None
    } else {
        Some(notices.join(" "))
    };

    let name = absolute
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| relative.to_string());

    let eol = if decoded.text.is_empty() {
        // A newly created empty file follows the platform convention.
        Eol::default_for_platform()
    } else {
        decoded.eol
    };

    Ok(FileRead {
        path: relative.to_string(),
        name,
        content: decoded.text,
        encoding: decoded.encoding.id().to_string(),
        encoding_label: decoded.encoding.label().to_string(),
        eol,
        eol_label: eol.label().to_string(),
        size: metadata.len() as i64,
        modified_ms: metadata.modified().ok().map(system_ms).unwrap_or(0),
        read_only,
        notice,
    })
}

fn read_prefix(path: &Path, limit: u64) -> AppResult<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path)
        .map_err(|_| AppError::new("The file could not be read."))?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::new("The file could not be read."))?;
    Ok(bytes)
}

pub fn save_file(
    vault: &Vault,
    relative: &str,
    content: &str,
    encoding_id: &str,
    eol_id: &str,
) -> AppResult<SaveOutcome> {
    let absolute = vault.resolve_for_write(relative)?;
    let metadata = std::fs::metadata(&absolute)
        .map_err(|_| AppError::new("The file no longer exists."))?;
    if !metadata.is_file() {
        return Err(AppError::new("That is a folder, not a file."));
    }
    if metadata.len() > MAX_EDIT_BYTES {
        return Err(AppError::new(
            "This file is larger than 5 MB and cannot be saved.",
        ));
    }
    let existing = std::fs::read(&absolute)
        .map_err(|_| AppError::new("The file could not be read before saving."))?;
    let detected = encoding::decode(&existing);
    if detected.read_only.is_some() {
        return Err(AppError::new(
            "This file is not valid UTF-8 or BOM-marked UTF-16, so it cannot be saved.",
        ));
    }

    let encoding = TextEncoding::parse(encoding_id)?;
    let eol = Eol::parse(eol_id)?;
    if detected.encoding != encoding {
        return Err(AppError::new(
            "The encoding changed on disk. Reopen the file before saving.",
        ));
    }
    if !detected.text.is_empty() && detected.eol != eol {
        return Err(AppError::new(
            "The line endings changed on disk. Reopen the file before saving.",
        ));
    }
    let bytes = encoding::encode(content, encoding, eol);
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(AppError::new(
            "The saved file would be larger than 5 MB. Remove some text before saving.",
        ));
    }
    atomic_write(&absolute, &bytes)
        .map_err(|_| AppError::new("The file could not be saved. The original is unchanged."))?;

    let metadata = std::fs::metadata(&absolute)
        .map_err(|_| AppError::new("The file was saved but could not be checked."))?;
    Ok(SaveOutcome {
        size: metadata.len() as i64,
        modified_ms: metadata.modified().ok().map(system_ms).unwrap_or(0),
    })
}

pub fn create_item(
    vault: &Vault,
    parent: &str,
    name: &str,
    is_dir: bool,
) -> AppResult<CreatedItem> {
    let segments = names::validate_name(name, cfg!(windows))?;
    let parent_path = normalize_relative_allow_empty(parent)?;
    let parent_absolute = if parent_path.as_os_str().is_empty() {
        vault.root().to_path_buf()
    } else {
        vault.resolve_dir(parent)?
    };

    let mut current_relative = parent_path.clone();
    let mut final_absolute = parent_absolute.clone();
    for segment in &segments[..segments.len() - 1] {
        current_relative.push(segment);
        final_absolute.push(segment);
        let relative = current_relative.to_string_lossy().replace('\\', "/");
        final_absolute = vault.ensure_dir(&relative)?;
    }

    let leaf = segments.last().expect("validated name has a segment");
    let final_relative_path = current_relative.join(leaf);
    let final_relative = final_relative_path.to_string_lossy().replace('\\', "/");
    final_absolute.push(leaf);

    if final_absolute.symlink_metadata().is_ok() {
        return Err(AppError::new("An item with that name already exists."));
    }

    if is_dir {
        std::fs::create_dir(&final_absolute)
            .map_err(|_| AppError::new("The folder could not be created."))?;
    } else {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&final_absolute)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    AppError::new("An item with that name already exists.")
                }
                _ => AppError::new("The file could not be created."),
            })?;
        file.flush()
            .map_err(|_| AppError::new("The file could not be created."))?;
    }

    Ok(CreatedItem {
        path: final_relative,
        is_dir,
    })
}

pub fn delete_item(vault: &Vault, relative: &str) -> AppResult<()> {
    if relative.is_empty() {
        return Err(AppError::new("The vault folder cannot be deleted from the app."));
    }
    let normalized = crate::paths::normalize_relative(relative)?;
    let parent = normalized
        .parent()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let leaf = normalized
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| AppError::new("That item cannot be deleted."))?;
    let parent_absolute = if parent.is_empty() {
        vault.root().to_path_buf()
    } else {
        vault.resolve_dir(&parent)?
    };
    let target = parent_absolute.join(&leaf);
    let metadata = std::fs::symlink_metadata(&target)
        .map_err(|_| AppError::new("The item no longer exists."))?;

    // A folder is trashed as a folder; a symlink is trashed as a link and is
    // never followed.
    let _ = metadata;
    trash::delete(&target).map_err(|_| AppError::new("The item could not be moved to the trash."))?;
    Ok(())
}

pub fn file_modified_ms(path: &Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .map(system_ms)
        .unwrap_or(0)
}

pub fn system_ms(time: std::time::SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_nested_items_and_refuses_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let created = create_item(&vault, "", "notes/2026/day.txt", false).unwrap();
        assert_eq!(created.path, "notes/2026/day.txt");
        assert!(dir.path().join("notes/2026/day.txt").is_file());
        assert!(create_item(&vault, "", "notes/2026/day.txt", false).is_err());

        let folder = create_item(&vault, "", "notes/2026/archive", true).unwrap();
        assert!(folder.is_dir);
        assert!(dir.path().join("notes/2026/archive").is_dir());
    }

    #[test]
    fn saves_in_original_encoding_and_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        std::fs::write(&path, b"\xEF\xBB\xBFone\r\ntwo\r\n").unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let read = read_file(&vault, "note.txt").unwrap();
        assert_eq!(read.content, "one\ntwo\n");
        save_file(
            &vault,
            "note.txt",
            "three\nfour\n",
            "utf-8-bom",
            "crlf",
        )
        .unwrap();
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"\xEF\xBB\xBFthree\r\nfour\r\n"
        );
    }

    #[test]
    fn large_file_is_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.txt");
        std::fs::write(&path, vec![b'a'; (MAX_EDIT_BYTES + 1) as usize]).unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let read = read_file(&vault, "large.txt").unwrap();
        assert!(read.read_only);
        assert!(read.notice.unwrap().contains("5 MB"));
    }

    #[test]
    fn save_rejects_encoding_or_line_ending_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.txt"), b"one\r\ntwo\r\n").unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert!(save_file(&vault, "note.txt", "three\n", "utf-8", "lf").is_err());
        assert_eq!(
            std::fs::read(dir.path().join("note.txt")).unwrap(),
            b"one\r\ntwo\r\n"
        );
        assert!(save_file(
            &vault,
            "note.txt",
            "three\n",
            "utf-16le",
            "crlf"
        )
        .is_err());
    }

    #[test]
    fn save_rejects_content_that_grows_past_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.txt"), b"small").unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let big = "a".repeat((MAX_EDIT_BYTES + 1) as usize);
        assert!(save_file(&vault, "note.txt", &big, "utf-8", "lf").is_err());
        assert_eq!(std::fs::read(dir.path().join("note.txt")).unwrap(), b"small");
    }
}
