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
pub struct Snapshot {
    pub version: String,
    pub settings: Settings,
    pub repository: Option<RepositoryInfo>,
    pub tree: Vec<TreeNode>,
    pub notices: Vec<String>,
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
    let (settings_notice, default_repository) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        (inner.settings_notice.take(), inner.settings.default_repository.clone())
    };

    let mut notices = Vec::new();
    if let Some(notice) = settings_notice {
        notices.push(notice);
    }

    if let Some(path) = default_repository {
        let arc: Arc<AppState> = (*state).clone();
        let opened = spawn_blocking(move || open_repository_impl(&arc, &app, PathBuf::from(path)))
            .await
            .map_err(|_| "The operation could not be completed.".to_string())?;
        match opened {
            Ok(mut snapshot) => {
                let mut combined = notices;
                combined.append(&mut snapshot.notices);
                snapshot.notices = combined;
                return Ok(snapshot);
            }
            Err(_) => notices.push(
                "The default repository folder could not be opened. Choose a folder to begin."
                    .to_string(),
            ),
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

    let watcher = match watcher::start(app.clone(), Arc::clone(state), repository.clone()) {
        Ok(watcher) => Some(watcher),
        Err(error) => {
            notices.push(format!(
                "{error} Changes made by other programs may not be detected."
            ));
            None
        }
    };

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;

    inner.watcher = None;
    inner.watcher = watcher;
    inner.index_notice = index_notice;
    inner.repository = Some(repository.clone());
    inner.index = index;
    inner.undo.reset();
    let backup = state.undo_backup_dir(repository.root());
    undo::prune(&backup, UNDO_WINDOW);
    inner.undo_backup_dir = Some(backup);

    let sort = SortOrder::parse(&inner.settings.default_sort);
    let tree = tree::build_tree(&repository, sort, inner.index.as_ref());

    Ok(Snapshot {
        version: env!("CARGO_PKG_VERSION").to_string(),
        settings: inner.settings.clone(),
        repository: Some(RepositoryInfo {
            path: crate::paths::display_path(repository.root()),
            name: repository
                .root()
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "repository".to_string()),
        }),
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
    let outcome = repository::save_file_with_revisions(
        &repository,
        path,
        content,
        encoding,
        eol,
        Some(inner.settings.retention()),
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
    settings::save(&state.settings_path(), &settings).map_err(|error| error.to_string())?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    inner.settings = settings.clone();
    Ok(settings)
}
