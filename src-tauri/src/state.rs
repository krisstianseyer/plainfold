use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;

use crate::index::Index;
use crate::paths::Vault;
use crate::settings::{self, Settings};
use crate::undo::History;

pub struct Inner {
    pub settings: Settings,
    pub settings_notice: Option<String>,
    pub vault: Option<Vault>,
    pub index: Option<Index>,
    pub index_notice: Option<String>,
    pub watcher: Option<RecommendedWatcher>,
    pub undo: History,
    pub undo_backup_dir: Option<PathBuf>,
}

pub struct AppState {
    pub inner: Mutex<Inner>,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        let loaded = settings::load(&settings::settings_path(&config_dir));
        Self {
            inner: Mutex::new(Inner {
                settings: loaded.settings,
                settings_notice: loaded.notice,
                vault: None,
                index: None,
                index_notice: None,
                watcher: None,
                undo: History::default(),
                undo_backup_dir: None,
            }),
            config_dir,
            data_dir,
        }
    }

    pub fn settings_path(&self) -> PathBuf {
        settings::settings_path(&self.config_dir)
    }

    /// Undo copies for the open vault live beside its search index so they
    /// never appear inside the vault itself.
    pub fn undo_backup_dir(&self, root: &std::path::Path) -> PathBuf {
        crate::index::index_database_path(&self.data_dir, root)
            .with_extension("undo")
    }
}
