use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic::{atomic_create, atomic_write};
use crate::errors::{AppError, AppResult};
use crate::revisions::Retention;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub default_sort: String,
    pub default_vault: Option<String>,
    pub tab_width: u32,
    pub pinned_limit: u32,
    pub recent_limit: u32,
    pub autosave_mode: String,
    pub autosave_idle_secs: u32,
    pub autosave_interval_secs: u32,
    pub revision_hourly: u32,
    pub revision_daily: u32,
    pub revision_weekly: u32,
    pub revision_monthly: u32,
    pub revision_yearly: u32,
    pub desktop_shortcut_prompted: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            font_family: "Consolas".into(),
            font_size: 14,
            default_sort: "name".into(),
            default_vault: None,
            tab_width: 4,
            pinned_limit: 5,
            recent_limit: 5,
            autosave_mode: "off".into(),
            autosave_idle_secs: 20,
            autosave_interval_secs: 120,
            revision_hourly: 24,
            revision_daily: 7,
            revision_weekly: 4,
            revision_monthly: 12,
            revision_yearly: 100,
            desktop_shortcut_prompted: false,
        }
    }
}

impl Settings {
    pub fn sanitize(mut self) -> Self {
        if !matches!(self.theme.as_str(), "light" | "dark" | "system") {
            self.theme = "system".into();
        }
        if !matches!(self.default_sort.as_str(), "name" | "modified" | "size") {
            self.default_sort = "name".into();
        }
        self.font_size = self.font_size.clamp(8, 48);
        self.tab_width = self.tab_width.clamp(1, 16);
        self.pinned_limit = self.pinned_limit.clamp(1, 100);
        self.recent_limit = self.recent_limit.clamp(1, 100);
        if !matches!(self.autosave_mode.as_str(), "off" | "idle" | "interval") {
            self.autosave_mode = "off".into();
        }
        self.autosave_idle_secs = self.autosave_idle_secs.clamp(1, 60);
        self.autosave_interval_secs = self.autosave_interval_secs.clamp(120, 3600);
        self.revision_hourly = self.revision_hourly.min(1000);
        self.revision_daily = self.revision_daily.min(1000);
        self.revision_weekly = self.revision_weekly.min(1000);
        self.revision_monthly = self.revision_monthly.min(1000);
        self.revision_yearly = self.revision_yearly.min(1000);
        if self.font_family.trim().is_empty() {
            self.font_family = Settings::default().font_family;
        }
        self
    }

    pub fn retention(&self) -> Retention {
        Retention {
            hourly: self.revision_hourly,
            daily: self.revision_daily,
            weekly: self.revision_weekly,
            monthly: self.revision_monthly,
            yearly: self.revision_yearly,
        }
    }
}

pub struct LoadedSettings {
    pub settings: Settings,
    pub notice: Option<String>,
}

pub fn load(path: &Path) -> LoadedSettings {
    match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Settings>(&text) {
            Ok(settings) => LoadedSettings {
                settings: settings.sanitize(),
                notice: None,
            },
            Err(_) => LoadedSettings {
                settings: Settings::default(),
                notice: Some(
                    "The settings file could not be read. Default settings are in use.".into(),
                ),
            },
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => LoadedSettings {
            settings: Settings::default(),
            notice: None,
        },
        Err(_) => LoadedSettings {
            settings: Settings::default(),
            notice: Some("The settings file could not be opened. Default settings are in use.".into()),
        },
    }
}

pub fn save(path: &Path, settings: &Settings) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| AppError::new("The settings folder could not be created."))?;
    }
    let settings = settings.clone().sanitize();
    let json = serde_json::to_vec_pretty(&settings)
        .map_err(|_| AppError::new("The settings could not be written."))?;
    if path.exists() {
        atomic_write(path, &json)
            .map_err(|_| AppError::new("The settings could not be saved."))?;
    } else {
        atomic_create(path, &json)
            .map_err(|_| AppError::new("The settings could not be saved."))?;
    }
    Ok(())
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults_without_notice() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load(&dir.path().join("settings.json"));
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.notice.is_none());
    }

    #[test]
    fn corrupt_file_gives_defaults_and_notice() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{not json").unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.settings, Settings::default());
        assert!(loaded.notice.is_some());
    }

    #[test]
    fn round_trips_and_clamps() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = Settings {
            tab_width: 99,
            font_size: 1,
            pinned_limit: 0,
            recent_limit: 999,
            autosave_mode: "bad".into(),
            autosave_idle_secs: 0,
            autosave_interval_secs: 1,
            revision_hourly: 0,
            revision_daily: 9999,
            revision_weekly: 4,
            revision_monthly: 12,
            revision_yearly: 100,
            theme: "dark".into(),
            ..Settings::default()
        };
        save(&path, &settings).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.settings.tab_width, 16);
        assert_eq!(loaded.settings.font_size, 8);
        assert_eq!(loaded.settings.pinned_limit, 1);
        assert_eq!(loaded.settings.recent_limit, 100);
        assert_eq!(loaded.settings.autosave_mode, "off");
        assert_eq!(loaded.settings.autosave_idle_secs, 1);
        assert_eq!(loaded.settings.autosave_interval_secs, 120);
        assert_eq!(loaded.settings.revision_hourly, 0);
        assert_eq!(loaded.settings.revision_daily, 1000);
        assert_eq!(loaded.settings.revision_weekly, 4);
        assert_eq!(loaded.settings.revision_monthly, 12);
        assert_eq!(loaded.settings.revision_yearly, 100);
        assert_eq!(loaded.settings.theme, "dark");
    }
}
