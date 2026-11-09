use super::*;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn fixture() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    git(temp.path(), &["init", "-q"]);
    git(temp.path(), &["config", "user.name", "Test"]);
    git(
        temp.path(),
        &["config", "user.email", "test@example.invalid"],
    );
    git(temp.path(), &["config", "commit.gpgsign", "false"]);
    git(temp.path(), &["config", "core.hooksPath", ".git/hooks"]);
    fs::create_dir(temp.path().join("scripts")).unwrap();
    fs::write(temp.path().join("scripts/query.sql"), "SELECT 1;\n").unwrap();
    fs::write(temp.path().join("outside.txt"), "original\n").unwrap();
    git(temp.path(), &["add", "."]);
    git(
        temp.path(),
        &["-c", "core.hooksPath=/dev/null", "commit", "-qm", "initial"],
    );
    temp
}

fn selected(review: GitReview) -> ReviewedFile {
    ReviewedFile {
        path: review.path,
        token: review.token,
    }
}

#[test]
fn commits_only_reviewed_disk_content_preserving_unrelated_staging() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(temp.path().join("outside.txt"), "staged\n").unwrap();
    git(temp.path(), &["add", "outside.txt"]);
    let staged = git(temp.path(), &["ls-files", "--stage", "outside.txt"]);
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    let listed = status(&root).unwrap();
    assert_eq!(listed.files.len(), 1);
    assert_eq!(listed.files[0].path, "query.sql");
    let reviewed = review(&root, "query.sql").unwrap();
    assert!(reviewed.diff.contains("+SELECT 2;"));
    let result = commit(&root, &[selected(reviewed)], "reviewed SQL").unwrap();
    assert!(result.warning.is_none(), "{:?}", result.warning);
    assert_eq!(
        git(temp.path(), &["show", "HEAD:scripts/query.sql"]),
        "SELECT 2;\n"
    );
    assert_eq!(
        git(temp.path(), &["show", "HEAD:outside.txt"]),
        "original\n"
    );
    assert_eq!(
        git(temp.path(), &["ls-files", "--stage", "outside.txt"]),
        staged
    );
    assert_eq!(
        git(temp.path(), &["diff", "--cached", "--name-only"]).trim(),
        "outside.txt"
    );
}

#[test]
fn refuses_changes_after_review_and_leaves_head_and_index_untouched() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(root.join("query.sql"), "SELECT 2;").unwrap();
    let reviewed = selected(review(&root, "query.sql").unwrap());
    let head = git(temp.path(), &["rev-parse", "HEAD"]);
    let index = fs::read(temp.path().join(".git/index")).unwrap();
    fs::write(root.join("query.sql"), "SELECT 3;").unwrap();
    assert!(commit(&root, &[reviewed], "stale")
        .unwrap_err()
        .contains("changed since review"));
    assert_eq!(git(temp.path(), &["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read(temp.path().join(".git/index")).unwrap(), index);
}

#[test]
fn commits_added_and_deleted_paths_as_explicit_rename_pair() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::rename(root.join("query.sql"), root.join("--new ü name.sql")).unwrap();
    let changes = status(&root).unwrap();
    assert_eq!(changes.files.len(), 2);
    let files: Vec<_> = changes
        .files
        .iter()
        .map(|file| selected(review(&root, &file.path).unwrap()))
        .collect();
    commit(&root, &files, "rename").unwrap();
    assert!(git(temp.path(), &["status", "--porcelain"]).is_empty());
    assert_eq!(
        git(temp.path(), &["show", "HEAD:scripts/--new ü name.sql"]),
        "SELECT 1;\n"
    );
}

#[test]
fn rejects_traversal_non_sql_paths_and_index_locks() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    for path in [
        "../outside.txt",
        "/outside.sql",
        "query.txt",
        ".git/config.sql",
    ] {
        assert!(review(&root, path).is_err(), "{path}");
    }
    fs::write(root.join("query.sql"), "SELECT 2;").unwrap();
    let reviewed = selected(review(&root, "query.sql").unwrap());
    fs::write(temp.path().join(".git/index.lock"), "external lock").unwrap();
    assert!(commit(&root, &[reviewed], "locked")
        .unwrap_err()
        .contains("locked"));
    assert_eq!(
        fs::read_to_string(temp.path().join(".git/index.lock")).unwrap(),
        "external lock"
    );
}

#[test]
fn staged_only_files_are_not_silently_committed() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    git(temp.path(), &["add", "scripts/query.sql"]);
    fs::write(root.join("query.sql"), "SELECT 1;\n").unwrap();
    assert!(review(&root, "query.sql")
        .unwrap_err()
        .contains("no changes"));
    assert!(git(temp.path(), &["diff", "--cached"]).contains("+SELECT 2;"));
}

#[test]
fn concurrent_commits_from_two_links_to_the_same_repo_serialize() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    let nested = root.join("nested");
    fs::create_dir(&nested).unwrap();
    fs::write(nested.join("other.sql"), "SELECT 1;").unwrap();
    git(temp.path(), &["add", "."]);
    git(temp.path(), &["commit", "-qm", "nested fixture"]);
    fs::write(root.join("query.sql"), "SELECT 2;").unwrap();
    fs::write(nested.join("other.sql"), "SELECT 3;").unwrap();
    let first = selected(review(&root, "query.sql").unwrap());
    let second = selected(review(&nested, "other.sql").unwrap());
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let start = barrier.clone();
    let one = std::thread::spawn(move || {
        start.wait();
        commit(&root, &[first], "first")
    });
    let two = std::thread::spawn(move || {
        barrier.wait();
        commit(&nested, &[second], "second")
    });
    let results = [one.join().unwrap(), two.join().unwrap()];
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        git(temp.path(), &["rev-list", "--count", "HEAD"]).trim(),
        "3"
    );
    assert!(!temp.path().join(".git/index.lock").exists());
}

#[cfg(unix)]
#[test]
fn git_pathspec_syntax_shell_characters_tabs_and_newlines_are_literal() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    let name = ":(glob)*;$(echo nope)\tline\n.sql";
    fs::write(root.join(name), "SELECT 42;\n").unwrap();
    assert!(status(&root)
        .unwrap()
        .files
        .iter()
        .any(|file| file.path == name));
    let file = selected(review(&root, name).unwrap());
    commit(&root, &[file], "literal unusual path").unwrap();
    assert!(git(temp.path(), &["status", "--porcelain"]).is_empty());
    assert_eq!(
        git(temp.path(), &["show", &format!("HEAD:scripts/{name}")]),
        "SELECT 42;\n"
    );
}

#[test]
fn linked_worktrees_use_their_own_head_and_index() {
    let temp = fixture();
    let worktree = temp.path().join("linked-worktree");
    git(
        temp.path(),
        &[
            "worktree",
            "add",
            "-b",
            "linked-test",
            worktree.to_str().unwrap(),
            "HEAD",
        ],
    );
    let head = git(temp.path(), &["rev-parse", "HEAD"]);
    let root = worktree.join("scripts");
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    let file = selected(review(&root, "query.sql").unwrap());
    commit(&root, &[file], "worktree SQL").unwrap();
    assert_eq!(git(temp.path(), &["rev-parse", "HEAD"]), head);
    assert_eq!(
        git(&worktree, &["show", "HEAD:scripts/query.sql"]),
        "SELECT 2;\n"
    );
    assert!(git(&worktree, &["status", "--porcelain"]).is_empty());
}

#[test]
fn deleted_oversize_blobs_are_refused_before_generating_a_diff() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(root.join("big.sql"), vec![b'x'; MAX_CONTENT as usize + 1]).unwrap();
    git(temp.path(), &["add", "scripts/big.sql"]);
    git(temp.path(), &["commit", "-qm", "large fixture"]);
    fs::remove_file(root.join("big.sql")).unwrap();
    assert!(review(&root, "big.sql").unwrap_err().contains("too large"));
}

#[test]
fn external_staging_and_head_changes_invalidate_a_review() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    let file = selected(review(&root, "query.sql").unwrap());
    fs::write(temp.path().join("outside.txt"), "external staged edit").unwrap();
    git(temp.path(), &["add", "outside.txt"]);
    assert!(commit(&root, &[file], "stale index")
        .unwrap_err()
        .contains("changed since review"));
    let file = selected(review(&root, "query.sql").unwrap());
    git(temp.path(), &["commit", "-qm", "external commit"]);
    assert!(commit(&root, &[file], "stale HEAD")
        .unwrap_err()
        .contains("changed since review"));
}

#[test]
fn signing_failure_does_not_move_head_or_modify_the_index() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    git(temp.path(), &["config", "commit.gpgsign", "true"]);
    git(
        temp.path(),
        &["config", "gpg.program", "tabularis-missing-test-signer"],
    );
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    let file = selected(review(&root, "query.sql").unwrap());
    let head = git(temp.path(), &["rev-parse", "HEAD"]);
    let index = fs::read(temp.path().join(".git/index")).unwrap();
    assert!(commit(&root, &[file], "sign").is_err());
    assert_eq!(git(temp.path(), &["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read(temp.path().join(".git/index")).unwrap(), index);
    assert!(!temp.path().join(".git/index.lock").exists());
}

#[test]
fn never_removes_an_index_lock_created_by_a_post_commit_hook() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    let path = temp.path().join(".git/hooks/post-commit");
    fs::write(&path, "#!/bin/sh\necho external-lock > .git/index.lock\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let file = selected(review(&root, "query.sql").unwrap());
    commit(&root, &[file], "post hook").unwrap();
    assert_eq!(
        fs::read_to_string(temp.path().join(".git/index.lock"))
            .unwrap()
            .trim(),
        "external-lock"
    );
}

fn hook(root: &Path, script: &str) {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    let path = root.join(".git/hooks/pre-commit");
    fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn rejects_failing_hooks_and_hooks_that_expand_the_commit_scope() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    fs::write(root.join("query.sql"), "SELECT 2;\n").unwrap();
    let head = git(temp.path(), &["rev-parse", "HEAD"]);
    hook(temp.path(), "echo hook-refused >&2; exit 1");
    let file = selected(review(&root, "query.sql").unwrap());
    assert!(commit(&root, &[file], "hook")
        .unwrap_err()
        .contains("hook-refused"));
    assert_eq!(git(temp.path(), &["rev-parse", "HEAD"]), head);
    hook(
        temp.path(),
        "echo hook-change > outside.txt; git add outside.txt",
    );
    let file = selected(review(&root, "query.sql").unwrap());
    assert!(commit(&root, &[file], "scope")
        .unwrap_err()
        .contains("hook changed"));
    assert_eq!(git(temp.path(), &["rev-parse", "HEAD"]), head);
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_files_and_paths_with_symlinked_parents() {
    let temp = fixture();
    let root = temp.path().join("scripts");
    std::os::unix::fs::symlink(temp.path().join("outside.txt"), root.join("escape.sql")).unwrap();
    assert!(review(&root, "escape.sql").unwrap_err().contains("symlink"));
    std::os::unix::fs::symlink(temp.path(), root.join("alias")).unwrap();
    assert!(review(&root, "alias/deleted.sql")
        .unwrap_err()
        .contains("symlink"));
}
