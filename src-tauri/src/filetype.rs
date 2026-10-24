use std::path::Path;

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "org", "tex", "latex", "csv", "tsv",
    "json", "jsonc", "json5", "xml", "html", "htm", "xhtml", "css", "scss", "sass", "less", "js",
    "mjs", "cjs", "jsx", "ts", "tsx", "bat", "cmd", "ps1", "sh", "bash", "zsh", "fish", "py", "rb",
    "php", "pl", "lua", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "java", "kt", "kts",
    "swift", "sql", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "log", "svg",
];

const EXTERNAL_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "ico", "heic", "heif", "avif",
    "raw", "cr2", "nef", "dng", "svgz", "mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus",
    "mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "m4v", "doc", "docx", "xls", "xlsx", "ppt",
    "pptx", "odt", "ods", "odp", "rtf", "psd", "ai", "indd", "sketch", "fig", "xcf", "zip", "rar",
    "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "dmg", "exe", "msi", "dll", "so", "dylib", "app",
    "deb", "rpm", "apk", "jar", "ttf", "otf", "woff", "woff2", "sqlite", "db", "epub", "mobi",
    "djvu", "torrent",
];

pub fn extension_kind(path: &Path) -> Option<bool> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if TEXT_EXTENSIONS.contains(&extension.as_str()) {
        Some(false)
    } else if EXTERNAL_EXTENSIONS.contains(&extension.as_str()) {
        Some(true)
    } else {
        None
    }
}

pub fn looks_like_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF])
        || bytes.starts_with(&[0xFF, 0xFE])
        || bytes.starts_with(&[0xFE, 0xFF])
    {
        return true;
    }
    if bytes.contains(&0) {
        return false;
    }
    match std::str::from_utf8(bytes) {
        Ok(_) => true,
        Err(error) => error.error_len().is_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_known_extensions() {
        assert_eq!(extension_kind(Path::new("note.md")), Some(false));
        assert_eq!(extension_kind(Path::new("photo.PNG")), Some(true));
        assert_eq!(extension_kind(Path::new("archive.bin")), None);
    }

    #[test]
    fn detects_binary_content() {
        assert!(looks_like_text(b"plain text\n"));
        assert!(looks_like_text(b""));
        assert!(!looks_like_text(b"\x89PNG\r\n\x1a\n"));
        assert!(!looks_like_text(b"abc\0def"));
        assert!(looks_like_text(&[0xFF, 0xFE, b'a', 0]));
    }
}
