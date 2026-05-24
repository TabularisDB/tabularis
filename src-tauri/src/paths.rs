use directories::ProjectDirs;
use std::path::PathBuf;

pub fn get_app_config_dir() -> PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("", "", "tabularis") {

        #[cfg(target_os = "windows")]
        {
            proj_dirs.config_dir().parent().unwrap().to_path_buf()
        }
        #[cfg(not(target_os = "windows"))]
        {
            proj_dirs.config_dir().to_path_buf()
        }
    } else {
        // Fallback for weird environments
        PathBuf::from(".config/tabularis")
    }
}
