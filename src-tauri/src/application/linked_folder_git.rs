//! Local Git operations scoped to a canonical, user-approved SQL folder.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{Arc, LazyLock, Mutex};

const MAX_FILES: usize = 1000;
const MAX_CONTENT: u64 = 2 * 1024 * 1024;
static LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = LazyLock::new(Default::default);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repository: String,
    pub files: Vec<GitFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReview {
    pub path: String,
    pub diff: String,
    pub token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedFile {
    pub path: String,
    pub token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub commit: String,
    pub warning: Option<String>,
}

struct Repo {
    root: PathBuf,
    worktree: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
    index: PathBuf,
}

fn text(bytes: &[u8]) -> Result<String, String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| "Git returned a non-UTF-8 path or diff".into())
}

fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|s| s.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or_else(|| "Git paths must be valid UTF-8".into())
}

// Git for Windows does not accept verbatim paths in GIT_INDEX_FILE.
fn native_git_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn checked(output: Output) -> Result<Vec<u8>, String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Git failed ({}): {}",
            output.status,
            if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            }
        ));
    }
    if output.stdout.len() as u64 > MAX_CONTENT {
        return Err("Git output is too large to review safely".into());
    }
    Ok(output.stdout)
}

impl Repo {
    fn command(&self) -> Command {
        let mut command = Command::new("git");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
            .args(["--no-pager", "--literal-pathspecs", "-C"])
            .arg(native_git_path(&self.worktree));
        for key in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_COMMON_DIR",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_PARAMETERS",
            "GIT_NAMESPACE",
        ] {
            command.env_remove(key);
        }
        command
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0");
        command
    }
    fn git(&self, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>, String> {
        let mut command = self.command();
        command.args(args);
        if let Some(index) = index {
            command.env("GIT_INDEX_FILE", native_git_path(index));
        }
        checked(
            command
                .output()
                .map_err(|e| format!("Cannot run Git: {e}"))?,
        )
    }
    fn git_path(&self, name: &str) -> Result<PathBuf, String> {
        let output = text(&self.git(&["rev-parse", "--git-path", name], None)?)?;
        let path = PathBuf::from(output.strip_suffix('\n').unwrap_or(&output));
        Ok(if path.is_absolute() {
            path
        } else {
            self.worktree.join(path)
        })
    }
    fn discover(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let mut repo = Self {
            worktree: root.clone(),
            root,
            git_dir: PathBuf::new(),
            common_dir: PathBuf::new(),
            index: PathBuf::new(),
        };
        let top = text(&repo.git(&["rev-parse", "--show-toplevel"], None)?)?;
        repo.worktree =
            fs::canonicalize(top.strip_suffix('\n').unwrap_or(&top)).map_err(|e| e.to_string())?;
        if !repo.root.starts_with(&repo.worktree) {
            return Err("Linked folder is outside the repository".into());
        }
        repo.git_dir = fs::canonicalize(repo.git_path("")?).map_err(|e| e.to_string())?;
        let common = text(&repo.git(&["rev-parse", "--git-common-dir"], None)?)?;
        let common = PathBuf::from(common.strip_suffix('\n').unwrap_or(&common));
        repo.common_dir = fs::canonicalize(if common.is_absolute() {
            common
        } else {
            repo.worktree.join(common)
        })
        .map_err(|e| e.to_string())?;
        repo.index = repo.git_path("index")?;
        Ok(repo)
    }
    fn relative(&self, path: &str) -> Result<String, String> {
        let components: Vec<_> = Path::new(path).components().collect();
        if components.is_empty()
            || components.len() > 16
            || components
                .iter()
                .any(|c| !matches!(c, Component::Normal(name) if *name != ".git"))
        {
            return Err("Only SQL files below the approved folder may be reviewed".into());
        }
        if !Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| {
                ["sql", "psql", "pgsql"]
                    .iter()
                    .any(|ext| s.eq_ignore_ascii_case(ext))
            })
        {
            return Err("Only SQL scripts may be committed".into());
        }
        let mut candidate = self.root.clone();
        for component in components {
            candidate.push(component);
            match fs::symlink_metadata(&candidate) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err("Git operations on symlinks are not allowed".into())
                }
                Ok(_) => {
                    if !fs::canonicalize(&candidate)
                        .map_err(|e| e.to_string())?
                        .starts_with(&self.root)
                    {
                        return Err("Path leaves the approved folder".into());
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        if let Ok(metadata) = fs::metadata(&candidate) {
            if !metadata.is_file() || metadata.len() > MAX_CONTENT {
                return Err("Script is not a regular file or is too large".into());
            }
        }
        path_string(
            candidate
                .strip_prefix(&self.worktree)
                .map_err(|e| e.to_string())?,
        )
    }
    fn head(&self) -> Result<String, String> {
        text(&self.git(&["rev-parse", "--verify", "HEAD"], None)?).map(|s| s.trim().into())
    }
    fn index_bytes(&self) -> Result<Vec<u8>, String> {
        match fs::read(&self.index) {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    fn temp_index(&self, head: &str) -> Result<tempfile::TempPath, String> {
        let path = tempfile::Builder::new()
            .prefix("tabularis-index-")
            .tempfile_in(&self.git_dir)
            .map_err(|e| e.to_string())?
            .into_temp_path();
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        self.git(&["read-tree", head], Some(&path))?;
        Ok(path)
    }
    fn stage(&self, path: &str, index: &Path) -> Result<(), String> {
        self.check_blob(path, index)?;
        self.git(&["add", "-A", "--", path], Some(index))?;
        self.check_blob(path, index)?;
        Ok(())
    }
    fn check_blob(&self, path: &str, index: &Path) -> Result<(), String> {
        let entry = self.git(&["ls-files", "--stage", "-z", "--", path], Some(index))?;
        if entry.is_empty() {
            return Ok(());
        }
        let header = text(
            entry
                .split(|byte| *byte == b'\t')
                .next()
                .ok_or("Invalid Git index entry")?,
        )?;
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() != 3 || !["100644", "100755"].contains(&fields[0]) || fields[2] != "0" {
            return Err("Only regular, non-conflicted SQL files may be committed".into());
        }
        let size = text(&self.git(&["cat-file", "-s", fields[1]], None)?)?
            .trim()
            .parse::<u64>()
            .map_err(|e| e.to_string())?;
        if size > MAX_CONTENT {
            return Err("SQL blob is too large to review safely".into());
        }
        Ok(())
    }
    fn token(&self, relative: &str, index: &Path, head: &str) -> Result<String, String> {
        let path = self.relative(relative)?;
        let content = match fs::read(self.root.join(relative)) {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => b"deleted".to_vec(),
            Err(e) => return Err(e.to_string()),
        };
        if content.len() as u64 > MAX_CONTENT || content.contains(&0) {
            return Err("Script is too large or binary".into());
        }
        text(&content)?;
        let mut hash = Sha256::new();
        for bytes in [
            head.as_bytes().to_vec(),
            self.git(&["symbolic-ref", "HEAD"], None)?,
            self.index_bytes()?,
            path.as_bytes().to_vec(),
            content,
            self.git(&["ls-files", "--stage", "-z", "--", &path], Some(index))?,
        ] {
            hash.update(bytes.len().to_le_bytes());
            hash.update(bytes);
        }
        Ok(format!("{:x}", hash.finalize()))
    }
}

fn with_repo<T>(
    root: &Path,
    operation: impl FnOnce(&Repo) -> Result<T, String>,
) -> Result<T, String> {
    let repo = Repo::discover(root)?;
    let lock = LOCKS
        .lock()
        .map_err(|e| e.to_string())?
        .entry(repo.common_dir.clone())
        .or_default()
        .clone();
    let _guard = lock.lock().map_err(|e| e.to_string())?;
    operation(&repo)
}

pub fn status(root: &Path) -> Result<GitStatus, String> {
    with_repo(root, |repo| {
        let scope = path_string(
            repo.root
                .strip_prefix(&repo.worktree)
                .map_err(|e| e.to_string())?,
        )?;
        let output = repo.git(
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--no-renames",
                "--",
                if scope.is_empty() { "." } else { &scope },
            ],
            None,
        )?;
        let mut files = Vec::new();
        for record in output.split(|b| *b == 0).filter(|r| !r.is_empty()) {
            if record.len() < 4 {
                return Err("Invalid Git status response".into());
            }
            let path = text(&record[3..])?;
            let absolute = repo.worktree.join(&path);
            let Ok(relative) = absolute.strip_prefix(&repo.root) else {
                return Err("Git returned a path outside the approved folder".into());
            };
            let Some(relative) = relative.to_str() else {
                continue;
            };
            let relative = relative.replace(std::path::MAIN_SEPARATOR, "/");
            if repo.relative(&relative).is_err() {
                continue;
            }
            files.push(GitFile {
                path: relative,
                status: text(&record[..2])?,
            });
            if files.len() > MAX_FILES {
                return Err("Too many changed SQL scripts; narrow the linked folder".into());
            }
        }
        Ok(GitStatus {
            repository: repo.worktree.display().to_string(),
            files,
        })
    })
}

pub fn review(root: &Path, relative: &str) -> Result<GitReview, String> {
    with_repo(root, |repo| {
        let path = repo.relative(relative)?;
        let head = repo.head()?;
        let index = repo.temp_index(&head)?;
        repo.stage(&path, &index)?;
        let diff = text(&repo.git(
            &[
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--binary",
                &head,
                "--",
                &path,
            ],
            Some(&index),
        )?)?;
        if diff.lines().any(|line| line == "GIT binary patch") {
            return Err("Binary SQL files cannot be reviewed".into());
        }
        if diff.is_empty() {
            return Err("The saved script has no changes relative to HEAD".into());
        }
        Ok(GitReview {
            path: relative.into(),
            diff,
            token: repo.token(relative, &index, &head)?,
        })
    })
}

struct IndexLock {
    path: PathBuf,
    file: File,
    armed: bool,
}
impl Drop for IndexLock {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub fn commit(root: &Path, files: &[ReviewedFile], message: &str) -> Result<GitCommit, String> {
    if files.is_empty()
        || files.len() > MAX_FILES
        || message.trim().is_empty()
        || message.len() > 16_384
        || message.contains('\0')
    {
        return Err("Select reviewed scripts and enter a commit message".into());
    }
    with_repo(root, |repo| {
        for state in [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "rebase-merge",
            "rebase-apply",
        ] {
            if repo.git_path(state)?.exists() {
                return Err(
                    "Finish the repository's merge/rebase operation before committing scripts"
                        .into(),
                );
            }
        }
        let lock_path = repo.index.with_file_name("index.lock");
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| "Repository index is locked by another Git operation".to_string())?;
        let mut index_lock = IndexLock {
            path: lock_path,
            file,
            armed: true,
        };
        if let Ok(metadata) = fs::metadata(&repo.index) {
            index_lock
                .file
                .set_permissions(metadata.permissions())
                .map_err(|e| e.to_string())?;
        }
        if !repo
            .git(&["ls-files", "--unmerged", "-z"], None)?
            .is_empty()
        {
            return Err(
                "Resolve the repository's index conflicts before committing scripts".into(),
            );
        }
        let original_index = repo.index_bytes()?;
        let head = repo.head()?;
        let branch = text(&repo.git(&["symbolic-ref", "HEAD"], None)?)?
            .trim()
            .to_string();
        let index = repo.temp_index(&head)?;
        let mut paths = HashSet::new();
        for reviewed in files {
            let path = repo.relative(&reviewed.path)?;
            if !paths.insert(path.clone()) {
                return Err("A script was selected more than once".into());
            }
            repo.stage(&path, &index)?;
            if repo.token(&reviewed.path, &index, &head)? != reviewed.token {
                return Err(
                    "Repository or script changed since review. Refresh and review again".into(),
                );
            }
        }
        let expected_tree = text(&repo.git(&["write-tree"], Some(&index))?)?;
        if repo
            .git(
                &["diff", "--cached", "--name-only", "-z", &head],
                Some(&index),
            )?
            .is_empty()
        {
            return Err("No reviewed disk changes to commit".into());
        }
        let mut message_file =
            tempfile::NamedTempFile::new_in(&repo.git_dir).map_err(|e| e.to_string())?;
        message_file
            .write_all(message.trim().as_bytes())
            .map_err(|e| e.to_string())?;
        let native_message_path = native_git_path(message_file.path());
        let message_path = native_message_path
            .to_str()
            .ok_or("Invalid commit message path")?;
        repo.git(
            &["hook", "run", "--ignore-missing", "pre-commit"],
            Some(&index),
        )?;
        repo.git(
            &[
                "hook",
                "run",
                "--ignore-missing",
                "prepare-commit-msg",
                "--",
                message_path,
                "message",
            ],
            Some(&index),
        )?;
        repo.git(
            &[
                "hook",
                "run",
                "--ignore-missing",
                "commit-msg",
                "--",
                message_path,
            ],
            Some(&index),
        )?;
        if text(&repo.git(&["write-tree"], Some(&index))?)? != expected_tree {
            return Err("A Git hook changed the reviewed commit contents. Review again".into());
        }
        for reviewed in files {
            if repo.token(&reviewed.path, &index, &head)? != reviewed.token {
                return Err("A script or repository changed during commit. Review again".into());
            }
        }
        if repo.head()? != head
            || text(&repo.git(&["symbolic-ref", "HEAD"], None)?)?.trim() != branch
            || repo.index_bytes()? != original_index
        {
            return Err("Repository changed during commit. Review again".into());
        }
        let mut args = vec![
            "commit-tree",
            expected_tree.trim(),
            "-p",
            &head,
            "-F",
            message_path,
        ];
        let signing_result = repo
            .command()
            .args(["config", "--bool", "--get", "commit.gpgsign"])
            .output()
            .map_err(|e| e.to_string())?;
        let signing = if signing_result.status.code() == Some(1) {
            Vec::new()
        } else {
            checked(signing_result)?
        };
        if signing == b"true\n" {
            args.push("-S");
        }
        let oid = text(&repo.git(&args, Some(&index))?)?.trim().to_string();
        // Prepare the real index from its original state, replacing only selected entries.
        let updated = repo.temp_index(&head)?;
        if !original_index.is_empty() {
            fs::write(&updated, &original_index).map_err(|e| e.to_string())?;
        }
        for path in &paths {
            let entry = repo.git(&["ls-files", "--stage", "-z", "--", path], Some(&index))?;
            repo.git(
                &["update-index", "--force-remove", "--", path],
                Some(&updated),
            )?;
            if !entry.is_empty() {
                let mut command = repo.command();
                command
                    .args(["update-index", "-z", "--index-info"])
                    .env("GIT_INDEX_FILE", native_git_path(&updated))
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                let mut child = command.spawn().map_err(|e| e.to_string())?;
                child
                    .stdin
                    .take()
                    .ok_or("Git stdin unavailable")?
                    .write_all(&entry)
                    .map_err(|e| e.to_string())?;
                checked(child.wait_with_output().map_err(|e| e.to_string())?)?;
            }
        }
        index_lock
            .file
            .write_all(&fs::read(&updated).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        index_lock.file.sync_all().map_err(|e| e.to_string())?;
        for reviewed in files {
            if repo.token(&reviewed.path, &index, &head)? != reviewed.token {
                return Err("Script or index changed while signing. Review again".into());
            }
        }
        if repo.head()? != head
            || text(&repo.git(&["symbolic-ref", "HEAD"], None)?)?.trim() != branch
        {
            return Err("Repository changed while signing. Review again".into());
        }
        repo.git(&["update-ref", &branch, &oid, &head], None)?;
        let warning = fs::rename(&index_lock.path, &repo.index).err().map(|e| format!("Commit {oid} was created, but the index could not be updated: {e}. Inspect Git status before retrying."));
        if warning.is_none() {
            index_lock.armed = false;
        }
        // post-commit runs after the ref is updated; its failure cannot undo a commit.
        let hook_warning = repo
            .git(&["hook", "run", "--ignore-missing", "post-commit"], None)
            .err();
        Ok(GitCommit {
            commit: oid,
            warning: warning.or(hook_warning),
        })
    })
}

#[cfg(test)]
#[path = "linked_folder_git_tests.rs"]
mod tests;
