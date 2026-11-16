use std::path::{Path, PathBuf};

const DEVELOPMENT_WEB_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../packages/web-ui/dist");

pub fn resolve_web_root(explicit_root: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(root) = explicit_root {
        return validate_web_root(root).map_err(|error| {
            format!("Invalid Web UI asset directory {}: {error}", root.display())
        });
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("Failed to locate the Tabularis executable: {error}"))?;
    let candidates = candidate_web_roots(&executable, Path::new(DEVELOPMENT_WEB_ROOT));

    for candidate in &candidates {
        if let Ok(root) = validate_web_root(candidate) {
            return Ok(root);
        }
    }

    let searched = candidates
        .iter()
        .map(|candidate| candidate.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Web UI assets were not found. Expected index.html in one of: {searched}. Build @tabularis/web-ui or pass --web-root."
    ))
}

pub(crate) fn candidate_web_roots(executable: &Path, development_root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(executable_dir) = executable.parent() {
        // Windows portable and installed bundles keep resources beside the binary.
        candidates.push(executable_dir.join("web-ui"));

        if let Some(installation_root) = executable_dir.parent() {
            // macOS: Tabularis.app/Contents/MacOS -> Contents/Resources/web-ui.
            candidates.push(installation_root.join("Resources/web-ui"));
            // Linux packages: /usr/bin -> /usr/lib/tabularis/web-ui.
            candidates.push(installation_root.join("lib/tabularis/web-ui"));
        }
    }

    candidates.push(development_root.to_path_buf());
    candidates.dedup();
    candidates
}

fn validate_web_root(root: &Path) -> Result<PathBuf, String> {
    if !root.is_dir() {
        return Err("the path is not a directory".to_string());
    }
    if !root.join("index.html").is_file() {
        return Err("index.html is missing".to_string());
    }

    root.canonicalize()
        .map_err(|error| format!("failed to resolve the directory: {error}"))
}
