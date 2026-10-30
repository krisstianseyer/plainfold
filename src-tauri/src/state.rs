use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;

use crate::index::Index;
use crate::paths::Repository;
use crate::settings::{self, Settings};
use crate::undo::History;

pub struct Inner {
    pub settings: Settings,
    pub settings_notice: Option<String>,
    pub repository: Option<Repository>,
    pub index: Option<Index>,
    pub index_notice: Option<String>,
    pub watcher: Option<RecommendedWatcher>,
    pub undo: History,
    pub undo_backup_dir: Option<PathBuf>,
}

pub struct AppState {
    pub inner: Mutex<Inner>,
    /// Serializes every read/merge/mutate/save cycle for settings.json so a
    /// repository open, removal, or settings save cannot write an older
    /// snapshot over a newer one.
    pub settings_write: Mutex<()>,
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
                repository: None,
                index: None,
                index_notice: None,
                watcher: None,
                undo: History::default(),
                undo_backup_dir: None,
            }),
            settings_write: Mutex::new(()),
            config_dir,
            data_dir,
        }
    }

    pub fn settings_path(&self) -> PathBuf {
        settings::settings_path(&self.config_dir)
    }

    /// Undo copies for the open repository live beside its search index so they
    /// never appear inside the repository itself.
    pub fn undo_backup_dir(&self, root: &std::path::Path) -> PathBuf {
        crate::index::index_database_path(&self.data_dir, root)
            .with_extension("undo")
    }
}
