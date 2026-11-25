use serde::Serialize;

use crate::errors::{AppError, AppResult};

pub const MAX_EDIT_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;
/// A display cap for oversized files so a multi-gigabyte file can never take
/// down the WebView or exhaust memory. The file is still read-only.
pub const MAX_DISPLAY_BYTES: u64 = 8 * 1024 * 1024;

/// Content is indexed only when the file is strictly smaller than 2 MiB.
pub fn should_index_size(size: u64) -> bool {
    size < MAX_INDEX_BYTES
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoding {
    Utf8 { bom: bool },
    Utf16Le,
    Utf16Be,
}

impl TextEncoding {
    pub fn id(self) -> &'static str {
        match self {
            Self::Utf8 { bom: false } => "utf-8",
            Self::Utf8 { bom: true } => "utf-8-bom",
            Self::Utf16Le => "utf-16le",
            Self::Utf16Be => "utf-16be",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "utf-8" => Ok(Self::Utf8 { bom: false }),
            "utf-8-bom" => Ok(Self::Utf8 { bom: true }),
            "utf-16le" => Ok(Self::Utf16Le),
            "utf-16be" => Ok(Self::Utf16Be),
            _ => Err(AppError::new("That text encoding is not supported.")),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Utf8 { bom: false } => "UTF-8",
            Self::Utf8 { bom: true } => "UTF-8 with BOM",
            Self::Utf16Le => "UTF-16 LE",
            Self::Utf16Be => "UTF-16 BE",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

impl Eol {
    pub fn id(self) -> &'static str {
        match self {
            Self::Lf => "lf",
            Self::Crlf => "crlf",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "lf" => Ok(Self::Lf),
            "crlf" => Ok(Self::Crlf),
            _ => Err(AppError::new("That line ending style is not supported.")),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Lf => "LF",
            Self::Crlf => "CRLF",
        }
    }

    pub fn default_for_platform() -> Self {
        if cfg!(windows) {
            Self::Crlf
        } else {
            Self::Lf
        }
    }
}

#[derive(Debug)]
pub struct Decoded {
    pub text: String,
    pub encoding: TextEncoding,
    pub eol: Eol,
    pub read_only: Option<String>,
}

pub fn decode(bytes: &[u8]) -> Decoded {
    // UTF-32 BOMs are not supported and must not be mistaken for UTF-16.
    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) || bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF])
    {
        return Decoded {
            text: String::from_utf8_lossy(bytes).into_owned(),
            encoding: TextEncoding::Utf8 { bom: false },
            eol: detect_eol(bytes),
            read_only: Some(
                "This looks like a UTF-32 file, which Plainfold does not edit, so it is read-only."
                    .into(),
            ),
        };
    }
    let (encoding, source) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (TextEncoding::Utf8 { bom: true }, &bytes[3..])
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (TextEncoding::Utf16Le, &bytes[2..])
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (TextEncoding::Utf16Be, &bytes[2..])
    } else {
        (TextEncoding::Utf8 { bom: false }, bytes)
    };

    let text = match encoding {
        TextEncoding::Utf8 { .. } => match std::str::from_utf8(source) {
            Ok(value) => value.to_string(),
            Err(_) => return Decoded {
                text: String::from_utf8_lossy(source).into_owned(),
                encoding,
                eol: detect_eol(bytes),
                read_only: Some(
                    "This file is not valid UTF-8 or a BOM-marked UTF-16 file, so it is read-only."
                        .into(),
                ),
            },
        },
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            if source.len() % 2 != 0 {
                return Decoded {
                    text: String::from_utf16_lossy(
                        &source
                            .chunks_exact(2)
                            .map(|pair| match encoding {
                                TextEncoding::Utf16Le => u16::from_le_bytes([pair[0], pair[1]]),
                                _ => u16::from_be_bytes([pair[0], pair[1]]),
                            })
                            .collect::<Vec<_>>(),
                    ),
                    encoding,
                    eol: detect_eol(bytes),
                    read_only: Some(
                        "This UTF-16 file has an incomplete final character, so it is read-only."
                            .into(),
                    ),
                };
            }
            let units: Vec<u16> = source
                .chunks_exact(2)
                .map(|pair| match encoding {
                    TextEncoding::Utf16Le => u16::from_le_bytes([pair[0], pair[1]]),
                    _ => u16::from_be_bytes([pair[0], pair[1]]),
                })
                .collect();
            match String::from_utf16(&units) {
                Ok(value) => value,
                Err(_) => {
                    return Decoded {
                        text: String::from_utf16_lossy(&units),
                        encoding,
                        eol: detect_eol(bytes),
                        read_only: Some(
                            "This UTF-16 file contains invalid text, so it is read-only.".into(),
                        ),
                    }
                }
            }
        }
    };

    let eol = detect_eol(text.as_bytes());
    if has_lone_cr(&text) {
        return Decoded {
            text: normalize_newlines(&text),
            encoding,
            eol,
            read_only: Some(
                "This file uses bare carriage-return line endings that Plainfold does not edit, so it is read-only."
                    .into(),
            ),
        };
    }
    Decoded {
        text: normalize_newlines(&text),
        encoding,
        eol,
        read_only: None,
    }
}

fn has_lone_cr(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| *byte == b'\r' && bytes.get(index + 1) != Some(&b'\n'))
}

pub fn detect_eol(bytes: &[u8]) -> Eol {
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            return if index > 0 && bytes[index - 1] == b'\r' {
                Eol::Crlf
            } else {
                Eol::Lf
            };
        }
        // A lone CR is treated as a line break too.
        if *byte == b'\r' && bytes.get(index + 1) != Some(&b'\n') {
            return Eol::Crlf;
        }
    }
    Eol::Lf
}

pub fn normalize_newlines(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn encode(text: &str, encoding: TextEncoding, eol: Eol) -> Vec<u8> {
    let normalized = normalize_newlines(text);
    let with_eol = match eol {
        Eol::Lf => normalized,
        Eol::Crlf => normalized.replace('\n', "\r\n"),
    };
    match encoding {
        TextEncoding::Utf8 { bom } => {
            let mut out = Vec::with_capacity(with_eol.len() + 3);
            if bom {
                out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            out.extend_from_slice(with_eol.as_bytes());
            out
        }
        TextEncoding::Utf16Le => {
            let mut out = Vec::with_capacity(with_eol.len() * 2 + 2);
            out.extend_from_slice(&[0xFF, 0xFE]);
            for unit in with_eol.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out
        }
        TextEncoding::Utf16Be => {
            let mut out = Vec::with_capacity(with_eol.len() * 2 + 2);
            out.extend_from_slice(&[0xFE, 0xFF]);
            for unit in with_eol.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_utf8_bom_crlf() {
        let bytes = encode("one\ntwo\n", TextEncoding::Utf8 { bom: true }, Eol::Crlf);
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(&bytes[3..], b"one\r\ntwo\r\n");
        let decoded = decode(&bytes);
        assert_eq!(decoded.text, "one\ntwo\n");
        assert_eq!(decoded.encoding, TextEncoding::Utf8 { bom: true });
        assert_eq!(decoded.eol, Eol::Crlf);
        assert!(decoded.read_only.is_none());
    }

    #[test]
    fn round_trips_utf16() {
        for encoding in [TextEncoding::Utf16Le, TextEncoding::Utf16Be] {
            let bytes = encode("alpha\nbeta\n", encoding, Eol::Lf);
            let decoded = decode(&bytes);
            assert_eq!(decoded.text, "alpha\nbeta\n");
            assert_eq!(decoded.encoding, encoding);
            assert_eq!(decoded.eol, Eol::Lf);
        }
    }

    #[test]
    fn invalid_utf8_is_read_only() {
        let decoded = decode(&[0x66, 0x6F, 0xFF, 0x00]);
        assert!(decoded.read_only.is_some());
    }

    #[test]
    fn detects_first_line_ending() {
        assert_eq!(detect_eol(b"a\r\nb\n"), Eol::Crlf);
        assert_eq!(detect_eol(b"a\nb\r\n"), Eol::Lf);
        assert_eq!(detect_eol(b"single"), Eol::Lf);
    }

    #[test]
    fn normalizes_lone_carriage_returns() {
        assert_eq!(normalize_newlines("a\rb\r\nc"), "a\nb\nc");
    }

    #[test]
    fn lone_carriage_returns_are_read_only() {
        let decoded = decode(b"one\rtwo\r\n");
        assert!(decoded.read_only.is_some());
    }

    #[test]
    fn utf32_bom_is_read_only() {
        let decoded = decode(&[0xFF, 0xFE, 0x00, 0x00, b'a', 0, 0, 0]);
        assert!(decoded.read_only.is_some());
    }

    #[test]
    fn odd_length_utf16_is_read_only() {
        let decoded = decode(&[0xFF, 0xFE, b'a', 0, b'b']);
        assert!(decoded.read_only.is_some());
    }

    #[test]
    fn bom_only_file_is_editable_and_keeps_the_bom() {
        let decoded = decode(&[0xEF, 0xBB, 0xBF]);
        assert!(decoded.read_only.is_none());
        assert_eq!(decoded.text, "");
        let bytes = encode(&decoded.text, decoded.encoding, Eol::Lf);
        assert_eq!(bytes, vec![0xEF, 0xBB, 0xBF]);
    }

    #[test]
    fn mixed_line_endings_follow_the_first_style() {
        let decoded = decode(b"one\r\ntwo\nthree\r\n");
        assert_eq!(decoded.eol, Eol::Crlf);
        assert_eq!(decoded.text, "one\ntwo\nthree\n");
        assert_eq!(
            encode(&decoded.text, decoded.encoding, decoded.eol),
            b"one\r\ntwo\r\nthree\r\n"
        );
    }

    #[test]
    fn index_size_limit_is_two_mib_and_strict() {
        assert_eq!(MAX_INDEX_BYTES, 2 * 1024 * 1024);
        assert!(should_index_size(MAX_INDEX_BYTES - 1));
        assert!(!should_index_size(MAX_INDEX_BYTES));
    }
}
