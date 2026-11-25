use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic::{atomic_create, atomic_write};
use crate::errors::{AppError, AppResult};
use crate::revisions::Retention;

const MAX_DISABLED_FEATURES: usize = 200;
const MAX_FEATURE_ID_CHARS: usize = 80;
const MAX_RECENT_REPOSITORIES: usize = 20;
const DEFAULT_RECENT_REPOSITORY_LIMIT: u32 = 8;
const MIN_RECENT_REPOSITORY_LIMIT: u32 = 1;
const MAX_RECENT_REPOSITORY_LIMIT: u32 = 20;
const MAX_ACCENT_AREAS: usize = 20;
const MAX_COLOR_RULES: usize = 200;
const MAX_COLOR_OVERRIDES: usize = 500;
const MAX_COLOR_EXTENSION_CHARS: usize = 24;
const MAX_COLOR_OVERRIDE_PATH_CHARS: usize = 1024;
const ACCENT_AREAS: [&str; 6] = [
    "titlebar",
    "fileHeader",
    "statusbar",
    "sidebar",
    "controls",
    "editor",
];

fn default_content_background() -> String {
    "theme".into()
}

fn default_accent_areas() -> Vec<String> {
    ACCENT_AREAS
        .iter()
        .map(|area| (*area).to_string())
        .collect()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ColorPair {
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ColorRule {
    pub kind: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    #[serde(default = "default_content_background")]
    pub content_background: String,
    #[serde(default = "default_accent_areas")]
    pub accent_areas: Vec<String>,
    #[serde(default = "default_true")]
    pub layout_menu_titlebar: bool,
    #[serde(default)]
    pub layout_statusbar: bool,
    #[serde(default)]
    pub layout_file_actions: bool,
    pub font_family: String,
    pub font_size: u32,
    pub default_sort: String,
    #[serde(alias = "defaultVault")]
    pub default_repository: Option<String>,
    pub tab_width: u32,
    pub pinned_limit: u32,
    pub recent_limit: u32,
    pub autosave_enabled: bool,
    pub autosave_idle_secs: u32,
    /// Legacy v1.2-v1.5 autosave mode; read once by `sanitize` and never
    /// written back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autosave_mode: Option<String>,
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
    #[serde(default = "default_recent_repository_limit")]
    pub recent_repository_limit: u32,
    #[serde(default = "default_true")]
    pub color_icons: bool,
    #[serde(default)]
    pub color_rules: Vec<ColorRule>,
    #[serde(default)]
    pub color_overrides: HashMap<String, ColorPair>,
}

fn default_recent_repository_limit() -> u32 {
    DEFAULT_RECENT_REPOSITORY_LIMIT
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "white".into(),
            accent: "slate".into(),
            content_background: default_content_background(),
            accent_areas: default_accent_areas(),
            layout_menu_titlebar: true,
            layout_statusbar: false,
            layout_file_actions: false,
            font_family: "Consolas".into(),
            font_size: 14,
            default_sort: "name".into(),
            default_repository: None,
            tab_width: 4,
            pinned_limit: 5,
            recent_limit: 5,
            autosave_enabled: false,
            autosave_idle_secs: 20,
            autosave_mode: None,
            revision_hourly: 24,
            revision_daily: 7,
            revision_weekly: 4,
            revision_monthly: 12,
            revision_yearly: 100,
            desktop_shortcut_prompted: false,
            disabled_features: Vec::new(),
            recent_repositories: Vec::new(),
            last_repository: None,
            recent_repository_limit: default_recent_repository_limit(),
            color_icons: true,
            color_rules: Vec::new(),
            color_overrides: HashMap::new(),
        }
    }
}

impl Settings {
    pub fn sanitize(mut self) -> Self {
        if !matches!(
            self.theme.as_str(),
            "light"
                | "white"
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
        if !matches!(
            self.accent.as_str(),
            "theme" | "blue" | "teal" | "green" | "amber" | "orange" | "rose" | "violet" | "slate"
        ) {
            self.accent = "theme".into();
        }
        if !matches!(
            self.content_background.as_str(),
            "theme" | "white" | "paper" | "gray" | "dark" | "black"
        ) {
            self.content_background = default_content_background();
        }
        let mut seen_areas = HashSet::new();
        self.accent_areas = self
            .accent_areas
            .into_iter()
            .filter_map(|value| {
                let value = clean_text(&value)?;
                if ACCENT_AREAS.contains(&value.as_str()) && seen_areas.insert(value.clone()) {
                    Some(value)
                } else {
                    None
                }
            })
            .take(MAX_ACCENT_AREAS)
            .collect();
        if !matches!(self.default_sort.as_str(), "name" | "modified" | "size") {
            self.default_sort = "name".into();
        }
        self.font_size = self.font_size.clamp(8, 48);
        self.tab_width = self.tab_width.clamp(1, 16);
        self.pinned_limit = self.pinned_limit.clamp(1, 100);
        self.recent_limit = self.recent_limit.clamp(1, 100);
        if let Some(mode) = self.autosave_mode.take() {
            if matches!(mode.as_str(), "idle" | "interval") {
                self.autosave_enabled = true;
            }
        }
        self.autosave_idle_secs = self.autosave_idle_secs.clamp(1, 3600);
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
        self.recent_repository_limit = self
            .recent_repository_limit
            .clamp(MIN_RECENT_REPOSITORY_LIMIT, MAX_RECENT_REPOSITORY_LIMIT);

        let mut seen_extensions = HashSet::new();
        let mut seen_sections = HashSet::new();
        let mut seen_color_repositories = HashSet::new();
        let mut seen_folder = false;
        let mut seen_other = false;
        let mut rules = Vec::new();
        for mut rule in self.color_rules {
            rule.kind = rule.kind.trim().to_lowercase();
            rule.icon = normalize_hex_color(rule.icon.as_deref());
            rule.label = normalize_hex_color(rule.label.as_deref());
            if rule.icon.is_none() && rule.label.is_none() {
                continue;
            }
            match rule.kind.as_str() {
                "extension" => {
                    let target = rule.target.trim().trim_start_matches('.').to_lowercase();
                    if target.is_empty() || target.chars().count() > MAX_COLOR_EXTENSION_CHARS {
                        continue;
                    }
                    if !seen_extensions.insert(target.clone()) {
                        continue;
                    }
                    rule.target = target;
                }
                "section" => {
                    let target = rule.target.trim().to_lowercase();
                    if !matches!(
                        target.as_str(),
                        "files" | "pinned" | "recent" | "repositories"
                    ) || !seen_sections.insert(target.clone())
                    {
                        continue;
                    }
                    rule.target = target;
                }
                "repository" => {
                    let target = rule.target.trim().to_string();
                    if target.is_empty()
                        || target.chars().count() > MAX_COLOR_OVERRIDE_PATH_CHARS
                        || !seen_color_repositories.insert(target.clone())
                    {
                        continue;
                    }
                    rule.target = target;
                }
                "folder" => {
                    if seen_folder {
                        continue;
                    }
                    seen_folder = true;
                    rule.target = String::new();
                }
                "other" => {
                    if seen_other {
                        continue;
                    }
                    seen_other = true;
                    rule.target = String::new();
                }
                _ => continue,
            }
            rules.push(rule);
            if rules.len() == MAX_COLOR_RULES {
                break;
            }
        }
        self.color_rules = rules;

        let mut keys: Vec<String> = self.color_overrides.keys().cloned().collect();
        keys.sort();
        let mut overrides = HashMap::new();
        for key in keys {
            let trimmed = key.trim();
            if trimmed.is_empty()
                || trimmed.chars().count() > MAX_COLOR_OVERRIDE_PATH_CHARS
                || !is_relative_path(trimmed)
            {
                continue;
            }
            let Some(pair) = self.color_overrides.get(&key) else {
                continue;
            };
            let pair = ColorPair {
                icon: normalize_hex_color(pair.icon.as_deref()),
                label: normalize_hex_color(pair.label.as_deref()),
            };
            if pair.icon.is_none() && pair.label.is_none() {
                continue;
            }
            overrides.insert(trimmed.to_string(), pair);
            if overrides.len() == MAX_COLOR_OVERRIDES {
                break;
            }
        }
        self.color_overrides = overrides;
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

/// Normalize a `#rgb`, `#rrggbb`, or `#rrggbbaa` color; anything else is dropped.
fn normalize_hex_color(value: Option<&str>) -> Option<String> {
    let value = clean_text(value?)?;
    let hex = value.strip_prefix('#')?;
    if !matches!(hex.len(), 3 | 6 | 8) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", hex.to_lowercase()))
}

/// Override keys are repository-relative: no absolute paths and no `..` segments.
fn is_relative_path(value: &str) -> bool {
    if value.starts_with('/') {
        return false;
    }
    let bytes = value.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return false;
    }
    !value.split(['/', '\\']).any(|segment| segment == "..")
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
            notice: Some(
                "The settings file could not be opened. Default settings are in use.".into(),
            ),
        },
    }
}

/// Keep the fields the backend manages even when a settings save carries old
/// values. This is what makes a front-end settings save unable to erase the
/// saved repository list or the last-opened pointer.
pub fn preserve_server_managed(mut settings: Settings, current: &Settings) -> Settings {
    settings.recent_repositories = current.recent_repositories.clone();
    settings.last_repository = current.last_repository.clone();
    settings
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
        atomic_write(path, &json).map_err(|_| AppError::new("The settings could not be saved."))?;
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
    fn older_settings_without_recent_limit_keep_the_eight_entry_default() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .remove("recentRepositoryLimit");
        let loaded: Settings = serde_json::from_value(value).unwrap();

        assert_eq!(loaded.sanitize().recent_repository_limit, 8);
    }

    #[test]
    fn preserve_server_managed_ignores_incoming_repository_fields() {
        let current = Settings {
            recent_repositories: vec!["C:\\Current".into()],
            last_repository: Some("C:\\Current".into()),
            ..Settings::default()
        };
        let incoming = Settings {
            theme: "dark".into(),
            recent_repositories: vec![],
            last_repository: Some("C:\\Stale".into()),
            ..Settings::default()
        }
        .sanitize();

        let preserved = preserve_server_managed(incoming, &current);
        assert_eq!(preserved.theme, "dark");
        assert_eq!(
            preserved.recent_repositories,
            vec!["C:\\Current".to_string()]
        );
        assert_eq!(preserved.last_repository.as_deref(), Some("C:\\Current"));
    }

    #[test]
    fn white_theme_survives_sanitize() {
        let settings = Settings {
            theme: "white".into(),
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.theme, "white");
    }

    #[test]
    fn accent_choices_survive_sanitize() {
        let valid = Settings {
            accent: "violet".into(),
            ..Settings::default()
        }
        .sanitize();
        let invalid = Settings {
            accent: "neon".into(),
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(valid.accent, "violet");
        assert_eq!(invalid.accent, "theme");
    }

    #[test]
    fn content_background_and_accent_areas_survive_sanitize() {
        let settings = Settings {
            content_background: "white".into(),
            accent_areas: vec![
                "titlebar".into(),
                " editor ".into(),
                "titlebar".into(),
                "unknown".into(),
            ],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.content_background, "white");
        assert_eq!(
            settings.accent_areas,
            vec!["titlebar".to_string(), "editor".to_string()]
        );

        let invalid = Settings {
            content_background: "blue".into(),
            ..Settings::default()
        }
        .sanitize();
        assert_eq!(invalid.content_background, "theme");
    }

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
            autosave_idle_secs: 0,
            autosave_enabled: true,
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
        assert_eq!(loaded.settings.autosave_enabled, true);
        assert_eq!(loaded.settings.autosave_idle_secs, 1);
        assert_eq!(loaded.settings.autosave_mode, None);
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
        assert_eq!(
            loaded.settings.last_repository.as_deref(),
            Some("C:\\Notes")
        );
        assert_eq!(loaded.settings.recent_repository_limit, 20);
    }

    #[test]
    fn legacy_autosave_mode_enables_the_toggle() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"autosaveMode":"interval","autosaveIdleSecs":120,"autosaveIntervalSecs":300}"#,
        )
        .unwrap();
        let loaded = load(&path);
        assert!(loaded.notice.is_none());
        assert!(loaded.settings.autosave_enabled);
        assert_eq!(loaded.settings.autosave_idle_secs, 120);
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

    #[test]
    fn color_rules_drop_unknown_kinds() {
        let settings = Settings {
            color_rules: vec![ColorRule {
                kind: " colour ".into(),
                target: "md".into(),
                icon: Some("#fff".into()),
                label: None,
            }],
            ..Settings::default()
        }
        .sanitize();

        assert!(settings.color_rules.is_empty());
    }

    #[test]
    fn color_extension_rules_normalize_targets() {
        let settings = Settings {
            color_rules: vec![ColorRule {
                kind: " Extension ".into(),
                target: ".MD".into(),
                icon: Some("#3B82F6".into()),
                label: Some("#ABCDEF".into()),
            }],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.color_rules.len(), 1);
        let rule = &settings.color_rules[0];
        assert_eq!(rule.kind, "extension");
        assert_eq!(rule.target, "md");
        assert_eq!(rule.icon.as_deref(), Some("#3b82f6"));
        assert_eq!(rule.label.as_deref(), Some("#abcdef"));
    }

    #[test]
    fn color_rules_drop_invalid_hex() {
        let settings = Settings {
            color_rules: vec![ColorRule {
                kind: "other".into(),
                target: String::new(),
                icon: Some("blue".into()),
                label: Some("#12345".into()),
            }],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.color_rules.len(), 0);
    }

    #[test]
    fn color_rules_dedupe_extensions() {
        let settings = Settings {
            color_rules: vec![
                ColorRule {
                    kind: "extension".into(),
                    target: "md".into(),
                    icon: Some("#111111".into()),
                    label: None,
                },
                ColorRule {
                    kind: "extension".into(),
                    target: ".MD".into(),
                    icon: Some("#222222".into()),
                    label: None,
                },
            ],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.color_rules.len(), 1);
        assert_eq!(settings.color_rules[0].target, "md");
    }

    #[test]
    fn color_rules_keep_repository_paths_and_repositories_header() {
        let settings = Settings {
            color_rules: vec![
                ColorRule {
                    kind: "repository".into(),
                    target: "C:\\Repos\\One".into(),
                    icon: Some("#30a46c".into()),
                    label: None,
                },
                ColorRule {
                    kind: "repository".into(),
                    target: "C:\\Repos\\One".into(),
                    icon: Some("#e5484d".into()),
                    label: None,
                },
                ColorRule {
                    kind: "repository".into(),
                    target: "   ".into(),
                    icon: Some("#e5484d".into()),
                    label: None,
                },
                ColorRule {
                    kind: "section".into(),
                    target: "Repositories".into(),
                    icon: Some("#3e63dd".into()),
                    label: None,
                },
            ],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.color_rules.len(), 2);
        assert_eq!(settings.color_rules[0].target, "C:\\Repos\\One");
        assert_eq!(settings.color_rules[0].icon.as_deref(), Some("#30a46c"));
        assert_eq!(settings.color_rules[1].kind, "section");
        assert_eq!(settings.color_rules[1].target, "repositories");
    }

    #[test]
    fn color_section_rules_keep_known_targets() {
        let settings = Settings {
            color_rules: vec![
                ColorRule {
                    kind: "section".into(),
                    target: "nope".into(),
                    icon: None,
                    label: None,
                },
                ColorRule {
                    kind: "section".into(),
                    target: "Pinned".into(),
                    icon: None,
                    label: Some("#FFF".into()),
                },
            ],
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.color_rules.len(), 1);
        assert_eq!(settings.color_rules[0].target, "pinned");
    }

    #[test]
    fn color_overrides_reject_unsafe_keys() {
        let mut color_overrides = HashMap::new();
        color_overrides.insert(
            "../outside".to_string(),
            ColorPair {
                icon: Some("#fff".into()),
                label: None,
            },
        );
        color_overrides.insert(
            "/absolute".to_string(),
            ColorPair {
                icon: Some("#fff".into()),
                label: None,
            },
        );
        color_overrides.insert(
            "C:\\absolute".to_string(),
            ColorPair {
                icon: Some("#fff".into()),
                label: None,
            },
        );
        color_overrides.insert(
            "notes/today.md".to_string(),
            ColorPair {
                icon: Some("#3B82F6".into()),
                label: None,
            },
        );
        let settings = Settings {
            color_overrides,
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(settings.color_overrides.len(), 1);
        let pair = settings.color_overrides.get("notes/today.md").unwrap();
        assert_eq!(pair.icon.as_deref(), Some("#3b82f6"));
    }
}
