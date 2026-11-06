use super::*;
use std::fs;
use tempfile::TempDir;

struct Fixture {
    _config: TempDir,
    workspace: TempDir,
    store: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let config = tempfile::tempdir().unwrap();
        let store = links_file_path(config.path());
        Self {
            _config: config,
            workspace: tempfile::tempdir().unwrap(),
            store,
        }
    }

    fn root(&self) -> PathBuf {
        self.workspace.path().join("sql")
    }

    fn link(&self) -> LinkedFolder {
        fs::create_dir_all(self.root()).unwrap();
        link_folder(&self.store, self.root().to_str().unwrap()).unwrap()
    }
}

fn names(listing: &LinkedDirectoryListing) -> Vec<&str> {
    listing
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect()
}

#[test]
fn links_are_persisted_deduplicated_and_removable() {
    let fixture = Fixture::new();
    let first = fixture.link();
    let second = fixture.link();
    assert_eq!(first, second);
    assert_eq!(first.name, "sql");

    let listed = list_linked_folders(&fixture.store).unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].available);

    unlink_folder(&fixture.store, &first.id).unwrap();
    assert!(list_linked_folders(&fixture.store).unwrap().is_empty());
    unlink_folder(&fixture.store, &first.id).unwrap();
}

#[test]
fn link_rejects_relative_missing_and_file_paths() {
    let fixture = Fixture::new();
    assert!(link_folder(&fixture.store, "sql").is_err());
    let missing = fixture.workspace.path().join("missing");
    assert_eq!(
        link_folder(&fixture.store, missing.to_str().unwrap()).unwrap_err(),
        LINKED_FOLDER_UNAVAILABLE
    );
    let file = fixture.workspace.path().join("a.sql");
    fs::write(&file, "select 1").unwrap();
    assert_eq!(
        link_folder(&fixture.store, file.to_str().unwrap()).unwrap_err(),
        LINKED_FOLDER_UNAVAILABLE
    );
}

#[test]
fn link_limit_is_enforced() {
    let fixture = Fixture::new();
    for index in 0..MAX_LINKED_FOLDERS {
        let dir = fixture.workspace.path().join(format!("d{index}"));
        fs::create_dir_all(&dir).unwrap();
        link_folder(&fixture.store, dir.to_str().unwrap()).unwrap();
    }
    let extra = fixture.workspace.path().join("extra");
    fs::create_dir_all(&extra).unwrap();
    assert_eq!(
        link_folder(&fixture.store, extra.to_str().unwrap()).unwrap_err(),
        LINKED_FOLDER_LIMIT_REACHED
    );
}

#[test]
fn corrupt_store_is_reported_and_left_untouched() {
    let fixture = Fixture::new();
    fs::write(&fixture.store, "{not json").unwrap();
    assert_eq!(
        list_linked_folders(&fixture.store).unwrap_err(),
        LINKED_FOLDERS_FILE_UNREADABLE
    );
    fs::create_dir_all(fixture.root()).unwrap();
    assert!(link_folder(&fixture.store, fixture.root().to_str().unwrap()).is_err());
    assert_eq!(fs::read_to_string(&fixture.store).unwrap(), "{not json");
}

#[test]
fn reopening_links_survives_a_restart_and_flags_a_missing_root() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::remove_dir_all(fixture.root()).unwrap();
    let listed = list_linked_folders(&fixture.store).unwrap();
    assert_eq!(listed[0].folder.id, folder.id);
    assert!(!listed[0].available);
    assert_eq!(
        list_linked_directory(&fixture.store, &folder.id, "").unwrap_err(),
        LINKED_FOLDER_UNAVAILABLE
    );
}

#[test]
fn split_relative_path_rejects_escapes_and_depth() {
    assert!(split_relative_path("").unwrap().is_empty());
    assert_eq!(split_relative_path("a/b.sql").unwrap(), vec!["a", "b.sql"]);
    for bad in ["../x", "a/../x", "/abs", "a//b", "./a", "a/."] {
        assert_eq!(
            split_relative_path(bad).unwrap_err(),
            LINKED_PATH_OUTSIDE_ROOT,
            "{bad}"
        );
    }
    let deep = vec!["d"; MAX_RELATIVE_DEPTH + 1].join("/");
    assert!(split_relative_path(&deep).is_err());
}

#[test]
fn listing_is_lazy_sorted_and_filtered() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    let root = fixture.root();
    fs::create_dir_all(root.join("reports")).unwrap();
    fs::create_dir_all(root.join("Archive")).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::write(root.join("b.sql"), "").unwrap();
    fs::write(root.join("A.PGSQL"), "").unwrap();
    fs::write(root.join("notes.txt"), "").unwrap();
    fs::write(root.join(".hidden.sql"), "").unwrap();
    fs::write(root.join("reports/monthly.sql"), "").unwrap();

    let top = list_linked_directory(&fixture.store, &folder.id, "").unwrap();
    assert_eq!(names(&top), vec!["Archive", "reports", "A.PGSQL", "b.sql"]);
    assert!(!top.truncated);

    let nested = list_linked_directory(&fixture.store, &folder.id, "reports").unwrap();
    assert_eq!(nested.entries[0].relative_path, "reports/monthly.sql");
    assert_eq!(nested.entries[0].kind, LinkedEntryKind::File);
}

#[test]
fn listing_is_bounded() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    for index in 0..(MAX_ENTRIES_PER_DIRECTORY + 5) {
        fs::write(fixture.root().join(format!("s{index}.sql")), "").unwrap();
    }
    let listing = list_linked_directory(&fixture.store, &folder.id, "").unwrap();
    assert_eq!(listing.entries.len(), MAX_ENTRIES_PER_DIRECTORY);
    assert!(listing.truncated);
}

#[test]
fn truncation_keeps_the_first_entries_in_sorted_order() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    // Created in reverse so directory order cannot match sorted order by luck.
    for index in (0..(MAX_ENTRIES_PER_DIRECTORY + 5)).rev() {
        fs::write(fixture.root().join(format!("s{index:04}.sql")), "").unwrap();
    }
    fs::create_dir_all(fixture.root().join("zz-folder")).unwrap();
    let listing = list_linked_directory(&fixture.store, &folder.id, "").unwrap();
    assert!(listing.truncated);
    assert_eq!(listing.entries[0].name, "zz-folder");
    assert_eq!(listing.entries[1].name, "s0000.sql");
    assert_eq!(listing.entries.last().unwrap().name, "s0998.sql");
}

#[test]
fn listing_stops_at_the_depth_limit() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    let mut relative = String::new();
    let mut path = fixture.root();
    for level in 0..MAX_RELATIVE_DEPTH {
        let name = format!("d{level}");
        path.push(&name);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("x.sql"), "").unwrap();
        let listing = list_linked_directory(&fixture.store, &folder.id, &relative).unwrap();
        let has_child_dir = listing
            .entries
            .iter()
            .any(|entry| entry.kind == LinkedEntryKind::Directory);
        assert_eq!(
            has_child_dir,
            level + 1 < MAX_RELATIVE_DEPTH,
            "level {level}"
        );
        if !relative.is_empty() {
            relative.push('/');
        }
        relative.push_str(&name);
    }
    assert!(list_linked_directory(&fixture.store, &folder.id, &relative).is_ok());
}

#[test]
fn listing_rejects_traversal_outside_the_root() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    assert_eq!(
        list_linked_directory(&fixture.store, &folder.id, "..").unwrap_err(),
        LINKED_PATH_OUTSIDE_ROOT
    );
    assert_eq!(
        read_linked_sql_file(&fixture.store, &folder.id, "../secret.sql").unwrap_err(),
        LINKED_PATH_OUTSIDE_ROOT
    );
    assert_eq!(
        list_linked_directory(&fixture.store, "unknown", "").unwrap_err(),
        LINKED_FOLDER_NOT_FOUND
    );
    assert_eq!(
        list_linked_directory(&fixture.store, &folder.id, "missing").unwrap_err(),
        LINKED_DIRECTORY_UNREADABLE
    );
}

#[test]
fn unicode_and_spaced_names_round_trip() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::create_dir_all(fixture.root().join("rapports été")).unwrap();
    let relative = "rapports été/月次 report.sql";
    let saved = write_linked_sql_file(
        &fixture.store,
        &folder.id,
        relative,
        "SELECT 'é', '日本';\n",
        None,
        true,
    )
    .unwrap();
    let listing = list_linked_directory(&fixture.store, &folder.id, "rapports été").unwrap();
    assert_eq!(names(&listing), vec!["月次 report.sql"]);

    let read = read_linked_sql_file(&fixture.store, &folder.id, relative).unwrap();
    assert_eq!(read.content, "SELECT 'é', '日本';\n");
    assert_eq!(read.version, saved.version);
    assert_eq!(read.path, saved.path);
}

#[cfg(unix)]
mod symlinks {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn links_inside_the_root_are_followed_and_share_identity() {
        let fixture = Fixture::new();
        let folder = fixture.link();
        let root = fixture.root();
        fs::create_dir_all(root.join("real")).unwrap();
        fs::write(root.join("real/a.sql"), "select 1").unwrap();
        symlink(root.join("real"), root.join("alias")).unwrap();

        let listing = list_linked_directory(&fixture.store, &folder.id, "").unwrap();
        assert_eq!(names(&listing), vec!["alias", "real"]);
        let direct = read_linked_sql_file(&fixture.store, &folder.id, "real/a.sql").unwrap();
        let aliased = read_linked_sql_file(&fixture.store, &folder.id, "alias/a.sql").unwrap();
        assert_eq!(direct.path, aliased.path);
    }

    #[test]
    fn links_leaving_the_root_or_dangling_are_hidden_and_unusable() {
        let fixture = Fixture::new();
        let folder = fixture.link();
        let root = fixture.root();
        let outside = fixture.workspace.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.sql"), "select 'secret'").unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        symlink(outside.join("secret.sql"), root.join("leak.sql")).unwrap();
        symlink(root.join("nowhere"), root.join("dangling.sql")).unwrap();

        let listing = list_linked_directory(&fixture.store, &folder.id, "").unwrap();
        assert!(listing.entries.is_empty());
        assert_eq!(
            read_linked_sql_file(&fixture.store, &folder.id, "leak.sql").unwrap_err(),
            LINKED_PATH_OUTSIDE_ROOT
        );
        assert_eq!(
            read_linked_sql_file(&fixture.store, &folder.id, "escape/secret.sql").unwrap_err(),
            LINKED_PATH_OUTSIDE_ROOT
        );
        assert_eq!(
            write_linked_sql_file(&fixture.store, &folder.id, "leak.sql", "x", None, true)
                .unwrap_err(),
            LINKED_PATH_OUTSIDE_ROOT
        );
        assert_eq!(
            fs::read_to_string(outside.join("secret.sql")).unwrap(),
            "select 'secret'"
        );
    }

    #[test]
    fn symlink_cycles_are_bounded_by_the_depth_limit() {
        let fixture = Fixture::new();
        let folder = fixture.link();
        let root = fixture.root();
        fs::create_dir_all(root.join("a")).unwrap();
        symlink(&root, root.join("a/loop")).unwrap();

        let mut relative = String::new();
        let mut reached_limit = false;
        for step in 0..(MAX_RELATIVE_DEPTH * 2) {
            let segment = if step % 2 == 0 { "a" } else { "loop" };
            let next = if relative.is_empty() {
                segment.to_string()
            } else {
                format!("{relative}/{segment}")
            };
            match list_linked_directory(&fixture.store, &folder.id, &next) {
                Ok(_) => relative = next,
                Err(error) => {
                    assert_eq!(error, LINKED_PATH_OUTSIDE_ROOT);
                    reached_limit = true;
                    break;
                }
            }
        }
        assert!(reached_limit);
    }

    #[test]
    fn unreadable_directories_report_an_error() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let folder = fixture.link();
        let locked = fixture.root().join("locked");
        fs::create_dir_all(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let result = list_linked_directory(&fixture.store, &folder.id, "locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        // Running as root bypasses permission bits, so only assert when denied.
        if let Err(error) = result {
            assert_eq!(error, LINKED_DIRECTORY_UNREADABLE);
        }
    }
}

#[test]
fn read_rejects_non_sql_names_and_directories() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::write(fixture.root().join("notes.txt"), "x").unwrap();
    fs::create_dir_all(fixture.root().join("dir.sql")).unwrap();
    assert_eq!(
        read_linked_sql_file(&fixture.store, &folder.id, "notes.txt").unwrap_err(),
        LINKED_PATH_NOT_SQL_FILE
    );
    assert_eq!(
        read_linked_sql_file(&fixture.store, &folder.id, "dir.sql").unwrap_err(),
        LINKED_FILE_UNREADABLE
    );
    assert_eq!(
        read_linked_sql_file(&fixture.store, &folder.id, "gone.sql").unwrap_err(),
        LINKED_FILE_UNREADABLE
    );
}

#[test]
fn read_rejects_files_that_are_not_utf8() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::write(fixture.root().join("bin.sql"), [0xff, 0xfe, 0x00]).unwrap();
    assert_eq!(
        read_linked_sql_file(&fixture.store, &folder.id, "bin.sql").unwrap_err(),
        LINKED_FILE_UNREADABLE
    );
}

#[test]
fn save_succeeds_when_the_file_is_unchanged() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::write(fixture.root().join("a.sql"), "select 1").unwrap();
    let opened = read_linked_sql_file(&fixture.store, &folder.id, "a.sql").unwrap();
    let saved = write_linked_sql_file(
        &fixture.store,
        &folder.id,
        "a.sql",
        "select 2",
        Some(&opened.version),
        false,
    )
    .unwrap();
    assert_eq!(saved.version, content_version("select 2"));
    assert_eq!(
        fs::read_to_string(fixture.root().join("a.sql")).unwrap(),
        "select 2"
    );

    // The returned version is the next expected one.
    write_linked_sql_file(
        &fixture.store,
        &folder.id,
        "a.sql",
        "select 3",
        Some(&saved.version),
        false,
    )
    .unwrap();
}

#[test]
fn save_refuses_to_overwrite_an_externally_modified_file() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    let file = fixture.root().join("a.sql");
    fs::write(&file, "select 1").unwrap();
    let opened = read_linked_sql_file(&fixture.store, &folder.id, "a.sql").unwrap();
    fs::write(&file, "select 'external'").unwrap();

    let error = write_linked_sql_file(
        &fixture.store,
        &folder.id,
        "a.sql",
        "select 'mine'",
        Some(&opened.version),
        false,
    )
    .unwrap_err();
    assert_eq!(error, LINKED_FILE_CONFLICT_MODIFIED);
    assert_eq!(fs::read_to_string(&file).unwrap(), "select 'external'");

    write_linked_sql_file(
        &fixture.store,
        &folder.id,
        "a.sql",
        "select 'mine'",
        Some(&opened.version),
        true,
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "select 'mine'");
}

#[test]
fn save_without_an_expected_version_is_a_conflict_on_existing_files() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::write(fixture.root().join("a.sql"), "select 1").unwrap();
    assert_eq!(
        write_linked_sql_file(&fixture.store, &folder.id, "a.sql", "x", None, false).unwrap_err(),
        LINKED_FILE_CONFLICT_MODIFIED
    );
}

#[test]
fn save_reports_a_deleted_file_and_recreates_it_only_when_asked() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    let file = fixture.root().join("a.sql");
    fs::write(&file, "select 1").unwrap();
    let opened = read_linked_sql_file(&fixture.store, &folder.id, "a.sql").unwrap();
    fs::remove_file(&file).unwrap();

    assert_eq!(
        write_linked_sql_file(
            &fixture.store,
            &folder.id,
            "a.sql",
            "draft",
            Some(&opened.version),
            false
        )
        .unwrap_err(),
        LINKED_FILE_CONFLICT_MISSING
    );
    assert!(!file.exists());

    write_linked_sql_file(
        &fixture.store,
        &folder.id,
        "a.sql",
        "draft",
        Some(&opened.version),
        true,
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "draft");
}

#[test]
fn save_reports_a_deleted_parent_directory_as_missing() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    assert_eq!(
        write_linked_sql_file(&fixture.store, &folder.id, "gone/a.sql", "x", None, true)
            .unwrap_err(),
        LINKED_FILE_CONFLICT_MISSING
    );
}

#[test]
fn save_rejects_traversal_and_non_sql_targets() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    assert_eq!(
        write_linked_sql_file(&fixture.store, &folder.id, "../evil.sql", "x", None, true)
            .unwrap_err(),
        LINKED_PATH_OUTSIDE_ROOT
    );
    assert_eq!(
        write_linked_sql_file(&fixture.store, &folder.id, "evil.sh", "x", None, true).unwrap_err(),
        LINKED_PATH_NOT_SQL_FILE
    );
    assert!(!fixture.workspace.path().join("evil.sql").exists());
}

#[test]
fn content_version_is_stable_and_content_sensitive() {
    assert_eq!(content_version("a"), content_version("a"));
    assert_ne!(content_version("a"), content_version("b"));
    assert_eq!(content_version("").len(), 64);
}

#[test]
fn save_rejects_content_above_the_read_limit() {
    let fixture = Fixture::new();
    let folder = fixture.link();
    fs::write(fixture.root().join("a.sql"), "select 1").unwrap();
    let opened = read_linked_sql_file(&fixture.store, &folder.id, "a.sql").unwrap();
    let huge = "x".repeat(MAX_SQL_FILE_BYTES as usize + 1);
    for overwrite in [false, true] {
        assert_eq!(
            write_linked_sql_file(
                &fixture.store,
                &folder.id,
                "a.sql",
                &huge,
                Some(&opened.version),
                overwrite
            )
            .unwrap_err(),
            LINKED_FILE_TOO_LARGE
        );
    }
    assert_eq!(
        fs::read_to_string(fixture.root().join("a.sql")).unwrap(),
        "select 1"
    );
}

#[cfg(unix)]
#[test]
fn write_failures_use_a_stable_code_without_the_path() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let folder = fixture.link();
    let file = fixture.root().join("ro.sql");
    fs::write(&file, "select 1").unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o444)).unwrap();
    let result = write_linked_sql_file(&fixture.store, &folder.id, "ro.sql", "x", None, true);
    fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
    // Running as root bypasses permission bits, so only assert when denied.
    if let Err(error) = result {
        assert_eq!(error, LINKED_FILE_WRITE_FAILED);
    }
}
