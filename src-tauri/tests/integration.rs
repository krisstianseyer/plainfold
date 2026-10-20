//! End-to-end checks over a temporary vault: create, edit, save, reopen, and
//! verify the bytes that actually landed on disk.

use std::path::Path;

use plainfold_lib::encoding::{Eol, TextEncoding};
use plainfold_lib::index::Index;
use plainfold_lib::tree::{build_tree, rescan_index, SortOrder};
use plainfold_lib::vault::{create_item, delete_item, read_file, save_file};
use plainfold_lib::paths::Vault;

#[test]
fn create_edit_save_and_verify_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path()).unwrap();

    let created = create_item(&vault, "", "notes/2026/day.txt", false).unwrap();
    assert_eq!(created.path, "notes/2026/day.txt");
    assert_eq!(std::fs::read(dir.path().join("notes/2026/day.txt")).unwrap(), b"");

    let read = read_file(&vault, "notes/2026/day.txt").unwrap();
    let expected_default = if cfg!(windows) { Eol::Crlf } else { Eol::Lf };
    assert_eq!(read.eol, expected_default);
    assert!(!read.read_only);

    save_file(
        &vault,
        "notes/2026/day.txt",
        "first\nsecond\n",
        "utf-8",
        "lf",
    )
    .unwrap();
    assert_eq!(
        std::fs::read(dir.path().join("notes/2026/day.txt")).unwrap(),
        b"first\nsecond\n"
    );

    let reopened = read_file(&vault, "notes/2026/day.txt").unwrap();
    assert_eq!(reopened.content, "first\nsecond\n");
    assert_eq!(reopened.eol, Eol::Lf);
}

#[test]
fn utf16_bom_and_crlf_survive_a_save() {
    let dir = tempfile::tempdir().unwrap();
    let contents = plainfold_lib::encoding::encode(
        "alpha\nbeta\n",
        TextEncoding::Utf16Le,
        Eol::Crlf,
    );
    std::fs::write(dir.path().join("wide.txt"), &contents).unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    let read = read_file(&vault, "wide.txt").unwrap();
    assert_eq!(read.encoding, "utf-16le");
    assert_eq!(read.eol, Eol::Crlf);

    save_file(&vault, "wide.txt", "gamma\n", "utf-16le", "crlf").unwrap();
    let bytes = std::fs::read(dir.path().join("wide.txt")).unwrap();
    assert_eq!(&bytes[..2], &[0xFF, 0xFE]);
    assert_eq!(
        bytes[2..].chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect::<Vec<_>>(),
        "gamma\r\n".encode_utf16().collect::<Vec<_>>()
    );
}

#[test]
fn index_searches_contents_and_names_after_rescan() {
    let dir = tempfile::tempdir().unwrap();
    // The index lives outside the vault in the app, so the test keeps it out
    // of the scanned folder too.
    let root = dir.path().join("vault");
    std::fs::create_dir(&root).unwrap();
    let vault = Vault::open(&root).unwrap();
    create_item(&vault, "", "journal.txt", false).unwrap();
    create_item(&vault, "", "folder/recipe.txt", false).unwrap();
    save_file(
        &vault,
        "journal.txt",
        "A quiet morning\nwith coffee\n",
        "utf-8",
        "lf",
    )
    .unwrap();
    save_file(
        &vault,
        "folder/recipe.txt",
        "coffee and toast\n",
        "utf-8",
        "lf",
    )
    .unwrap();

    let mut index = Index::open(&dir.path().join("index.sqlite"), &root).unwrap();
    let count = rescan_index(&mut index, &vault).unwrap();
    assert_eq!(count, 2);

    let hits = index.search("coffee", 20).unwrap();
    assert_eq!(hits.len(), 2);
    let journal = hits.iter().find(|hit| hit.path == "journal.txt").unwrap();
    assert_eq!(journal.line, Some(2));
    assert_eq!(journal.line_text, "with coffee");

    let name_hits = index.search("recipe", 20).unwrap();
    assert!(name_hits.iter().any(|hit| hit.path == "folder/recipe.txt"));
}

#[test]
fn tree_lists_folders_before_files() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    create_item(&vault, "", "zeta.txt", false).unwrap();
    create_item(&vault, "", "alpha/inner.txt", false).unwrap();

    let tree = build_tree(&vault, SortOrder::Name, None);
    assert_eq!(tree[0].name, "alpha");
    assert!(tree[0].is_dir);
    assert_eq!(tree[1].name, "zeta.txt");
}

#[test]
fn rejects_paths_outside_the_vault_and_invalid_names() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    std::fs::create_dir(&root).unwrap();
    let outside = dir.path().join("outside.txt");
    std::fs::write(&outside, "secret").unwrap();
    let vault = Vault::open(&root).unwrap();

    assert!(read_file(&vault, "../outside.txt").is_err());
    assert!(vault
        .resolve_existing(outside.to_str().unwrap())
        .is_err());
    assert!(create_item(&vault, "", "../escape.txt", false).is_err());
    assert!(create_item(&vault, "", "bad:name.txt", false).is_err());
    #[cfg(windows)]
    assert!(create_item(&vault, "", "CON.txt", false).is_err());
}

#[test]
fn delete_moves_to_trash_without_touching_other_files() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    create_item(&vault, "", "keep.txt", false).unwrap();
    create_item(&vault, "", "remove.txt", false).unwrap();

    delete_item(&vault, "remove.txt").unwrap();
    assert!(!dir.path().join("remove.txt").exists());
    assert!(dir.path().join("keep.txt").is_file());
}

#[test]
fn symlink_outside_the_vault_cannot_be_read_saved_or_followed_by_delete() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("vault");
    std::fs::create_dir(&root).unwrap();
    let outside = dir.path().join("outside.txt");
    std::fs::write(&outside, "secret").unwrap();
    let link = root.join("link.txt");

    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_file(&outside, &link);
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(&outside, &link);

    if created.is_err() {
        // Windows requires Developer Mode or elevation for symlinks.
        eprintln!("symlink test skipped: cannot create symlink");
        return;
    }

    let vault = Vault::open(&root).unwrap();
    assert!(read_file(&vault, "link.txt").is_err());
    assert!(save_file(&vault, "link.txt", "changed\n", "utf-8", "lf").is_err());
    assert_eq!(std::fs::read(&outside).unwrap(), b"secret");

    delete_item(&vault, "link.txt").unwrap();
    assert_eq!(std::fs::read(&outside).unwrap(), b"secret");
    assert!(!link.exists());
}

#[test]
fn atomic_save_keeps_the_original_when_the_path_is_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    create_item(&vault, "", "note.txt", false).unwrap();
    save_file(&vault, "note.txt", "original\n", "utf-8", "lf").unwrap();

    // A folder that does not exist cannot receive a file. The original must
    // still hold its previous bytes.
    let result = save_file(
        &vault,
        "missing/note.txt",
        "replacement\n",
        "utf-8",
        "lf",
    );
    assert!(result.is_err());
    assert_eq!(
        std::fs::read(Path::new(dir.path()).join("note.txt")).unwrap(),
        b"original\n"
    );
}
