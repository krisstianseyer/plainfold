use crate::errors::{AppError, AppResult};
use crate::paths::REVISIONS_DIR;

/// Characters that are never allowed in a created file or folder name.
const FORBIDDEN: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validates a user-entered name and returns its path segments.
///
/// A forward slash is a path separator: creating `notes/2026/today.txt`
/// creates the intermediate folders in one step. Every other invalid
/// character is rejected in every segment.
pub fn validate_name(name: &str, windows: bool) -> AppResult<Vec<String>> {
    if name.is_empty() {
        return Err(AppError::new("Enter a name."));
    }
    if name.starts_with('/') {
        return Err(AppError::new("Names cannot start with a slash."));
    }
    if name.contains('\\') {
        return Err(AppError::new("Names cannot contain a backslash."));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(AppError::new("Names cannot contain control characters."));
    }
    if let Some(bad) = name.chars().find(|c| {
        FORBIDDEN.contains(c) && *c != '/' // slash is handled as a separator
    }) {
        return Err(AppError::new(format!(
            "Names cannot contain the character {bad}."
        )));
    }

    let mut segments = Vec::new();
    for segment in name.split('/') {
        if segment.is_empty() {
            return Err(AppError::new(
                "Names cannot contain an empty path segment.",
            ));
        }
        if segment == "." || segment == ".." {
            return Err(AppError::new("Names cannot contain . or .. segments."));
        }
        validate_segment(segment, windows)?;
        segments.push(segment.to_string());
    }
    Ok(segments)
}

fn validate_segment(segment: &str, windows: bool) -> AppResult<()> {
    if segment.is_empty() {
        return Err(AppError::new("Enter a name."));
    }
    if let Some(bad) = segment.chars().find(|c| FORBIDDEN.contains(c)) {
        return Err(AppError::new(format!(
            "Names cannot contain the character {bad}."
        )));
    }
    if segment.chars().any(|c| c.is_control()) {
        return Err(AppError::new("Names cannot contain control characters."));
    }
    if segment.eq_ignore_ascii_case(REVISIONS_DIR) {
        return Err(AppError::new(
            "That name is reserved for revision history.",
        ));
    }

    if windows {
        if segment.ends_with('.') || segment.ends_with(' ') {
            return Err(AppError::new(
                "Names cannot end with a dot or a space on Windows.",
            ));
        }
        let upper = segment.to_ascii_uppercase();
        let stem = upper.split('.').next().unwrap_or("");
        if WINDOWS_RESERVED.contains(&upper.as_str()) || WINDOWS_RESERVED.contains(&stem) {
            return Err(AppError::new(format!(
                "The name {segment} is reserved on Windows."
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_nested_names() {
        assert_eq!(
            validate_name("notes/2026/today.txt", true).unwrap(),
            vec!["notes", "2026", "today.txt"]
        );
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        assert!(validate_name("../secret", true).is_err());
        assert!(validate_name("a/../../b", true).is_err());
        assert!(validate_name("/etc/passwd", true).is_err());
        assert!(validate_name("a//b", true).is_err());
        assert!(validate_name("C:name", true).is_err());
    }

    #[test]
    fn rejects_invalid_characters() {
        for bad in ["a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "a\\b", "a\tb"] {
            assert!(validate_name(bad, true).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn applies_windows_rules_only_on_windows() {
        assert!(validate_name("CON", true).is_err());
        assert!(validate_name("con.txt", true).is_err());
        assert!(validate_name("LPT9", true).is_err());
        assert!(validate_name("trailing.", true).is_err());
        assert!(validate_name("trailing ", true).is_err());
        assert!(validate_name("CON", false).is_ok());
        assert!(validate_name("trailing.", false).is_ok());
    }

    #[test]
    fn rejects_revisions_folder_name() {
        assert!(validate_name(".revisions", true).is_err());
        assert!(validate_name("notes/.revisions", true).is_err());
    }

    #[test]
    fn rejects_empty_segments() {
        assert!(validate_name("", true).is_err());
        assert!(validate_name("a/", true).is_err());
        assert!(validate_name(".", true).is_err());
        assert!(validate_name("..", true).is_err());
    }

    #[test]
    fn windows_reserved_name_variants() {
        for bad in [
            "COM1.txt",
            "lpt9.tar.gz",
            "NUL.",
            "aux ",
            "a/COM2/b.txt",
        ] {
            assert!(validate_name(bad, true).is_err(), "{bad} should be rejected");
        }
        assert!(validate_name("COM0", true).is_ok());
        assert!(validate_name(".hidden", true).is_ok());
    }
}
