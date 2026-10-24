use std::path::{Path, PathBuf};

use serde::Serialize;

#[cfg(target_os = "linux")]
const DESKTOP_FILE: &str = "Plainfold.desktop";
const DESKTOP_ENTRY: &str = "[Desktop Entry]\nType=Application\nName=Plainfold\nComment=Plain-text notes in an ordinary folder\nExec=plainfold\nIcon=plainfold\nTerminal=false\nCategories=Utility;\nStartupWMClass=plainfold\n";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopShortcutStatus {
    pub supported: bool,
    pub exists: bool,
    pub prompted: bool,
}

pub fn status(prompted: bool) -> DesktopShortcutStatus {
    match shortcut_path() {
        Some(path) => DesktopShortcutStatus {
            supported: true,
            exists: path.is_file(),
            prompted,
        },
        None => DesktopShortcutStatus {
            supported: false,
            exists: false,
            prompted,
        },
    }
}

pub fn create() -> Result<bool, String> {
    let path =
        shortcut_path().ok_or_else(|| "The Desktop folder could not be found.".to_string())?;
    write_shortcut(&path)
}

fn write_shortcut(path: &Path) -> Result<bool, String> {
    if path.is_file() {
        return Ok(false);
    }
    match crate::atomic::atomic_create(path, DESKTOP_ENTRY.as_bytes()) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(_) => return Err("The Desktop shortcut could not be created.".to_string()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).is_err() {
            let _ = std::fs::remove_file(path);
            return Err("The Desktop shortcut could not be made executable.".to_string());
        }
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        let _ = Command::new("gio")
            .arg("set")
            .arg(path)
            .args(["metadata::trusted", "true"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    Ok(true)
}

fn shortcut_path() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        desktop_dir().map(|directory| directory.join(DESKTOP_FILE))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

#[cfg(target_os = "linux")]
fn desktop_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    if let Some(value) = std::env::var_os("XDG_DESKTOP_DIR") {
        if let Some(path) = expand_desktop_dir(&value.to_string_lossy(), &home) {
            if path.is_dir() {
                return Some(path);
            }
        }
    }
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    if let Ok(text) = std::fs::read_to_string(config_home.join("user-dirs.dirs")) {
        if let Some(value) = parse_user_dirs(&text) {
            if let Some(path) = expand_desktop_dir(&value, &home) {
                if path.is_dir() {
                    return Some(path);
                }
            }
        }
    }
    let fallback = home.join("Desktop");
    fallback.is_dir().then_some(fallback)
}

#[cfg(target_os = "linux")]
fn parse_user_dirs(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some(value) = line.strip_prefix("XDG_DESKTOP_DIR=") else {
            continue;
        };
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(value);
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn expand_desktop_dir(value: &str, home: &Path) -> Option<PathBuf> {
    let value = value.trim();
    let path = match value {
        "$HOME" | "${HOME}" => home.to_path_buf(),
        _ if value.starts_with("$HOME/") => home.join(&value[6..]),
        _ if value.starts_with("${HOME}/") => home.join(&value[8..]),
        _ => PathBuf::from(value),
    };
    path.is_absolute().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_desktop_entry_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Plainfold.desktop");
        assert!(write_shortcut(&path).unwrap());
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains("Name=Plainfold"));
        assert!(contents.contains("Exec=plainfold"));
        assert!(!write_shortcut(&path).unwrap());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_xdg_desktop_dir() {
        let text =
            "# comment\nXDG_DOWNLOAD_DIR=\"$HOME/Downloads\"\nXDG_DESKTOP_DIR=\"$HOME/Desktop\"\n";
        assert_eq!(parse_user_dirs(text).as_deref(), Some("$HOME/Desktop"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn expands_home_in_desktop_dir() {
        let home = Path::new("/home/example");
        assert_eq!(
            expand_desktop_dir("$HOME/Desktop", home),
            Some(PathBuf::from("/home/example/Desktop"))
        );
        assert_eq!(
            expand_desktop_dir("${HOME}/Bureau", home),
            Some(PathBuf::from("/home/example/Bureau"))
        );
        assert_eq!(
            expand_desktop_dir("/mnt/desktop", home),
            Some(PathBuf::from("/mnt/desktop"))
        );
        assert_eq!(expand_desktop_dir("Desktop", home), None);
    }
}
