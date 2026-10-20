use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Weak};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::paths::{relative_to, Vault};
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
    vault: Vault,
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
        .watch(vault.root(), RecursiveMode::Recursive)
        .map_err(|_| "The file watcher could not watch this vault.".to_string())?;

    let weak: Weak<AppState> = Arc::downgrade(&state);
    std::thread::spawn(move || {
        loop {
            let first = match receiver.recv() {
                Ok(path) => path,
                Err(_) => break,
            };
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
            process_batch(&state, &app, &vault, &batch);
        }
    });

    Ok(watcher)
}

fn process_batch(
    state: &Arc<AppState>,
    app: &AppHandle,
    vault: &Vault,
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
        let Some(relative) = relative_for(vault, path) else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        collect_path(vault, path, &relative, &mut jobs, 0);
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
        if inner.vault.as_ref().map(|current| current.root()) != Some(vault.root()) {
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
    let payload = ChangedPayload {
        paths: changed,
        kind: "changed",
    };
    if app.emit("vault-changed", payload).is_err() {
        crate::log::line("error", "could not emit a vault change event");
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

fn relative_for(vault: &Vault, path: &Path) -> Option<String> {
    if path.exists() {
        return vault.relative(path);
    }
    relative_to(vault.root(), path)
}

fn collect_path(
    vault: &Vault,
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
                if name.starts_with("plainfold-save-") {
                    continue;
                }
                let path = entry.path();
                let Some(child_relative) = vault.relative(&path) else {
                    continue;
                };
                collect_path(vault, &path, &child_relative, jobs, depth + 1);
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
        .map(crate::vault::system_ms)
        .unwrap_or_default();
    jobs.push(Job::Upsert {
        relative: relative.to_string(),
        name,
        size: meta.len() as i64,
        mtime,
        body,
    });
}
