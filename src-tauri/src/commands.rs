use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri::async_runtime::spawn_blocking;

use crate::encoding::should_index_size;
use crate::index::{index_database_path, Index, SearchHit, TagCount};
use crate::paths::Vault;
use crate::settings::{self, Settings};
use crate::state::AppState;
use crate::tree::{self, SortOrder, TreeNode};
use crate::vault::{
    self, CreatedItem, FileRead, SaveOutcome,
};
use crate::watcher;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub vault: Option<VaultInfo>,
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
pub fn bootstrap(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<Snapshot, String> {
    let (settings_notice, default_vault) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Plainfold could not read its state.".to_string())?;
        (inner.settings_notice.take(), inner.settings.default_vault.clone())
    };

    let mut notices = Vec::new();
    if let Some(notice) = settings_notice {
        notices.push(notice);
    }

    if let Some(path) = default_vault {
        let arc: Arc<AppState> = (*state).clone();
        match open_vault_impl(&arc, &app, PathBuf::from(path)) {
            Ok(mut snapshot) => {
                let mut combined = notices;
                combined.append(&mut snapshot.notices);
                snapshot.notices = combined;
                return Ok(snapshot);
            }
            Err(_) => notices.push(
                "The default vault folder could not be opened. Choose a folder to begin."
                    .to_string(),
            ),
        }
    }

    let inner = state
        .inner
        .lock()
        .map_err(|_| "Plainfold could not read its state.".to_string())?;
    Ok(Snapshot {
        settings: inner.settings.clone(),
        vault: None,
        tree: Vec::new(),
        notices,
    })
}

#[tauri::command]
pub async fn open_vault(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    path: String,
) -> Result<Snapshot, String> {
    let arc: Arc<AppState> = (*state).clone();
    spawn_blocking(move || open_vault_impl(&arc, &app, PathBuf::from(path)))
        .await
        .map_err(|_| "The operation could not be completed.".to_string())?
}

fn open_vault_impl(
    state: &Arc<AppState>,
    app: &AppHandle,
    path: PathBuf,
) -> Result<Snapshot, String> {
    let vault = Vault::open(&path).map_err(|error| error.to_string())?;
    let mut notices = Vec::new();

    let database = index_database_path(&state.data_dir, vault.root());
    let mut index_notice = None;
    let index = match Index::open(&database, vault.root()) {
        Ok(mut index) => match tree::rescan_index(&mut index, &vault) {
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

    let watcher = match watcher::start(app.clone(), Arc::clone(state), vault.clone()) {
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
    inner.vault = Some(vault.clone());
    inner.index = index;

    let sort = SortOrder::parse(&inner.settings.default_sort);
    let tree = tree::build_tree(&vault, sort, inner.index.as_ref());

    Ok(Snapshot {
        settings: inner.settings.clone(),
        vault: Some(VaultInfo {
            path: vault.root().to_string_lossy().to_string(),
            name: vault
                .root()
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Vault".to_string()),
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
    let Some(vault) = inner.vault.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(tree::build_tree(
        vault,
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?;
    let file = vault::read_file(vault, path).map_err(|error| error.to_string())?;
    if let Some(index) = inner.index.as_mut() {
        let _ = index.record_recent(path);
    }
    Ok(file)
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?
        .clone();
    let outcome = vault::save_file(&vault, path, content, encoding, eol)
        .map_err(|error| error.to_string())?;
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?
        .clone();
    let created = vault::create_item(&vault, parent, name, is_dir)
        .map_err(|error| error.to_string())?;
    if !created.is_dir {
        if let Some(index) = inner.index.as_mut() {
            let leaf = created.path.rsplit('/').next().unwrap_or(&created.path).to_string();
            let absolute = vault.root().join(&created.path);
            let metadata = std::fs::metadata(&absolute).ok();
            let size = metadata.as_ref().map(|meta| meta.len() as i64).unwrap_or(0);
            let mtime = metadata
                .as_ref()
                .and_then(|meta| meta.modified().ok())
                .map(crate::vault::system_ms)
                .unwrap_or(0);
            let _ = index.upsert_file(&created.path, &leaf, size, mtime, Some(""));
        }
    }
    Ok(created)
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?;
    vault::delete_item(vault, path).map_err(|error| error.to_string())?;
    if let Some(index) = inner.index.as_mut() {
        let _ = index.remove_path(path);
    }
    Ok(())
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
            .unwrap_or_else(|| "Search is unavailable for this vault.".to_string())
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?
        .clone();
    if inner.index.is_none() {
        let database = index_database_path(&state.data_dir, vault.root());
        match Index::open(&database, vault.root()) {
            Ok(index) => {
                inner.index = Some(index);
                inner.index_notice = None;
            }
            Err(error) => return Err(error),
        }
    }
    let index = inner.index.as_mut().expect("index was opened");
    tree::rescan_index(index, &vault)
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
        recents: index.recents(20),
    })
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?;
    vault
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?;
    vault
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
    let vault = inner
        .vault
        .as_ref()
        .ok_or_else(|| "Open a vault first.".to_string())?;
    if !parent.is_empty() {
        vault
            .resolve_dir(&parent)
            .map_err(|error| error.to_string())?;
    }
    let index = inner.index.as_mut().ok_or_else(|| {
        "Custom order is unavailable because the search index is not open.".to_string()
    })?;
    index.set_sort_order(&parent, &names)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<Settings, String> {
    let mut settings = settings.sanitize();
    if let Some(default_vault) = settings.default_vault.clone() {
        let path = PathBuf::from(default_vault);
        match Vault::open(&path) {
            Ok(vault) => {
                settings.default_vault =
                    Some(vault.root().to_string_lossy().to_string());
            }
            Err(_) => {
                return Err("The default vault folder could not be opened.".to_string());
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
