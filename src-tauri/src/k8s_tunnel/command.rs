use directories::BaseDirs;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const DEFAULT_KUBECTL: &str = "kubectl";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) enum KubectlSelection {
    Default,
    Explicit(OsString),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) enum KubeconfigSelection {
    Default,
    Inherited(OsString),
    Explicit(OsString),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct K8sCommandOptions {
    kubectl_path: Option<PathBuf>,
    kubeconfig_path: Option<PathBuf>,
}

impl K8sCommandOptions {
    pub fn new(kubectl_path: Option<String>, kubeconfig_path: Option<String>) -> Self {
        Self {
            kubectl_path: normalized_path_option(kubectl_path.as_deref()),
            kubeconfig_path: normalized_path_option(kubeconfig_path.as_deref()),
        }
    }

    pub(super) fn kubectl_program(&self) -> &OsStr {
        self.kubectl_path
            .as_deref()
            .map(Path::as_os_str)
            .unwrap_or_else(|| OsStr::new(DEFAULT_KUBECTL))
    }

    pub(super) fn kubectl_label(&self) -> String {
        self.kubectl_program().to_string_lossy().into_owned()
    }

    pub(super) fn kubectl_selection(&self) -> KubectlSelection {
        self.kubectl_path
            .as_ref()
            .map(|path| KubectlSelection::Explicit(path.as_os_str().to_os_string()))
            .unwrap_or(KubectlSelection::Default)
    }

    pub(super) fn explicit_kubectl_path(&self) -> Option<&Path> {
        self.kubectl_path.as_deref()
    }

    pub(super) fn explicit_kubeconfig_path(&self) -> Option<&Path> {
        self.kubeconfig_path.as_deref()
    }

    pub(super) fn kubeconfig_selection(&self) -> KubeconfigSelection {
        self.kubeconfig_selection_with(env::var_os("KUBECONFIG"))
    }

    fn kubeconfig_selection_with(&self, inherited: Option<OsString>) -> KubeconfigSelection {
        if let Some(path) = &self.kubeconfig_path {
            return KubeconfigSelection::Explicit(path.as_os_str().to_os_string());
        }

        inherited
            .map(KubeconfigSelection::Inherited)
            .unwrap_or(KubeconfigSelection::Default)
    }

    #[cfg(test)]
    pub(super) fn inherited_kubeconfig_selection_for_test(
        &self,
        value: OsString,
    ) -> KubeconfigSelection {
        self.kubeconfig_selection_with(Some(value))
    }
}

pub(super) fn kubectl_command(options: &K8sCommandOptions) -> Command {
    let mut command = Command::new(options.kubectl_program());
    if let Some(kubeconfig_path) = options.explicit_kubeconfig_path() {
        command.env("KUBECONFIG", kubeconfig_path);
    }
    command
}

pub(super) fn run_kubectl(
    args: &[&str],
    options: &K8sCommandOptions,
    failure_context: &str,
) -> Result<Output, String> {
    let output = kubectl_command(options)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| kubectl_spawn_error(options, &error))?;

    if output.status.success() {
        return Ok(output);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    if stderr.is_empty() {
        Err(format!(
            "{}: kubectl exited with status {}",
            failure_context, output.status
        ))
    } else {
        Err(format!("{}: {}", failure_context, stderr))
    }
}

pub(super) fn kubectl_spawn_error(options: &K8sCommandOptions, error: &std::io::Error) -> String {
    match options.explicit_kubectl_path() {
        Some(path) => format!(
            "Failed to launch configured kubectl executable '{}': {}. Verify the kubectl path.",
            path.display(),
            error
        ),
        None => format!(
            "Failed to launch kubectl: {}. Install kubectl and ensure it is available in PATH.",
            error
        ),
    }
}

pub fn validate_k8s_path(path: &str, kind: &str) -> Result<(), String> {
    match kind {
        "kubectl" => validate_kubectl_path(path),
        "kubeconfig" => validate_kubeconfig_path(path),
        other => Err(format!(
            "Unsupported Kubernetes path validation kind '{}'. Expected 'kubectl' or 'kubeconfig'.",
            other
        )),
    }
}

fn validate_kubectl_path(value: &str) -> Result<(), String> {
    let Some(path) = normalized_path(value) else {
        return Ok(());
    };

    if is_bare_executable_name(&path) {
        let resolved = which::which(&path).map_err(|_| {
            format!(
                "kubectl executable '{}' was not found in PATH or is not executable.",
                path.display()
            )
        })?;
        let metadata = fs::metadata(&resolved).map_err(|error| {
            format!(
                "Failed to inspect kubectl executable '{}': {}",
                resolved.display(),
                error
            )
        })?;
        if !metadata.is_file() {
            return Err(format!(
                "kubectl path must point to an executable file: {}",
                resolved.display()
            ));
        }
        return Ok(());
    }

    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "kubectl executable was not found at '{}': {}",
            path.display(),
            error
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "kubectl path must point to an executable file: {}",
            path.display()
        ));
    }

    which::which(&path)
        .map_err(|_| format!("kubectl path is not executable: {}", path.display()))?;
    Ok(())
}

fn validate_kubeconfig_path(value: &str) -> Result<(), String> {
    let Some(path) = normalized_path(value) else {
        return Ok(());
    };

    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "Kubeconfig file was not found at '{}': {}",
            path.display(),
            error
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "Kubeconfig path must point to a file: {}",
            path.display()
        ));
    }

    Ok(())
}

fn is_bare_executable_name(path: &Path) -> bool {
    !path.is_absolute() && path.components().count() == 1
}

fn normalized_path_option(value: Option<&str>) -> Option<PathBuf> {
    value.and_then(normalized_path)
}

fn normalized_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(expand_home_path(value))
    }
}

fn expand_home_path(value: &str) -> PathBuf {
    let home_relative = if value == "~" {
        Some("")
    } else {
        value
            .strip_prefix("~/")
            .or_else(|| value.strip_prefix("~\\"))
    };

    match (home_relative, BaseDirs::new()) {
        (Some(relative), Some(base_dirs)) => base_dirs.home_dir().join(relative),
        _ => PathBuf::from(value),
    }
}
