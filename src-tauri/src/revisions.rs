use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Local, NaiveDateTime, TimeZone, Utc};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;

use crate::atomic::{atomic_create, atomic_write};
use crate::paths::{normalize_relative, Repository, REVISIONS_DIR};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Retention {
    pub hourly: u32,
    pub daily: u32,
    pub weekly: u32,
    pub monthly: u32,
    pub yearly: u32,
}

impl Retention {
    pub fn disabled(&self) -> bool {
        self.hourly == 0
            && self.daily == 0
            && self.weekly == 0
            && self.monthly == 0
            && self.yearly == 0
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionInfo {
    pub id: String,
    pub modified_ms: i64,
    pub size: i64,
}

pub fn revision_dir(repository: &Repository, relative: &str) -> Result<PathBuf, String> {
    let normalized = normalize_relative(relative).map_err(|error| error.to_string())?;
    Ok(repository.root().join(REVISIONS_DIR).join(normalized))
}

pub fn capture(
    repository: &Repository,
    relative: &str,
    bytes: &[u8],
    retention: &Retention,
) -> Result<(), String> {
    capture_at(repository, relative, bytes, retention, Utc::now())
}

fn capture_at(
    repository: &Repository,
    relative: &str,
    bytes: &[u8],
    retention: &Retention,
    now: DateTime<Utc>,
) -> Result<(), String> {
    if bytes.is_empty() || retention.disabled() {
        return Ok(());
    }
    let root = repository.root().join(REVISIONS_DIR);
    if root.exists() {
        let metadata = std::fs::symlink_metadata(&root)
            .map_err(|_| "The revision folder could not be used.".to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("The revision folder could not be used.".to_string());
        }
    } else {
        std::fs::create_dir_all(&root)
            .map_err(|_| "The revision folder could not be created.".to_string())?;
        hide_root(&root);
    }
    ensure_inside(repository, &root)?;
    let directory = revision_dir(repository, relative)?;
    std::fs::create_dir_all(&directory)
        .map_err(|_| "The revision folder could not be created.".to_string())?;
    ensure_inside(repository, &directory)?;
    let compressed = compress(bytes)?;
    let target = unique_path(&directory, now);
    atomic_create(&target, &compressed)
        .map_err(|_| "The revision could not be saved.".to_string())?;
    rotate(&directory, retention);
    Ok(())
}

pub fn list(repository: &Repository, relative: &str) -> Result<Vec<RevisionInfo>, String> {
    let directory = revision_dir(repository, relative)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let directory = ensure_inside(repository, &directory)?;
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    let mut revisions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_revision_file(&path) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let metadata = entry.metadata().ok();
        revisions.push(RevisionInfo {
            id,
            modified_ms: metadata
                .as_ref()
                .and_then(|meta| meta.modified().ok())
                .map(crate::repository::system_ms)
                .unwrap_or(0),
            size: metadata
                .as_ref()
                .map(|meta| meta.len() as i64)
                .unwrap_or(0),
        });
    }
    revisions.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(revisions)
}

pub fn restore(
    repository: &Repository,
    relative: &str,
    id: &str,
    retention: &Retention,
) -> Result<(), String> {
    if id.is_empty()
        || Path::new(id).file_name().and_then(|value| value.to_str()) != Some(id)
        || !id.ends_with(".gz")
    {
        return Err("That revision is not valid.".to_string());
    }
    let directory = ensure_inside(repository, &revision_dir(repository, relative)?)?;
    let compressed = std::fs::read(directory.join(id))
        .map_err(|_| "The revision could not be read.".to_string())?;
    let bytes = decompress(&compressed)?;
    let target = repository
        .resolve_for_write(relative)
        .map_err(|error| error.to_string())?;
    if let Ok(current) = std::fs::read(&target) {
        if let Err(error) = capture(repository, relative, &current, retention) {
            crate::log::line("warn", &format!("revision capture failed: {error}"));
        }
    }
    atomic_write(&target, &bytes)
        .map_err(|_| "The revision could not be restored.".to_string())?;
    Ok(())
}

pub fn move_path(repository: &Repository, old: &str, new: &str) -> Result<(), String> {
    let old_dir = revision_dir(repository, old)?;
    if !old_dir.exists() {
        return Ok(());
    }
    ensure_inside(repository, &old_dir)?;
    let new_dir = revision_dir(repository, new)?;
    if let Some(parent) = new_dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "The revision folder could not be moved.".to_string())?;
        ensure_inside(repository, parent)?;
    }
    if !new_dir.exists() {
        return std::fs::rename(&old_dir, &new_dir)
            .map_err(|_| "The revision folder could not be moved.".to_string());
    }
    ensure_inside(repository, &new_dir)?;
    if let Ok(entries) = std::fs::read_dir(&old_dir) {
        for entry in entries.flatten() {
            let target = new_dir.join(entry.file_name());
            if !target.exists() {
                let _ = std::fs::rename(entry.path(), target);
            }
        }
    }
    let _ = std::fs::remove_dir_all(&old_dir);
    Ok(())
}

pub fn remove_path(repository: &Repository, relative: &str) -> Result<(), String> {
    let directory = revision_dir(repository, relative)?;
    if directory.exists() {
        ensure_inside(repository, &directory)?;
        std::fs::remove_dir_all(&directory)
            .map_err(|_| "The revision folder could not be removed.".to_string())?;
    }
    Ok(())
}

fn ensure_inside(repository: &Repository, path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| "The revision folder could not be used.".to_string())?;
    if !crate::paths::is_inside(repository.root(), &canonical) {
        return Err("The revision folder could not be used.".to_string());
    }
    Ok(canonical)
}

fn compress(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|_| "The revision could not be compressed.".to_string())?;
    encoder
        .finish()
        .map_err(|_| "The revision could not be compressed.".to_string())
}

fn decompress(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes).take(crate::encoding::MAX_EDIT_BYTES + 1);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|_| "The revision could not be read.".to_string())?;
    if out.len() as u64 > crate::encoding::MAX_EDIT_BYTES {
        return Err("That revision is larger than 5 MB.".to_string());
    }
    Ok(out)
}

fn unique_path(directory: &Path, now: DateTime<Utc>) -> PathBuf {
    let stamp = now.format("%Y%m%d-%H%M%S-%3f").to_string();
    let mut candidate = directory.join(format!("{stamp}.gz"));
    let mut index = 1;
    while candidate.exists() {
        candidate = directory.join(format!("{stamp}-{index}.gz"));
        index += 1;
    }
    candidate
}

fn is_revision_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("gz"))
}

fn revision_time(id: &str) -> Option<DateTime<Utc>> {
    let stem = id.strip_suffix(".gz")?;
    let stamp = stem.get(..19)?;
    let naive = NaiveDateTime::parse_from_str(stamp, "%Y%m%d-%H%M%S-%3f").ok()?;
    Some(Utc.from_utc_datetime(&naive))
}

fn rotate(directory: &Path, retention: &Retention) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut snapshots: Vec<(String, PathBuf, DateTime<Local>)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !is_revision_file(&path) {
                return None;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            let time = revision_time(&id)?.with_timezone(&Local);
            Some((id, path, time))
        })
        .collect();
    snapshots.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.0.cmp(&a.0)));
    let times: Vec<(String, DateTime<Local>)> = snapshots
        .iter()
        .map(|(id, _, time)| (id.clone(), *time))
        .collect();
    let keep = select_keep(&times, retention);
    for (id, path, _) in snapshots {
        if !keep.contains(&id) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn select_keep(
    snapshots: &[(String, DateTime<Local>)],
    retention: &Retention,
) -> HashSet<String> {
    type BucketKey = fn(&DateTime<Local>) -> String;
    let tiers: [(u32, BucketKey); 5] = [
        (retention.hourly, hour_key),
        (retention.daily, day_key),
        (retention.weekly, week_key),
        (retention.monthly, month_key),
        (retention.yearly, year_key),
    ];
    let mut keep = HashSet::new();
    for (count, key) in tiers {
        if count == 0 {
            continue;
        }
        let mut seen = HashSet::new();
        for (id, time) in snapshots {
            if seen.len() >= count as usize {
                break;
            }
            if seen.insert(key(time)) {
                keep.insert(id.clone());
            }
        }
    }
    keep
}

fn hour_key(time: &DateTime<Local>) -> String {
    time.format("%Y-%m-%dT%H").to_string()
}

fn day_key(time: &DateTime<Local>) -> String {
    time.format("%Y-%m-%d").to_string()
}

fn week_key(time: &DateTime<Local>) -> String {
    let week = time.iso_week();
    format!("{}-W{:02}", week.year(), week.week())
}

fn month_key(time: &DateTime<Local>) -> String {
    time.format("%Y-%m").to_string()
}

fn year_key(time: &DateTime<Local>) -> String {
    time.format("%Y").to_string()
}

#[cfg(windows)]
fn hide_root(path: &Path) {
    let text = path.to_string_lossy();
    let text = text.as_ref();
    let text = text.strip_prefix(r"\\?\").unwrap_or(text);
    let _ = std::process::Command::new("attrib")
        .arg("+h")
        .arg(text)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn hide_root(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn retention(hourly: u32) -> Retention {
        Retention {
            hourly,
            daily: 0,
            weekly: 0,
            monthly: 0,
            yearly: 0,
        }
    }

    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .unwrap()
    }

    #[test]
    fn captures_lists_and_restores_revisions() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"one\n").unwrap();
        let retention = Retention {
            hourly: 24,
            daily: 7,
            weekly: 4,
            monthly: 12,
            yearly: 100,
        };
        capture_at(
            &repository,
            "note.txt",
            b"one\n",
            &retention,
            Utc.with_ymd_and_hms(2026, 3, 10, 10, 0, 0).unwrap(),
        )
        .unwrap();
        capture_at(
            &repository,
            "note.txt",
            b"two\n",
            &retention,
            Utc.with_ymd_and_hms(2026, 3, 10, 11, 0, 0).unwrap(),
        )
        .unwrap();
        let revisions = list(&repository, "note.txt").unwrap();
        assert_eq!(revisions.len(), 2);
        let oldest = revisions.last().unwrap().id.clone();
        restore(&repository, "note.txt", &oldest, &retention).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"one\n");
        assert!(dir.path().join(REVISIONS_DIR).exists());
    }

    #[test]
    fn gfs_keeps_newest_snapshot_per_bucket() {
        let snapshots = vec![
            ("20260105-100000-000.gz".to_string(), at(2026, 1, 5, 10, 0)),
            ("20260105-103000-000.gz".to_string(), at(2026, 1, 5, 10, 30)),
            ("20260105-110000-000.gz".to_string(), at(2026, 1, 5, 11, 0)),
            ("20260105-113000-000.gz".to_string(), at(2026, 1, 5, 11, 30)),
            ("20260106-090000-000.gz".to_string(), at(2026, 1, 6, 9, 0)),
        ];
        let mut ordered = snapshots.clone();
        ordered.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
        let keep = select_keep(&ordered, &retention(2));
        assert_eq!(keep.len(), 2);
        assert!(keep.contains("20260106-090000-000.gz"));
        assert!(keep.contains("20260105-113000-000.gz"));
    }

    #[test]
    fn tiers_are_unioned_without_duplicates() {
        let snapshots = vec![
            ("20260105-100000-000.gz".to_string(), at(2026, 1, 5, 10, 0)),
            ("20260107-100000-000.gz".to_string(), at(2026, 1, 7, 10, 0)),
        ];
        let mut ordered = snapshots.clone();
        ordered.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
        let keep = select_keep(
            &ordered,
            &Retention {
                hourly: 24,
                daily: 7,
                weekly: 4,
                monthly: 12,
                yearly: 100,
            },
        );
        assert_eq!(keep.len(), 2);
    }

    #[test]
    fn capture_prunes_by_local_hour_and_moves_paths() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        let retention = retention(1);
        capture_at(
            &repository,
            "note.txt",
            b"zero\n",
            &retention,
            Utc.with_ymd_and_hms(2026, 3, 10, 12, 0, 0).unwrap(),
        )
        .unwrap();
        capture_at(
            &repository,
            "note.txt",
            b"one\n",
            &retention,
            Utc.with_ymd_and_hms(2026, 3, 10, 12, 30, 0).unwrap(),
        )
        .unwrap();
        assert_eq!(list(&repository, "note.txt").unwrap().len(), 1);
        move_path(&repository, "note.txt", "archive/note.txt").unwrap();
        assert!(list(&repository, "note.txt").unwrap().is_empty());
        assert_eq!(list(&repository, "archive/note.txt").unwrap().len(), 1);
        remove_path(&repository, "archive/note.txt").unwrap();
        assert!(list(&repository, "archive/note.txt").unwrap().is_empty());
    }

    #[test]
    fn disabled_retention_captures_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let repository = Repository::open(dir.path()).unwrap();
        assert!(Retention {
            hourly: 0,
            daily: 0,
            weekly: 0,
            monthly: 0,
            yearly: 0,
        }
        .disabled());
        capture(&repository, "note.txt", b"text\n", &retention(0)).unwrap();
        assert!(list(&repository, "note.txt").unwrap().is_empty());
    }
}
