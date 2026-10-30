use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic::{atomic_create, atomic_write};
use crate::errors::{AppError, AppResult};
use crate::revisions::Retention;

const MAX_DISABLED_FEATURES: usize = 200;
const MAX_FEATURE_ID_CHARS: usize = 80;
const MAX_RECENT_REPOSITORIES: usize = 20;
const MIN_RECENT_REPOSITORY_LIMIT: u32 = 1;
const MAX_RECENT_REPOSITORY_LIMIT: u32 = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub default_sort: String,
    #[serde(alias = "defaultVault")]
    pub default_repository: Option<String>,
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
    #[serde(default)]
    pub disabled_features: Vec<String>,
    #[serde(default)]
    pub recent_repositories: Vec<String>,
    #[serde(default)]
    pub last_repository: Option<String>,
    #[serde(default)]
    pub recent_repository_limit: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            font_family: "Consolas".into(),
            font_size: 14,
            default_sort: "name".into(),
            default_repository: None,
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
            disabled_features: Vec::new(),
            recent_repositories: Vec::new(),
            last_repository: None,
            recent_repository_limit: 8,
        }
    }
}

impl Settings {
    pub fn sanitize(mut self) -> Self {
        if !matches!(
            self.theme.as_str(),
            "light"
                | "dark"
                | "system"
                | "sepia"
                | "nord"
                | "solarized-light"
                | "solarized-dark"
                | "midnight"
                | "forest"
        ) {
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

        let mut seen_features = HashSet::new();
        self.disabled_features = self
            .disabled_features
            .into_iter()
            .filter_map(|value| {
                let value = clean_text(&value)?;
                let value: String = value.chars().take(MAX_FEATURE_ID_CHARS).collect();
                if !value.is_empty() && seen_features.insert(value.clone()) {
                    Some(value)
                } else {
                    None
                }
            })
            .take(MAX_DISABLED_FEATURES)
            .collect();

        let mut seen_repositories = HashSet::new();
        let mut repositories = Vec::new();
        for value in self.recent_repositories {
            let Some(value) = clean_text(&value) else {
                continue;
            };
            if seen_repositories.insert(repository_key(&value)) {
                repositories.push(value);
            }
            if repositories.len() == MAX_RECENT_REPOSITORIES {
                break;
            }
        }
        self.recent_repositories = repositories;
        self.last_repository = match self.last_repository.take() {
            Some(value) => clean_text(&value),
            None => None,
        };
        self.recent_repository_limit = self.recent_repository_limit.clamp(
            MIN_RECENT_REPOSITORY_LIMIT,
            MAX_RECENT_REPOSITORY_LIMIT,
        );
        self
    }

    /// A feature is enabled unless its id was explicitly disabled. Unknown ids
    /// are kept so a newer build can still understand an older settings file.
    pub fn feature_enabled(&self, id: &str) -> bool {
        !self.disabled_features.iter().any(|feature| feature == id)
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

/// Trim a user-supplied string and reject empties and control characters.
fn clean_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Windows paths are case-insensitive; other platforms compare exactly.
fn repository_key(value: &str) -> String {
    #[cfg(windows)]
    {
        value.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        value.to_string()
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
        assert!(loaded.settings.disabled_features.is_empty());
        assert!(loaded.settings.recent_repositories.is_empty());
        assert_eq!(loaded.settings.last_repository, None);
        assert_eq!(loaded.settings.recent_repository_limit, 8);
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
            disabled_features: vec![" watcher ".into(), "watcher".into(), "revisions".into()],
            recent_repositories: vec![
                " C:\\Notes ".into(),
                "C:\\Notes".into(),
                "/home/me/notes".into(),
            ],
            last_repository: Some(" C:\\Notes ".into()),
            recent_repository_limit: 99,
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
        assert_eq!(
            loaded.settings.disabled_features,
            vec!["watcher".to_string(), "revisions".to_string()]
        );
        assert_eq!(
            loaded.settings.recent_repositories,
            vec!["C:\\Notes".to_string(), "/home/me/notes".to_string()]
        );
        assert_eq!(loaded.settings.last_repository.as_deref(), Some("C:\\Notes"));
        assert_eq!(loaded.settings.recent_repository_limit, 20);
    }

    #[test]
    fn sanitize_cleans_and_dedupes_new_lists() {
        let settings = Settings {
            disabled_features: vec![
                " watcher ".into(),
                "watcher".into(),
                "".into(),
                "   ".into(),
                "bad\u{0}id".into(),
                "x".repeat(100),
            ],
            recent_repositories: vec![
                " C:\\Notes ".into(),
                "C:\\Notes".into(),
                "".into(),
                "bad\npath".into(),
                "/home/me/notes".into(),
            ],
            last_repository: Some(" C:\\Notes ".into()),
            recent_repository_limit: 0,
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(
            settings.disabled_features,
            vec!["watcher".to_string(), "x".repeat(80)]
        );
        assert_eq!(
            settings.recent_repositories,
            vec!["C:\\Notes".to_string(), "/home/me/notes".to_string()]
        );
        assert_eq!(settings.last_repository.as_deref(), Some("C:\\Notes"));
        assert_eq!(settings.recent_repository_limit, 1);
    }

    #[test]
    fn sanitize_caps_feature_and_repository_counts() {
        let settings = Settings {
            disabled_features: (0..250).map(|index| format!("feature{index}")).collect(),
            recent_repositories: (0..25).map(|index| format!("/notes/{index}")).collect(),
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.disabled_features.len(), 200);
        assert_eq!(settings.recent_repositories.len(), 20);
    }

    #[cfg(windows)]
    #[test]
    fn windows_repository_paths_dedupe_case_insensitively() {
        let settings = Settings {
            recent_repositories: vec!["C:\\Notes".into(), "c:\\notes".into()],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.recent_repositories, vec!["C:\\Notes".to_string()]);
    }

    #[test]
    fn feature_enabled_only_when_not_disabled() {
        let mut settings = Settings::default();
        assert!(settings.feature_enabled("watcher"));
        assert!(settings.feature_enabled("revisions"));

        settings.disabled_features = vec!["watcher".into(), "revisions.contextAction".into()];
        assert!(!settings.feature_enabled("watcher"));
        assert!(settings.feature_enabled("revisions"));
        assert!(!settings.feature_enabled("revisions.contextAction"));
    }
}
