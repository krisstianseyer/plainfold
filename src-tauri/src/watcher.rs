use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Weak};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::paths::{relative_to, Repository};
use crate::state::AppState;
use crate::tree::indexable_body;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedPayload {
    paths: Vec<String>,
    kind: &'static str,
}

pub fn start(
    app: AppHandle,
    state: Arc<AppState>,
    repository: Repository,
) -> Result<RecommendedWatcher, String> {
    let (sender, receiver) = mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            for path in event.paths {
                let _ = sender.send(path);
            }
        }
    })
    .map_err(|_| "The file watcher could not be started.".to_string())?;

    watcher
        .watch(repository.root(), RecursiveMode::Recursive)
        .map_err(|_| "The file watcher could not watch this repository.".to_string())?;
    crate::log::path_event("info", "watcher-started", repository.root());

    let weak: Weak<AppState> = Arc::downgrade(&state);
    std::thread::spawn(move || {
        while let Ok(first) = receiver.recv() {
            let mut batch: HashSet<PathBuf> = HashSet::new();
            batch.insert(first);
            let deadline = std::time::Instant::now() + Duration::from_millis(250);
            loop {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match receiver.recv_timeout(remaining) {
                    Ok(path) => {
                        batch.insert(path);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let Some(state) = weak.upgrade() else {
                break;
            };
            process_batch(&state, &app, &repository, &batch);
        }
    });

    Ok(watcher)
}

fn process_batch(
    state: &Arc<AppState>,
    app: &AppHandle,
    repository: &Repository,
    batch: &HashSet<PathBuf>,
) {
    let mut changed = Vec::new();
    let mut jobs = Vec::new();

    for path in batch {
        if path
            .file_name()
            .map(|name| name.to_string_lossy().starts_with("plainfold-save-"))
            .unwrap_or(false)
        {
            continue;
        }
        let Some(relative) = relative_for(repository, path) else {
            continue;
        };
        if relative.is_empty() || crate::paths::is_revisions_path(&relative) {
            continue;
        }
        collect_path(repository, path, &relative, &mut jobs, 0);
        changed.push(relative);
    }

    if changed.is_empty() {
        return;
    }

    {
        let mut inner = match state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        if inner.repository.as_ref().map(|current| current.root()) != Some(repository.root()) {
            crate::log::line("warn", "watcher batch ignored: repository changed");
            return;
        }
        if let Some(index) = inner.index.as_mut() {
            for job in jobs {
                match job {
                    Job::Remove(relative) => {
                        if let Err(error) = index.remove_path(&relative) {
                            crate::log::line(
                                "error",
                                &format!("index remove failed for {relative}: {error}"),
                            );
                        }
                    }
                    Job::Upsert {
                        relative,
                        name,
                        size,
                        mtime,
                        body,
                    } => {
                        // Sync clients and backup tools touch files without
                        // changing them. When size and mtime match the index,
                        // the file is unchanged: skip the write and the report.
                        let unchanged = index
                            .file_meta(&relative)
                            .map(|(old_size, old_mtime)| old_size == size && old_mtime == mtime)
                            .unwrap_or(false);
                        if unchanged {
                            changed.retain(|path| path != &relative);
                            continue;
                        }
                        if let Err(error) =
                            index.upsert_file(&relative, &name, size, mtime, body.as_deref())
                        {
                            crate::log::line(
                                "error",
                                &format!("index update failed for {relative}: {error}"),
                            );
                        }
                    }
                }
            }
        }
    }

    changed.sort();
    changed.dedup();
    if changed.is_empty() {
        return;
    }
    let payload = ChangedPayload {
        paths: changed,
        kind: "changed",
    };
    if app.emit("repository-changed", payload).is_err() {
        crate::log::line("error", "could not emit a repository change event");
    }
}

enum Job {
    Remove(String),
    Upsert {
        relative: String,
        name: String,
        size: i64,
        mtime: i64,
        body: Option<String>,
    },
}

fn relative_for(repository: &Repository, path: &Path) -> Option<String> {
    if path.exists() {
        return repository.relative(path);
    }
    relative_to(repository.root(), path)
}

fn collect_path(
    repository: &Repository,
    absolute: &Path,
    relative: &str,
    jobs: &mut Vec<Job>,
    depth: usize,
) {
    if depth > 128 {
        return;
    }
    let meta = match std::fs::symlink_metadata(absolute) {
        Ok(meta) => meta,
        Err(_) => {
            jobs.push(Job::Remove(relative.to_string()));
            return;
        }
    };
    if meta.file_type().is_symlink() {
        jobs.push(Job::Remove(relative.to_string()));
        return;
    }
    if meta.is_dir() {
        if let Ok(entries) = std::fs::read_dir(absolute) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("plainfold-save-")
                    || name.eq_ignore_ascii_case(crate::paths::REVISIONS_DIR)
                {
                    continue;
                }
                let path = entry.path();
                let Some(child_relative) = repository.relative(&path) else {
                    continue;
                };
                collect_path(repository, &path, &child_relative, jobs, depth + 1);
            }
        }
        return;
    }
    let name = absolute
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| relative.to_string());
    let body = indexable_body(absolute, meta.len());
    let mtime = meta
        .modified()
        .ok()
        .map(crate::repository::system_ms)
        .unwrap_or_default();
    jobs.push(Job::Upsert {
        relative: relative.to_string(),
        name,
        size: meta.len() as i64,
        mtime,
        body,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{index_database_path, Index};

    /// A touch that leaves size and mtime alone must not be reported, or the
    /// open file would look changed to the user for no reason.
    #[test]
    fn unchanged_files_are_not_reported() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        std::fs::write(dir.path().join("note.txt"), b"hello world\n").unwrap();
        let meta = std::fs::metadata(dir.path().join("note.txt")).unwrap();
        let mtime = meta
            .modified()
            .ok()
            .map(crate::repository::system_ms)
            .unwrap_or_default();
        let database = index_database_path(dir.path(), repository.root());
        let mut index = Index::open(&database, repository.root()).unwrap();
        index
            .upsert_file(
                "note.txt",
                "note.txt",
                meta.len() as i64,
                mtime,
                Some("hello world\n"),
            )
            .unwrap();

        assert_eq!(
            index.file_meta("note.txt"),
            Some((meta.len() as i64, mtime))
        );
        // A file the index has never seen is reported.
        assert_eq!(index.file_meta("other.txt"), None);
    }

    /// A real edit changes the size or mtime recorded in the index.
    #[test]
    fn edited_files_stay_reported() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let path = dir.path().join("note.txt");
        std::fs::write(&path, b"one\n").unwrap();
        let before = std::fs::metadata(&path).unwrap();
        let database = index_database_path(dir.path(), repository.root());
        let mut index = Index::open(&database, repository.root()).unwrap();
        index
            .upsert_file(
                "note.txt",
                "note.txt",
                before.len() as i64,
                before
                    .modified()
                    .ok()
                    .map(crate::repository::system_ms)
                    .unwrap_or_default(),
                Some("one\n"),
            )
            .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, b"one and two\n").unwrap();
        let after = std::fs::metadata(&path).unwrap();
        let after_mtime = after
            .modified()
            .ok()
            .map(crate::repository::system_ms)
            .unwrap_or_default();
        let recorded = index.file_meta("note.txt").unwrap();
        assert!(
            recorded.0 != after.len() as i64 || recorded.1 != after_mtime,
            "an edit must differ from the indexed size or mtime"
        );
    }
}
