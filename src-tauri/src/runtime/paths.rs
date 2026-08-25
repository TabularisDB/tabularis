use std::path::{Path, PathBuf};

pub trait RuntimePaths: Send + Sync {
    fn config_dir(&self) -> &Path;
    fn data_dir(&self) -> &Path;

    fn plugins_dir(&self) -> PathBuf {
        self.data_dir().join("plugins")
    }

    fn connections_file(&self) -> PathBuf {
        crate::paths::resolve_connections_path(self.config_dir())
    }
}

#[derive(Clone, Debug)]
pub struct FixedRuntimePaths {
    config_dir: PathBuf,
    data_dir: PathBuf,
}

impl FixedRuntimePaths {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            config_dir,
            data_dir,
        }
    }

    pub fn system() -> Self {
        Self::new(
            crate::paths::get_app_config_dir(),
            crate::paths::get_app_data_dir(),
        )
    }
}

impl RuntimePaths for FixedRuntimePaths {
    fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}
