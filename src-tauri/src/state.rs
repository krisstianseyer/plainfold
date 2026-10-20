use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;

use crate::index::Index;
use crate::paths::Vault;
use crate::settings::{self, Settings};

pub struct Inner {
    pub settings: Settings,
    pub settings_notice: Option<String>,
    pub vault: Option<Vault>,
    pub index: Option<Index>,
    pub index_notice: Option<String>,
    pub watcher: Option<RecommendedWatcher>,
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
            }),
            config_dir,
            data_dir,
        }
    }

    pub fn settings_path(&self) -> PathBuf {
        settings::settings_path(&self.config_dir)
    }
}
