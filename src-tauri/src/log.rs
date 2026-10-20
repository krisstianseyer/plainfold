use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static SINK: OnceLock<Mutex<File>> = OnceLock::new();
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

/// Open the log file in the app data folder. Logging is best effort: a
/// failure here never prevents the app from starting.
pub fn init(data_dir: &Path) {
    let directory = data_dir.join("logs");
    if std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join("plainfold.log");
    if std::fs::metadata(&path)
        .map(|meta| meta.len() > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let previous = directory.join("plainfold.log.1");
        let _ = std::fs::remove_file(&previous);
        let _ = std::fs::rename(&path, previous);
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = SINK.set(Mutex::new(file));
    }
}

/// Log a line. Callers must never pass file contents, only paths, error
/// codes, timings, and plain-language status.
pub fn line(level: &str, message: &str) {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let entry = format!("{seconds} {level} {message}\n");
    if let Some(sink) = SINK.get() {
        if let Ok(mut file) = sink.lock() {
            let _ = file.write_all(entry.as_bytes());
            let _ = file.flush();
            return;
        }
    }
    eprintln!("plainfold: {message}");
}

pub fn path_event(level: &str, event: &str, path: &Path) {
    line(level, &format!("{event}: {}", path.display()));
}
