//! `tabularis install-cli` — make the `tabularis` command available in the
//! user's PATH via a symlink in a bin directory pointing at the running
//! binary (which on macOS lives inside the .app bundle).
//!
//! First run is done with the full path, e.g.:
//! `/Applications/tabularis.app/Contents/MacOS/tabularis install-cli`

use std::path::{Path, PathBuf};

/// Install state of the `tabularis` terminal command, shared between the
/// `install-cli` subcommand and the GUI Settings page.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    /// Managing the shortcut from the GUI is macOS-only: there the binary
    /// lives at a stable path inside the .app bundle and is never in PATH.
    /// On Linux the binary is either already in PATH (package manager) or at
    /// an ephemeral path (AppImage/Flatpak), so the GUI hides the section.
    pub supported: bool,
    pub installed: bool,
    pub link_path: Option<String>,
    /// Whether the directory containing the link is in `$PATH`.
    pub in_path: bool,
    /// True when the entry is a symlink we created and can delete, false for
    /// the binary itself (e.g. a package-manager install).
    pub removable: bool,
}

/// Candidate bin directories, in order of preference. `/usr/local/bin` is
/// already in PATH on macOS but usually needs elevated permissions;
/// `~/.local/bin` always works but may need a PATH addition.
fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/usr/local/bin")];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join(".local/bin"));
    }
    dirs
}

/// Returns whether `dir` is listed in the current `$PATH`.
fn dir_in_path(dir: &Path) -> bool {
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).any(|p| p == dir))
        .unwrap_or(false)
}

#[cfg(unix)]
pub fn run_install(dir: Option<PathBuf>, force: bool) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not determine the running binary path: {}", e))?;

    let dirs = match dir {
        Some(d) => vec![d],
        None => candidate_dirs(),
    };

    match install_to_first(&exe, &dirs, force) {
        Ok(link) => {
            println!("Installed: {} -> {}", link.display(), exe.display());
            let dir = link.parent().unwrap_or(Path::new(""));
            if !dir_in_path(dir) {
                println!(
                    "Note: {} is not in your PATH. Add it with:\n  export PATH=\"{}:$PATH\"",
                    dir.display(),
                    dir.display()
                );
            }
            println!("You can now run 'tabularis' from your terminal.");
            Ok(())
        }
        Err(last_error) => Err(format!(
            "Could not install the CLI shortcut: {}\nTry: sudo {} install-cli",
            last_error,
            exe.display()
        )),
    }
}

/// Try the directories in order and return the first successful link, or the
/// last error when every candidate fails.
#[cfg(unix)]
fn install_to_first(exe: &Path, dirs: &[PathBuf], force: bool) -> Result<PathBuf, String> {
    let mut last_error = String::from("no candidate bin directory available");
    for dir in dirs {
        match install_symlink(exe, dir, force) {
            Ok(link) => return Ok(link),
            Err(e) => last_error = e,
        }
    }
    Err(last_error)
}

/// Find an existing `tabularis` entry in `dirs` that resolves to `exe` — a
/// symlink created by a previous install, or the binary itself when a package
/// manager already placed it in PATH.
// Compiled for unix tests too so the helper stays covered on Linux dev machines.
#[cfg(any(target_os = "macos", all(test, unix)))]
pub(crate) fn find_link_in_dirs(exe: &Path, dirs: &[PathBuf]) -> Option<PathBuf> {
    let exe = std::fs::canonicalize(exe).ok()?;
    dirs.iter()
        .map(|dir| dir.join("tabularis"))
        .find(|link| std::fs::canonicalize(link).is_ok_and(|target| target == exe))
}

#[cfg(target_os = "macos")]
fn status_for_link(link: PathBuf) -> CliInstallStatus {
    let in_path = link.parent().map(dir_in_path).unwrap_or(false);
    let removable = std::fs::symlink_metadata(&link)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    CliInstallStatus {
        supported: true,
        installed: true,
        link_path: Some(link.display().to_string()),
        in_path,
        removable,
    }
}

/// Directories scanned when looking for an existing install: the candidates
/// plus every `$PATH` entry, so custom `--dir` installs and package-manager
/// installs are recognized too.
#[cfg(target_os = "macos")]
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = candidate_dirs();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs
}

/// Current install state, for the GUI Settings page.
#[cfg(target_os = "macos")]
pub fn install_status() -> CliInstallStatus {
    let not_installed = CliInstallStatus {
        supported: true,
        installed: false,
        link_path: None,
        in_path: false,
        removable: false,
    };
    let Ok(exe) = std::env::current_exe() else {
        return not_installed;
    };
    match find_link_in_dirs(&exe, &search_dirs()) {
        Some(link) => status_for_link(link),
        None => not_installed,
    }
}

/// Install into the first writable candidate dir, for the GUI Settings page.
/// Same behaviour as `install-cli` without `--dir`, but returns structured
/// state instead of printing.
#[cfg(target_os = "macos")]
pub fn install_from_gui(force: bool) -> Result<CliInstallStatus, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not determine the running binary path: {}", e))?;
    let link = install_to_first(&exe, &candidate_dirs(), force)?;
    Ok(status_for_link(link))
}

/// Remove `link` only when it is a symlink resolving to `exe`; foreign
/// entries and the binary itself are never touched.
// Compiled for unix tests too so the helper stays covered on Linux dev machines.
#[cfg(any(target_os = "macos", all(test, unix)))]
pub(crate) fn remove_symlink(exe: &Path, link: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(link)
        .map_err(|e| format!("could not inspect {}: {}", link.display(), e))?;
    if !meta.file_type().is_symlink() {
        return Err(format!(
            "{} is not a symlink created by Tabularis; refusing to remove it",
            link.display()
        ));
    }
    let exe = std::fs::canonicalize(exe)
        .map_err(|e| format!("could not resolve {}: {}", exe.display(), e))?;
    let target = std::fs::canonicalize(link)
        .map_err(|e| format!("could not resolve {}: {}", link.display(), e))?;
    if target != exe {
        return Err(format!(
            "{} does not point to this binary; refusing to remove it",
            link.display()
        ));
    }
    std::fs::remove_file(link)
        .map_err(|e| format!("could not remove {}: {}", link.display(), e))
}

/// Remove the installed shortcut, for the GUI Settings page. Re-scans
/// afterwards so a second copy in another directory keeps being reported.
#[cfg(target_os = "macos")]
pub fn uninstall_from_gui() -> Result<CliInstallStatus, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not determine the running binary path: {}", e))?;
    if let Some(link) = find_link_in_dirs(&exe, &search_dirs()) {
        remove_symlink(&exe, &link)?;
    }
    Ok(install_status())
}

#[cfg(unix)]
pub(crate) fn install_symlink(exe: &Path, dir: &Path, force: bool) -> Result<PathBuf, String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create {}: {}", dir.display(), e))?;
    }

    let link = dir.join("tabularis");
    if let Ok(meta) = std::fs::symlink_metadata(&link) {
        let already_ours = meta.file_type().is_symlink()
            && std::fs::read_link(&link).map(|t| t == exe).unwrap_or(false);
        if already_ours {
            return Ok(link);
        }
        if !force {
            return Err(format!(
                "{} already exists (use --force to replace it)",
                link.display()
            ));
        }
        std::fs::remove_file(&link)
            .map_err(|e| format!("could not replace {}: {}", link.display(), e))?;
    }

    std::os::unix::fs::symlink(exe, &link)
        .map_err(|e| format!("could not create {}: {}", link.display(), e))?;
    Ok(link)
}

#[cfg(not(unix))]
pub fn run_install(_dir: Option<PathBuf>, _force: bool) -> Result<(), String> {
    Err("install-cli is not supported on this platform. \
         Add the directory containing tabularis.exe to your PATH instead."
        .to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn install_status() -> CliInstallStatus {
    CliInstallStatus {
        supported: false,
        installed: false,
        link_path: None,
        in_path: false,
        removable: false,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_from_gui(_force: bool) -> Result<CliInstallStatus, String> {
    Err("Managing the CLI shortcut from the app is only supported on macOS. \
         Use 'tabularis install-cli' from a terminal instead."
        .to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn uninstall_from_gui() -> Result<CliInstallStatus, String> {
    Err("Managing the CLI shortcut from the app is only supported on macOS.".to_string())
}
