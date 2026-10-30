use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri::async_runtime::spawn_blocking;

use crate::desktop::{self, DesktopShortcutStatus};
use crate::encoding::should_index_size;
use crate::index::{index_database_path, Index, SearchHit, TagCount};
use crate::paths::Repository;
use crate::settings::{self, Settings};
use crate::state::AppState;
use crate::tree::{self, SortOrder, TreeNode};
use crate::undo::{self, UndoAction, UndoState};
use crate::repository::{
    self, CreatedItem, FileRead, SaveOutcome,
};
use crate::watcher;

/// How long deleted items stay available for Undo.
const UNDO_WINDOW: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub path: String,
    pub name: String,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: String,
    pub settings: Settings,
    pub repository: Option<RepositoryInfo>,
    pub recent_repositories: Vec<RepositoryEntry>,
    pub tree: Vec<TreeNode>,
    pub notices: Vec<String>,
}

fn repository_entry(path: &str) -> RepositoryEntry {
    let candidate = Path::new(path);
    let name = candidate
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.to_string());
    RepositoryEntry {
        path: path.to_string(),
        name,
        exists: candidate.exists(),
    }
}

fn recent_entries(settings: &Settings) -> Vec<RepositoryEntry> {
    settings
        .recent_repositories
        .iter()
        .map(|path| repository_entry(path))
        .collect()
}

/// Move a successfully opened repository to the front of the list. The
/// repository root is already canonical, so only its display form is stored.
fn remember_repository(settings: &mut Settings, repository: &Repository) {
    let path = crate::paths::display_path(repository.root());
    settings
        .recent_repositories
        .retain(|existing| !same_path(existing, &path));
    settings.recent_repositories.insert(0, path.clone());
    settings.recent_repositories.truncate(20);
    settings.last_repository = Some(path);
}

/// Drop a repository from the list and point `last_repository` at the newest
/// remaining entry. Returns whether a matching entry was removed.
fn forget_repository(settings: &mut Settings, path: &str) -> bool {
    let before = settings.recent_repositories.len();
    settings
        .recent_repositories
        .retain(|existing| !same_path(existing, path));
    settings.last_repository = settings.recent_repositories.first().cloned();
    before != settings.recent_repositories.len()
}

#[cfg(windows)]
fn same_path(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

#[cfg(not(windows))]
fn same_path(left: &str, right: &str) -> bool {
    left == right
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub tags: HashMap<String, Vec<String>>,
    pub tag_counts: Vec<TagCount>,
    pub pins: Vec<String>,
    pub recents: Vec<String>,
}

#[tauri::command]
pub async fn bootstrap(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Snapshot, String> {
    let (settings_notice, candidates) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        let notice = inner.settings_notice.take();
        let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
        if let Some(path) = inner.settings.default_repository.clone() {
            candidates.push((
                PathBuf::from(path),
                "The default repository folder could not be opened. Choose a folder to begin.",
            ));
        }
        if let Some(path) = inner.settings.last_repository.clone() {
            let duplicate = candidates
                .iter()
                .any(|(candidate, _)| same_path(&candidate.to_string_lossy(), &path));
            if !duplicate {
                candidates.push((
                    PathBuf::from(path),
                    "The last repository folder could not be opened. Choose a folder to begin.",
                ));
            }
        }
        (notice, candidates)
    };

    let mut notices = Vec::new();
    if let Some(notice) = settings_notice {
        notices.push(notice);
    }

    for (path, failure_notice) in candidates {
        let arc: Arc<AppState> = (*state).clone();
        let app_handle = app.clone();
        let opened = spawn_blocking(move || open_repository_impl(&arc, &app_handle, path))
            .await
            .map_err(|_| "The operation could not be completed.".to_string())?;
        match opened {
            Ok(mut snapshot) => {
                let mut combined = notices;
                combined.append(&mut snapshot.notices);
                snapshot.notices = combined;
                return Ok(snapshot);
            }
            Err(_) => notices.push(failure_notice.to_string()),
        }
    }

    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    Ok(Snapshot {
        version: env!("CARGO_PKG_VERSION").to_string(),
        settings: inner.settings.clone(),
        repository: None,
        recent_repositories: recent_entries(&inner.settings),
        tree: Vec::new(),
        notices,
    })
}

#[tauri::command]
pub async fn open_repository(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    path: String,
) -> Result<Snapshot, String> {
    let arc: Arc<AppState> = (*state).clone();
    spawn_blocking(move || open_repository_impl(&arc, &app, PathBuf::from(path)))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn open_repository_impl(
    state: &Arc<AppState>,
    app: &AppHandle,
    path: PathBuf,
) -> Result<Snapshot, String> {
    let repository = Repository::open(&path).map_err(|error| error.to_string())?;
    let mut notices = Vec::new();

    let database = index_database_path(&state.data_dir, repository.root());
    let mut index_notice = None;
    let index = match Index::open(&database, repository.root()) {
        Ok(mut index) => match tree::rescan_index(&mut index, &repository) {
            Ok(_) => Some(index),
            Err(error) => {
                index_notice = Some(error.clone());
                notices.push(error);
                None
            }
        },
        Err(error) => {
            index_notice = Some(error.clone());
            notices.push(error);
            None
        }
    };

    let watcher_enabled = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        inner.settings.feature_enabled("watcher")
    };
    let watcher = if watcher_enabled {
        match watcher::start(app.clone(), Arc::clone(state), repository.clone()) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                notices.push(format!(
                    "{error} Changes made by other programs may not be detected."
                ));
                None
            }
        }
    } else {
        None
    };

    let settings_path = state.settings_path();
    let (settings_snapshot, tree) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;

        inner.watcher = watcher;
        inner.index_notice = index_notice;
        inner.repository = Some(repository.clone());
        inner.index = index;
        inner.undo.reset();
        let backup = state.undo_backup_dir(repository.root());
        undo::prune(&backup, UNDO_WINDOW);
        inner.undo_backup_dir = Some(backup);

        remember_repository(&mut inner.settings, &repository);
        let settings_snapshot = inner.settings.clone();
        let sort = SortOrder::parse(&settings_snapshot.default_sort);
        let tree = tree::build_tree(&repository, sort, inner.index.as_ref());
        (settings_snapshot, tree)
    };

    // Saving is best-effort: losing the recent list must never stop the
    // repository from opening.
    if settings::save(&settings_path, &settings_snapshot).is_err() {
        notices.push(
            "The repository opened, but its recent-repositories list could not be saved."
                .to_string(),
        );
    }

    Ok(Snapshot {
        version: env!("CARGO_PKG_VERSION").to_string(),
        settings: settings_snapshot.clone(),
        repository: Some(RepositoryInfo {
            path: crate::paths::display_path(repository.root()),
            name: repository
                .root()
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "repository".to_string()),
        }),
        recent_repositories: recent_entries(&settings_snapshot),
        tree,
        notices,
    })
}

#[tauri::command]
pub async fn list_tree(state: State<'_, Arc<AppState>>) -> Result<Vec<TreeNode>, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || list_tree_impl(&state))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn list_tree_impl(state: &Arc<AppState>) -> Result<Vec<TreeNode>, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let Some(repository) = inner.repository.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(tree::build_tree(
        repository,
        SortOrder::parse(&inner.settings.default_sort),
        inner.index.as_ref(),
    ))
}

#[tauri::command]
pub async fn read_file(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<FileRead, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || read_file_impl(&state, &path))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn read_file_impl(state: &Arc<AppState>, path: &str) -> Result<FileRead, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?;
    let file = repository::read_file(repository, path).map_err(|error| error.to_string())?;
    if let Some(index) = inner.index.as_mut() {
        let _ = index.record_recent(path);
    }
    Ok(file)
}

#[tauri::command]
pub fn open_external(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    let absolute = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        let repository = inner
            .repository
            .as_ref()
            .ok_or_else(|| "Open a repository first.".to_string())?;
        repository
            .resolve_existing(&path)
            .map_err(|error| error.to_string())?
    };
    let metadata =
        std::fs::metadata(&absolute).map_err(|_| "The file no longer exists.".to_string())?;
    if !metadata.is_file() {
        return Err("That is a folder, not a file.".to_string());
    }
    opener::open(&absolute)
        .map_err(|_| "The file could not be opened in its default app.".to_string())
}

#[tauri::command]
pub async fn list_revisions(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<crate::revisions::RevisionInfo>, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || list_revisions_impl(&state, &path))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn list_revisions_impl(
    state: &Arc<AppState>,
    path: &str,
) -> Result<Vec<crate::revisions::RevisionInfo>, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?;
    repository
        .resolve_existing(path)
        .map_err(|error| error.to_string())?;
    crate::revisions::list(repository, path)
}

#[tauri::command]
pub async fn restore_revision(
    state: State<'_, Arc<AppState>>,
    path: String,
    id: String,
) -> Result<(), String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || restore_revision_impl(&state, &path, &id))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn restore_revision_impl(
    state: &Arc<AppState>,
    path: &str,
    id: &str,
) -> Result<(), String> {
    let (repository, retention) = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        let repository = inner
            .repository
            .as_ref()
            .ok_or_else(|| "Open a repository first.".to_string())?
            .clone();
        (repository, inner.settings.retention())
    };
    crate::revisions::restore(&repository, path, id, &retention)
}

#[tauri::command]
pub async fn save_file(
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
    encoding: String,
    eol: String,
) -> Result<SaveOutcome, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || save_file_impl(&state, &path, &content, &encoding, &eol))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn save_file_impl(
    state: &Arc<AppState>,
    path: &str,
    content: &str,
    encoding: &str,
    eol: &str,
) -> Result<SaveOutcome, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?
        .clone();
    // Consecutive saves of one file collapse into a single step, so Undo
    // goes back to the text the file had before the editing session.
    let pending = inner
        .undo
        .peek_undo()
        .and_then(|(_, action)| match action {
            UndoAction::Save {
                path: last, content, ..
            } if last == path => Some(content.clone()),
            _ => None,
        });
    let retention = if inner.settings.feature_enabled("revisions") {
        Some(inner.settings.retention())
    } else {
        None
    };
    let outcome = repository::save_file_with_revisions(
        &repository,
        path,
        content,
        encoding,
        eol,
        retention,
    )
    .map_err(|error| error.to_string())?;
    let previous = match pending {
        Some(text) if !text.is_empty() => {
            inner.undo.pop_undo();
            text
        }
        _ => repository::read_text(&repository, path).unwrap_or_default(),
    };
    inner.undo.push(
        format!("editing {}", basename(path)),
        UndoAction::Save {
            path: path.to_string(),
            content: previous,
        },
    );
    if let Some(index) = inner.index.as_mut() {
        let name = path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .to_string();
        let body = if should_index_size(outcome.size as u64) {
            Some(content)
        } else {
            None
        };
        let _ = index.upsert_file(path, &name, outcome.size, outcome.modified_ms, body);
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn create_item(
    state: State<'_, Arc<AppState>>,
    parent: String,
    name: String,
    is_dir: bool,
) -> Result<CreatedItem, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || create_item_impl(&state, &parent, &name, is_dir))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn create_item_impl(
    state: &Arc<AppState>,
    parent: &str,
    name: &str,
    is_dir: bool,
) -> Result<CreatedItem, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?
        .clone();
    let created = repository::create_item(&repository, parent, name, is_dir)
        .map_err(|error| error.to_string())?;
    if !created.is_dir {
        if let Some(index) = inner.index.as_mut() {
            let leaf = created.path.rsplit('/').next().unwrap_or(&created.path).to_string();
            let absolute = repository.root().join(&created.path);
            let metadata = std::fs::metadata(&absolute).ok();
            let size = metadata.as_ref().map(|meta| meta.len() as i64).unwrap_or(0);
            let mtime = metadata
                .as_ref()
                .and_then(|meta| meta.modified().ok())
                .map(crate::repository::system_ms)
                .unwrap_or(0);
            let _ = index.upsert_file(&created.path, &leaf, size, mtime, Some(""));
        }
    }
    inner.undo.push(
        format!("creating {}", basename(&created.path)),
        UndoAction::Create {
            path: created.path.clone(),
            is_dir: created.is_dir,
        },
    );
    Ok(created)
}

#[tauri::command]
pub async fn move_item(
    state: State<'_, Arc<AppState>>,
    source: String,
    target_parent: String,
) -> Result<String, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || move_item_impl(&state, &source, &target_parent))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn move_item_impl(
    state: &Arc<AppState>,
    source: &str,
    target_parent: &str,
) -> Result<String, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?
        .clone();
    let new_path = repository::move_item(&repository, source, target_parent)
        .map_err(|error| error.to_string())?;
    if new_path != source {
        if let Err(error) = crate::revisions::move_path(&repository, source, &new_path) {
            crate::log::line("warn", &format!("revision move failed: {error}"));
        }
        if let Some(index) = inner.index.as_mut() {
            if let Err(error) = index.move_path(source, &new_path) {
                crate::log::line("error", &format!("index move failed: {error}"));
            }
        }
        inner.undo.push(
            format!("moving {}", basename(source)),
            UndoAction::Move {
                from: source.to_string(),
                to: new_path.clone(),
            },
        );
    }
    Ok(new_path)
}

#[tauri::command]
pub async fn delete_item(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || delete_item_impl(&state, &path))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn delete_item_impl(state: &Arc<AppState>, path: &str) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?
        .clone();
    let absolute = repository
        .resolve_existing(path)
        .map_err(|error| error.to_string())?;
    // A copy is kept outside the repository so the deletion can be reversed, then
    // the original goes to the system trash as before.
    let entry = inner
        .undo_backup_dir
        .clone()
        .and_then(|backup| undo::capture(&backup, path, &absolute).ok());
    if let Err(error) = repository::delete_item(&repository, path) {
        if let Some(entry) = entry.as_ref() {
            let _ = std::fs::remove_dir_all(&entry.backup);
            let _ = std::fs::remove_file(&entry.backup);
        }
        return Err(error.to_string());
    }
    if let Some(entry) = entry {
        inner.undo.push(
            format!("deleting {}", basename(path)),
            UndoAction::RestoreTrash {
                entries: vec![entry],
            },
        );
    }
    if let Err(error) = crate::revisions::remove_path(&repository, path) {
        crate::log::line("warn", &format!("revision delete failed: {error}"));
    }
    if let Some(index) = inner.index.as_mut() {
        let _ = index.remove_path(path);
    }
    Ok(())
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

#[tauri::command]
pub async fn search(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || search_impl(&state, &query))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn search_impl(state: &Arc<AppState>, query: &str) -> Result<Vec<SearchHit>, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let index = inner.index.as_ref().ok_or_else(|| {
        inner
            .index_notice
            .clone()
            .unwrap_or_else(|| "Search is unavailable for this repository.".to_string())
    })?;
    index.search(query, 200)
}

#[tauri::command]
pub async fn rescan(state: State<'_, Arc<AppState>>) -> Result<usize, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || rescan_impl(&state))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn rescan_impl(state: &Arc<AppState>) -> Result<usize, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?
        .clone();
    if inner.index.is_none() {
        let database = index_database_path(&state.data_dir, repository.root());
        inner.index = Some(Index::open(&database, repository.root())?);
        inner.index_notice = None;
    }
    let index = inner.index.as_mut().expect("index was opened");
    tree::rescan_index(index, &repository)
}

#[tauri::command]
pub fn get_organization(
    state: State<'_, Arc<AppState>>,
) -> Result<Organization, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let Some(index) = inner.index.as_ref() else {
        return Ok(Organization {
            tags: HashMap::new(),
            tag_counts: Vec::new(),
            pins: Vec::new(),
            recents: Vec::new(),
        });
    };
    Ok(Organization {
        tags: index.tags_map(),
        tag_counts: index.tag_counts(),
        pins: index.pins(),
        recents: index.recents(100),
    })
}

#[tauri::command]
pub fn remove_recent(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let index = inner
        .index
        .as_mut()
        .ok_or_else(|| "Recent files are unavailable because the search index is not open.".to_string())?;
    index.remove_recent(&path)
}

#[tauri::command]
pub fn set_tags(
    state: State<'_, Arc<AppState>>,
    path: String,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?;
    repository
        .resolve_existing(&path)
        .map_err(|error| error.to_string())?;
    let index = inner
        .index
        .as_mut()
        .ok_or_else(|| "Tags are unavailable because the search index is not open.".to_string())?;
    index.set_tags(&path, &tags)?;
    Ok(index.tags_for(&path))
}

#[tauri::command]
pub fn set_pin(
    state: State<'_, Arc<AppState>>,
    path: String,
    pinned: bool,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?;
    repository
        .resolve_existing(&path)
        .map_err(|error| error.to_string())?;
    let index = inner
        .index
        .as_mut()
        .ok_or_else(|| "Pins are unavailable because the search index is not open.".to_string())?;
    index.set_pin(&path, pinned)
}

#[tauri::command]
pub fn set_sort_order(
    state: State<'_, Arc<AppState>>,
    parent: String,
    names: Vec<String>,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?;
    if !parent.is_empty() {
        repository
            .resolve_dir(&parent)
            .map_err(|error| error.to_string())?;
    }
    let index = inner.index.as_mut().ok_or_else(|| {
        "Custom order is unavailable because the search index is not open.".to_string()
    })?;
    index.set_sort_order(&parent, &names)
}

#[tauri::command]
pub fn desktop_shortcut_status(
    state: State<'_, Arc<AppState>>,
) -> Result<DesktopShortcutStatus, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    Ok(desktop::status(inner.settings.desktop_shortcut_prompted))
}

#[tauri::command]
pub fn resolve_desktop_shortcut(
    state: State<'_, Arc<AppState>>,
    create: bool,
) -> Result<DesktopShortcutStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let status = desktop::status(inner.settings.desktop_shortcut_prompted);
    if status.supported {
        if create && !status.exists {
            desktop::create()?;
        }
        inner.settings.desktop_shortcut_prompted = true;
        settings::save(&state.settings_path(), &inner.settings)
            .map_err(|error| error.to_string())?;
    }
    Ok(desktop::status(inner.settings.desktop_shortcut_prompted))
}

#[tauri::command]
pub fn undo_state(state: State<'_, Arc<AppState>>) -> Result<UndoState, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    Ok(inner.undo.state())
}

#[tauri::command]
pub async fn undo(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || step_impl(&state, true))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

#[tauri::command]
pub async fn redo(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let state: Arc<AppState> = (*state).clone();
    spawn_blocking(move || step_impl(&state, false))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

/// Walk one step of the history. Undo reverses the newest step and files it
/// for redo; redo does the opposite.
fn step_impl(state: &Arc<AppState>, reverse: bool) -> Result<String, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    let repository = inner
        .repository
        .as_ref()
        .ok_or_else(|| "Open a repository first.".to_string())?
        .clone();
    let popped = if reverse {
        inner.undo.pop_undo()
    } else {
        inner.undo.pop_redo()
    };
    let (label, action) = popped.ok_or_else(|| {
        if reverse {
            "There is nothing to undo.".to_string()
        } else {
            "There is nothing to redo.".to_string()
        }
    })?;

    let outcome = perform(&repository, inner.undo_backup_dir.as_deref(), &action, reverse);
    match outcome {
        Ok((inverse, message)) => {
            // A restored deletion cannot be repeated, so it leaves no redo
            // step; everything else can be replayed.
            let repeatable = !matches!(inverse, UndoAction::RestoreTrash { .. });
            if reverse {
                if repeatable {
                    inner.undo.push_redo(label, inverse);
                }
            } else {
                inner.undo.push_undo(label, inverse);
            }
            if let Some(index) = inner.index.as_mut() {
                let _ = refresh_index(index, &repository, &action, reverse);
            }
            Ok(message)
        }
        Err(error) => {
            // Nothing changed, so the step stays where it was.
            if reverse {
                inner.undo.push_undo(label, action);
            } else {
                inner.undo.push_redo(label, action);
            }
            Err(error)
        }
    }
}

/// Apply one end of a recorded step. Returns the step that reverses it and a
/// short status message.
fn perform(
    repository: &Repository,
    backup_root: Option<&Path>,
    action: &UndoAction,
    reverse: bool,
) -> Result<(UndoAction, String), String> {
    match action {
        UndoAction::Save { path, content } => {
            let current = repository::read_text(repository, path).map_err(|error| error.to_string())?;
            let absolute = repository
                .resolve_for_write(path)
                .map_err(|error| error.to_string())?;
            let bytes = std::fs::read(&absolute)
                .map_err(|_| "The file could not be read.".to_string())?;
            let decoded = crate::encoding::decode(&bytes);
            let text = if reverse { content } else { &current };
            let encoded = crate::encoding::encode(text, decoded.encoding, decoded.eol);
            crate::atomic::atomic_write(&absolute, &encoded)
                .map_err(|_| "The file could not be restored.".to_string())?;
            let previous = if reverse { current } else { content.clone() };
            Ok((
                UndoAction::Save {
                    path: path.clone(),
                    content: previous,
                },
                if reverse {
                    format!("Restored {} to its previous text.", basename(path))
                } else {
                    format!("Reapplied the edit to {}.", basename(path))
                },
            ))
        }
        UndoAction::Move { from, to } => {
            let (source, destination) = if reverse {
                (to.as_str(), from.as_str())
            } else {
                (from.as_str(), to.as_str())
            };
            if let Err(error) = crate::revisions::remove_path(repository, destination) {
                crate::log::line("warn", &format!("stale revision path: {error}"));
            }
            let moved = repository::move_item(repository, source, &parent_of(destination))
                .map_err(|error| error.to_string())?;
            if let Err(error) = crate::revisions::move_path(repository, source, &moved) {
                crate::log::line("warn", &format!("revision move failed: {error}"));
            }
            let moved_action = if reverse {
                UndoAction::Move {
                    from: destination.to_string(),
                    to: moved.clone(),
                }
            } else {
                UndoAction::Move {
                    from: source.to_string(),
                    to: moved.clone(),
                }
            };
            Ok((moved_action, format!("Moved {moved}.")))
        }
        UndoAction::Create { path, is_dir } => {
            if reverse {
                let absolute = repository
                    .resolve_existing(path)
                    .map_err(|error| error.to_string())?;
                let metadata = std::fs::symlink_metadata(&absolute)
                    .map_err(|_| "The item no longer exists.".to_string())?;
                if metadata.is_dir() {
                    let empty = std::fs::read_dir(&absolute)
                        .map(|mut entries| entries.next().is_none())
                        .unwrap_or(false);
                    if !empty {
                        return Err(
                            "That folder now holds files, so it was left in place.".to_string()
                        );
                    }
                    std::fs::remove_dir(&absolute)
                        .map_err(|_| "The folder could not be removed.".to_string())?;
                } else {
                    std::fs::remove_file(&absolute)
                        .map_err(|_| "The file could not be removed.".to_string())?;
                }
                Ok((
                    UndoAction::Create {
                        path: path.clone(),
                        is_dir: *is_dir,
                    },
                    format!("Removed {path}."),
                ))
            } else {
                let created = repository::create_item(
                    repository,
                    &parent_of(path),
                    basename(path),
                    *is_dir,
                )
                .map_err(|error| error.to_string())?;
                Ok((
                    UndoAction::Create {
                        path: created.path.clone(),
                        is_dir: created.is_dir,
                    },
                    format!("Recreated {}.", created.path),
                ))
            }
        }
        UndoAction::RestoreTrash { entries } => {
            if reverse {
                let mut restored = Vec::with_capacity(entries.len());
                for entry in entries {
                    let path = undo::restore(repository, entry).map_err(|error| error.to_string())?;
                    restored.push(undo::TrashedEntry {
                        path,
                        ..entry.clone()
                    });
                }
                let message = match restored.first() {
                    Some(entry) => format!("Restored {}.", entry.path),
                    None => "Nothing to restore.".to_string(),
                };
                Ok((UndoAction::RestoreTrash { entries: restored }, message))
            } else {
                let _ = backup_root;
                Err("A restored item is not deleted again.".to_string())
            }
        }
    }
}

fn refresh_index(
    index: &mut Index,
    repository: &Repository,
    action: &UndoAction,
    _reverse: bool,
) -> Result<(), String> {
    match action {
        UndoAction::Save { path, .. } => {
            if let Ok(text) = repository::read_text(repository, path) {
                let name = basename(path).to_string();
                let size = text.len() as i64;
                index.upsert_file(path, &name, size, 0, Some(&text))?;
            }
        }
        UndoAction::Move { from, to } => {
            index.move_path(from, to)?;
        }
        UndoAction::Create { path, .. } => {
            index.remove_path(path)?;
        }
        UndoAction::RestoreTrash { entries } => {
            for entry in entries {
                index.remove_path(&entry.path)?;
            }
        }
    }
    Ok(())
}

fn parent_of(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<Settings, String> {
    let mut settings = settings.sanitize();
    if let Some(default_repository) = settings.default_repository.clone() {
        let path = PathBuf::from(default_repository);
        match Repository::open(&path) {
            Ok(repository) => {
                settings.default_repository =
                    Some(repository.root().to_string_lossy().to_string());
            }
            Err(_) => {
                return Err("The default repository folder could not be opened.".to_string());
            }
        }
    }
    // The list and the last opened repository are server-managed; a settings
    // save must never erase them with whatever the front end sent.
    {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        settings.recent_repositories = inner.settings.recent_repositories.clone();
        settings.last_repository = inner.settings.last_repository.clone();
    }

    settings::save(&state.settings_path(), &settings).map_err(|error| error.to_string())?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    inner.settings = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn remove_recent_repository(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<Vec<RepositoryEntry>, String> {
    let (settings_snapshot, settings_path) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        if let Some(repository) = inner.repository.as_ref() {
            let current = crate::paths::display_path(repository.root());
            if same_path(&current, &path) {
                return Err(
                    "Switch to another repository before removing this one.".to_string()
                );
            }
        }
        forget_repository(&mut inner.settings, &path);
        (inner.settings.clone(), state.settings_path())
    };

    settings::save(&settings_path, &settings_snapshot).map_err(|error| error.to_string())?;
    Ok(recent_entries(&settings_snapshot))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repository_in(parent: &Path, name: &str) -> Repository {
        let root = parent.join(name);
        fs::create_dir_all(&root).unwrap();
        Repository::open(&root).unwrap()
    }

    #[test]
    fn remember_repository_orders_and_dedupes() {
        let temp = tempfile::tempdir().unwrap();
        let first = repository_in(temp.path(), "one");
        let second = repository_in(temp.path(), "two");
        let first_path = crate::paths::display_path(first.root());
        let second_path = crate::paths::display_path(second.root());
        let mut settings = Settings::default();

        remember_repository(&mut settings, &first);
        remember_repository(&mut settings, &second);
        assert_eq!(
            settings.recent_repositories,
            vec![second_path.clone(), first_path.clone()]
        );
        assert_eq!(settings.last_repository.as_deref(), Some(second_path.as_str()));

        // Reopening an older repository moves it to the front without growing
        // the list.
        remember_repository(&mut settings, &first);
        assert_eq!(
            settings.recent_repositories,
            vec![first_path.clone(), second_path.clone()]
        );
        assert_eq!(settings.last_repository.as_deref(), Some(first_path.as_str()));
    }

    #[test]
    fn remember_repository_truncates_to_twenty() {
        let temp = tempfile::tempdir().unwrap();
        let repositories: Vec<Repository> = (0..25)
            .map(|index| repository_in(temp.path(), &format!("repo{index}")))
            .collect();
        let mut settings = Settings::default();
        for repository in &repositories {
            remember_repository(&mut settings, repository);
        }

        assert_eq!(settings.recent_repositories.len(), 20);
        assert_eq!(
            settings.recent_repositories[0],
            crate::paths::display_path(repositories[24].root())
        );
        assert_eq!(
            settings.recent_repositories[19],
            crate::paths::display_path(repositories[5].root())
        );
        let newest = crate::paths::display_path(repositories[24].root());
        assert_eq!(settings.last_repository.as_deref(), Some(newest.as_str()));
    }

    #[test]
    fn recent_entries_report_names_and_existence() {
        let temp = tempfile::tempdir().unwrap();
        let existing = temp.path().join("Notes");
        fs::create_dir(&existing).unwrap();
        let missing = temp.path().join("Gone");
        let existing_path = crate::paths::display_path(&existing);
        let missing_path = crate::paths::display_path(&missing);
        let settings = Settings {
            recent_repositories: vec![existing_path.clone(), missing_path.clone()],
            ..Settings::default()
        };

        let entries = recent_entries(&settings);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, existing_path);
        assert_eq!(entries[0].name, "Notes");
        assert!(entries[0].exists);
        assert_eq!(entries[1].path, missing_path);
        assert_eq!(entries[1].name, "Gone");
        assert!(!entries[1].exists);
    }

    #[test]
    fn forgetting_a_repository_points_at_the_newest_remaining_entry() {
        let mut settings = Settings {
            recent_repositories: vec!["C:/one".into(), "C:/two".into()],
            last_repository: Some("C:/one".into()),
            ..Settings::default()
        };

        assert!(forget_repository(&mut settings, "C:/one"));
        assert_eq!(settings.recent_repositories, vec!["C:/two".to_string()]);
        assert_eq!(settings.last_repository.as_deref(), Some("C:/two"));

        assert!(forget_repository(&mut settings, "C:/two"));
        assert!(settings.recent_repositories.is_empty());
        assert_eq!(settings.last_repository, None);

        assert!(!forget_repository(&mut settings, "C:/missing"));
    }
}
