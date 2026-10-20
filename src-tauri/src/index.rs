use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::encoding;

pub const SCHEMA_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub line: Option<u32>,
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

pub struct Index {
    connection: Connection,
    root: PathBuf,
}

impl Index {
    pub fn open(database: &Path, root: &Path) -> Result<Self, String> {
        match Self::open_once(database, root) {
            Ok(index) => Ok(index),
            Err(_) => {
                // The index is a cache. If it is corrupt or unreadable, remove
                // it and rebuild rather than making search permanently fail.
                remove_database_files(database);
                Self::open_once(database, root)
            }
        }
    }

    fn open_once(database: &Path, root: &Path) -> Result<Self, String> {
        if let Some(parent) = database.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| "The search index folder could not be created.".to_string())?;
        }
        let connection = Connection::open(database)
            .map_err(|_| "The search index could not be opened.".to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "The search index could not be prepared.".to_string())?;
        let _ = connection.pragma_update(None, "journal_mode", "WAL");
        let _ = connection.pragma_update(None, "synchronous", "NORMAL");
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS files (
                    path TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    name_folded TEXT NOT NULL DEFAULT '',
                    size INTEGER NOT NULL,
                    mtime_ms INTEGER NOT NULL
                 );
                 CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                    path UNINDEXED,
                    name,
                    body,
                    tokenize = 'unicode61 remove_diacritics 2'
                 );
                 CREATE TABLE IF NOT EXISTS tags (
                    path TEXT NOT NULL,
                    tag TEXT NOT NULL,
                    PRIMARY KEY (path, tag)
                 );
                 CREATE TABLE IF NOT EXISTS pins (
                    path TEXT PRIMARY KEY,
                    pinned_at_ms INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS recents (
                    path TEXT PRIMARY KEY,
                    opened_at_ms INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS sort_order (
                    parent TEXT NOT NULL,
                    name TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (parent, name)
                 );
                 -- Reserved for double-bracket links; created now so adding
                 -- links later needs no migration of user data.
                 CREATE TABLE IF NOT EXISTS links (
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    PRIMARY KEY (source, target)
                 );
                 INSERT INTO meta(key, value) VALUES ('schema_version', '1')
                    ON CONFLICT(key) DO NOTHING;",
            )
            .map_err(|_| "The search index could not be created.".to_string())?;
        let has_folded = {
            let mut statement = connection
                .prepare("PRAGMA table_info(files)")
                .map_err(|_| "The search index could not be prepared.".to_string())?;
            let names = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|_| "The search index could not be prepared.".to_string())?;
            let found = names.flatten().any(|name| name == "name_folded");
            found
        };
        if !has_folded {
            connection
                .execute(
                    "ALTER TABLE files ADD COLUMN name_folded TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .map_err(|_| "The search index could not be upgraded.".to_string())?;
        }
        Ok(Self {
            connection,
            root: std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()),
        })
    }

    pub fn schema_version(&self) -> Option<String> {
        self.connection
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn clear_files(&self) -> Result<(), String> {
        self.connection
            .execute_batch("DELETE FROM files; DELETE FROM files_fts;")
            .map_err(|_| "The search index could not be cleared.".to_string())
    }

    pub fn upsert_file(
        &mut self,
        path: &str,
        name: &str,
        size: i64,
        mtime_ms: i64,
        body: Option<&str>,
    ) -> Result<(), String> {
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute(
            "INSERT INTO files(path, name, name_folded, size, mtime_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name,
             name_folded = excluded.name_folded, size = excluded.size,
             mtime_ms = excluded.mtime_ms",
            params![path, name, name.to_lowercase(), size, mtime_ms],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute("DELETE FROM files_fts WHERE path = ?1", params![path])
            .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute(
            "INSERT INTO files_fts(path, name, body) VALUES (?1, ?2, ?3)",
            params![path, name, body.unwrap_or("")],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.commit()
            .map_err(|_| "The search index could not be updated.".to_string())
    }

    pub fn remove_path(&mut self, path: &str) -> Result<(), String> {
        let prefix = format!("{path}/");
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "The search index could not be updated.".to_string())?;
        let like = format!("{}%", escape_like(&prefix));
        tx.execute(
            "DELETE FROM files WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute(
            "DELETE FROM files_fts WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute(
            "DELETE FROM tags WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute(
            "DELETE FROM pins WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.execute(
            "DELETE FROM recents WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        // Custom order rows belonging to the deleted folder and the row for
        // the deleted item in its parent.
        let (parent, leaf) = match path.rsplit_once('/') {
            Some((parent, leaf)) => (parent.to_string(), leaf.to_string()),
            None => (String::new(), path.to_string()),
        };
        tx.execute(
            "DELETE FROM sort_order WHERE parent = ?1 OR parent LIKE ?2 ESCAPE '\\'
             OR parent = ?3 AND name = ?4",
            params![path, like, parent, leaf],
        )
        .map_err(|_| "The search index could not be updated.".to_string())?;
        tx.commit()
            .map_err(|_| "The search index could not be updated.".to_string())
    }

    pub fn indexed_files(&self) -> Vec<(String, i64, i64)> {
        let mut statement = match self
            .connection
            .prepare("SELECT path, size, mtime_ms FROM files")
        {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?))
        });
        match rows {
            Ok(iter) => iter.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, 500);
        let like = format!("%{}%", escape_like(&query.to_lowercase()));

        let mut hits: Vec<SearchHit> = Vec::new();
        let mut seen: HashMap<String, usize> = HashMap::new();

        {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT path, name FROM files
                     WHERE name_folded LIKE ?1 ESCAPE '\\'
                     ORDER BY name COLLATE NOCASE LIMIT ?2",
                )
                .map_err(|_| "The search index could not be queried.".to_string())?;
            let rows = statement
                .query_map(params![like, limit as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|_| "The search index could not be queried.".to_string())?;
            for row in rows.flatten() {
                let (path, name) = row;
                if seen.insert(path.clone(), hits.len()).is_none() {
                    hits.push(SearchHit {
                        path,
                        name,
                        line: None,
                        line_text: String::new(),
                    });
                }
            }
        }

        if let Some(fts_query) = build_fts_query(query) {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT files.path, files.name FROM files_fts
                     JOIN files ON files.path = files_fts.path
                     WHERE files_fts MATCH ?1
                     ORDER BY rank LIMIT ?2",
                )
                .map_err(|_| "The search index could not be queried.".to_string())?;
            let rows = statement
                .query_map(params![fts_query, limit as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|_| "The search index could not be queried.".to_string())?;
            for row in rows.flatten() {
                let (path, name) = row;
                if seen.contains_key(&path) {
                    continue;
                }
                let (line, line_text) = self.locate_line(&path, query);
                seen.insert(path.clone(), hits.len());
                hits.push(SearchHit {
                    path,
                    name,
                    line,
                    line_text,
                });
            }
        }

        for hit in &mut hits {
            if hit.line.is_none() {
                let (line, line_text) = self.locate_line(&hit.path, query);
                hit.line = line;
                hit.line_text = line_text;
            }
        }
        hits.truncate(limit);
        Ok(hits)
    }

    fn locate_line(&self, relative: &str, query: &str) -> (Option<u32>, String) {
        let Ok(normalized) = crate::paths::normalize_relative(relative) else {
            return (None, String::new());
        };
        let joined = self.root.join(normalized);
        let Ok(absolute) = std::fs::canonicalize(joined) else {
            return (None, String::new());
        };
        if !crate::paths::is_inside(&self.root, &absolute) {
            return (None, String::new());
        }
        let bytes = match std::fs::read(absolute) {
            Ok(bytes) if bytes.len() as u64 <= encoding::MAX_DISPLAY_BYTES => bytes,
            Ok(bytes) => bytes[..encoding::MAX_DISPLAY_BYTES as usize].to_vec(),
            Err(_) => return (None, String::new()),
        };
        let decoded = encoding::decode(&bytes);
        let needle = query.trim().to_lowercase();
        let tokens: Vec<String> = needle
            .split_whitespace()
            .map(|token| token.to_lowercase())
            .collect();
        for (index, line) in decoded.text.split('\n').enumerate() {
            let lower = line.to_lowercase();
            let matches = if needle.is_empty() {
                false
            } else {
                lower.contains(&needle)
                    || (!tokens.is_empty() && tokens.iter().all(|token| lower.contains(token)))
            };
            if matches {
                let mut text = line.trim_end().to_string();
                if text.chars().count() > 400 {
                    text = text.chars().take(400).collect::<String>() + "...";
                }
                return (Some((index + 1) as u32), text);
            }
        }
        (None, String::new())
    }

    pub fn set_tags(&mut self, path: &str, tags: &[String]) -> Result<(), String> {
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "Tags could not be saved.".to_string())?;
        tx.execute("DELETE FROM tags WHERE path = ?1", params![path])
            .map_err(|_| "Tags could not be saved.".to_string())?;
        let mut seen = std::collections::HashSet::new();
        for tag in tags {
            let tag = tag.trim().trim_start_matches('#').trim();
            if tag.is_empty() {
                continue;
            }
            let key = tag.to_lowercase();
            if !seen.insert(key) {
                continue;
            }
            tx.execute(
                "INSERT OR IGNORE INTO tags(path, tag) VALUES (?1, ?2)",
                params![path, tag],
            )
            .map_err(|_| "Tags could not be saved.".to_string())?;
        }
        tx.commit()
            .map_err(|_| "Tags could not be saved.".to_string())
    }

    pub fn tags_for(&self, path: &str) -> Vec<String> {
        let mut statement = match self
            .connection
            .prepare("SELECT tag FROM tags WHERE path = ?1 ORDER BY tag COLLATE NOCASE")
        {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        let rows = statement.query_map(params![path], |row| row.get::<_, String>(0));
        match rows {
            Ok(iter) => iter.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn tags_map(&self) -> HashMap<String, Vec<String>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        let mut statement = match self
            .connection
            .prepare("SELECT path, tag FROM tags ORDER BY tag COLLATE NOCASE")
        {
            Ok(statement) => statement,
            Err(_) => return map,
        };
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        if let Ok(iter) = rows {
            for (path, tag) in iter.flatten() {
                map.entry(path).or_default().push(tag);
            }
        }
        map
    }

    pub fn tag_counts(&self) -> Vec<TagCount> {
        let mut statement = match self.connection.prepare(
            "SELECT tag, COUNT(*) FROM tags GROUP BY tag COLLATE NOCASE
             ORDER BY tag COLLATE NOCASE",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        let rows = statement.query_map([], |row| {
            Ok(TagCount {
                tag: row.get(0)?,
                count: row.get(1)?,
            })
        });
        match rows {
            Ok(iter) => iter.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn set_pin(&mut self, path: &str, pinned: bool) -> Result<(), String> {
        if pinned {
            self.connection
                .execute(
                    "INSERT INTO pins(path, pinned_at_ms) VALUES (?1, ?2)
                     ON CONFLICT(path) DO UPDATE SET pinned_at_ms = excluded.pinned_at_ms",
                    params![path, now_ms()],
                )
                .map_err(|_| "The pin could not be saved.".to_string())?;
        } else {
            self.connection
                .execute("DELETE FROM pins WHERE path = ?1", params![path])
                .map_err(|_| "The pin could not be removed.".to_string())?;
        }
        Ok(())
    }

    pub fn pins(&self) -> Vec<String> {
        let mut statement = match self
            .connection
            .prepare("SELECT path FROM pins ORDER BY pinned_at_ms DESC, path")
        {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        let rows = statement.query_map([], |row| row.get::<_, String>(0));
        match rows {
            Ok(iter) => iter.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn record_recent(&mut self, path: &str) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO recents(path, opened_at_ms) VALUES (?1, ?2)
                 ON CONFLICT(path) DO UPDATE SET opened_at_ms = excluded.opened_at_ms",
                params![path, now_ms()],
            )
            .map_err(|_| "Recent files could not be saved.".to_string())?;
        self.connection
            .execute(
                "DELETE FROM recents WHERE path NOT IN
                 (SELECT path FROM recents ORDER BY opened_at_ms DESC LIMIT 100)",
                [],
            )
            .map_err(|_| "Recent files could not be saved.".to_string())?;
        Ok(())
    }

    pub fn recents(&self, limit: usize) -> Vec<String> {
        let mut statement = match self.connection.prepare(
            "SELECT path FROM recents ORDER BY opened_at_ms DESC LIMIT ?1",
        ) {
            Ok(statement) => statement,
            Err(_) => return Vec::new(),
        };
        let rows = statement.query_map(params![limit as i64], |row| row.get::<_, String>(0));
        match rows {
            Ok(iter) => iter.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn set_sort_order(&mut self, parent: &str, names: &[String]) -> Result<(), String> {
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "The custom order could not be saved.".to_string())?;
        tx.execute("DELETE FROM sort_order WHERE parent = ?1", params![parent])
            .map_err(|_| "The custom order could not be saved.".to_string())?;
        for (position, name) in names.iter().enumerate() {
            tx.execute(
                "INSERT INTO sort_order(parent, name, position) VALUES (?1, ?2, ?3)",
                params![parent, name, position as i64],
            )
            .map_err(|_| "The custom order could not be saved.".to_string())?;
        }
        tx.commit()
            .map_err(|_| "The custom order could not be saved.".to_string())
    }

    pub fn sort_positions(&self, parent: &str) -> HashMap<String, i64> {
        let mut map = HashMap::new();
        let mut statement = match self
            .connection
            .prepare("SELECT name, position FROM sort_order WHERE parent = ?1")
        {
            Ok(statement) => statement,
            Err(_) => return map,
        };
        let rows = statement.query_map(params![parent], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        });
        if let Ok(iter) = rows {
            for (name, position) in iter.flatten() {
                map.insert(name, position);
            }
        }
        map
    }

    pub fn has_custom_order(&self, parent: &str) -> bool {
        self.connection
            .query_row(
                "SELECT 1 FROM sort_order WHERE parent = ?1 LIMIT 1",
                params![parent],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
    }
}

fn remove_database_files(database: &Path) {
    let _ = std::fs::remove_file(database);
    for suffix in ["-wal", "-shm"] {
        let mut name = database.as_os_str().to_os_string();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}

pub fn index_database_path(data_dir: &Path, vault_root: &Path) -> PathBuf {
    let text = vault_root.to_string_lossy();
    #[cfg(windows)]
    let text = text.to_lowercase();
    let hash = fnv1a64(text.as_bytes());
    data_dir
        .join("indexes")
        .join(format!("{hash:016x}.sqlite"))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn build_fts_query(query: &str) -> Option<String> {
    let mut parts = Vec::new();
    for token in query.split_whitespace() {
        let token = token.trim_matches('"');
        if token.is_empty() {
            continue;
        }
        if !token.chars().any(|c| c.is_alphanumeric()) {
            continue;
        }
        parts.push(format!("\"{}\"", token.replace('"', "\"\"")));
    }
    if parts.is_empty() {
        // A query made only of punctuation should not reach FTS syntax errors.
        None
    } else {
        Some(parts.join(" AND "))
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Index) {
        let dir = tempfile::tempdir().unwrap();
        let index = Index::open(&dir.path().join("index.sqlite"), dir.path()).unwrap();
        (dir, index)
    }

    #[test]
    fn enumerates_and_searches_files() {
        let (dir, mut index) = setup();
        std::fs::write(dir.path().join("alpha.txt"), "first line\nbanana split\nlast\n").unwrap();
        index
            .upsert_file("alpha.txt", "alpha.txt", 30, 1, Some("first line\nbanana split\nlast\n"))
            .unwrap();
        let hits = index.search("banana", 20).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "alpha.txt");
        assert_eq!(hits[0].line, Some(2));
        assert_eq!(hits[0].line_text, "banana split");

        let name_hits = index.search("alpha", 20).unwrap();
        assert!(name_hits.iter().any(|hit| hit.path == "alpha.txt"));
    }

    #[test]
    fn search_is_case_insensitive() {
        let (dir, mut index) = setup();
        std::fs::write(dir.path().join("Note.txt"), "Hello World\n").unwrap();
        index
            .upsert_file("Note.txt", "Note.txt", 13, 1, Some("Hello World\n"))
            .unwrap();
        assert_eq!(index.search("hello", 10).unwrap().len(), 1);
        assert_eq!(index.search("NOTE", 10).unwrap().len(), 1);
    }

    #[test]
    fn name_search_handles_unicode_case() {
        let (dir, mut index) = setup();
        std::fs::write(dir.path().join("Été.txt"), "summer\n").unwrap();
        index
            .upsert_file("Été.txt", "Été.txt", 7, 1, Some("summer\n"))
            .unwrap();
        let hits = index.search("éTÉ", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "Été.txt");
    }

    #[test]
    fn tags_pins_recents_and_order_round_trip() {
        let (_dir, mut index) = setup();
        index
            .upsert_file("a.txt", "a.txt", 1, 1, Some("text"))
            .unwrap();
        index
            .set_tags("a.txt", &["work".into(), "#work".into(), "home".into()])
            .unwrap();
        assert_eq!(index.tags_for("a.txt"), vec!["home", "work"]);
        let counts = index.tag_counts();
        assert_eq!(counts.iter().find(|item| item.tag == "work").unwrap().count, 1);
        assert_eq!(counts.iter().find(|item| item.tag == "home").unwrap().count, 1);
        index.set_pin("a.txt", true).unwrap();
        assert_eq!(index.pins(), vec!["a.txt"]);
        index.record_recent("a.txt").unwrap();
        assert_eq!(index.recents(20), vec!["a.txt"]);
        index
            .set_sort_order("", &["b.txt".into(), "a.txt".into()])
            .unwrap();
        assert_eq!(index.sort_positions("")["b.txt"], 0);
    }

    #[test]
    fn removal_drops_children_and_organization() {
        let (_dir, mut index) = setup();
        index
            .upsert_file("notes/a.txt", "a.txt", 1, 1, Some("alpha"))
            .unwrap();
        index.set_tags("notes/a.txt", &["tag".into()]).unwrap();
        index.set_pin("notes/a.txt", true).unwrap();
        index.remove_path("notes").unwrap();
        assert!(index.search("alpha", 20).unwrap().is_empty());
        assert!(index.tags_for("notes/a.txt").is_empty());
        assert!(index.pins().is_empty());
    }
}
