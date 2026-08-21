use crate::models::SavedConnection;
use std::path::Path;

pub fn load_connections(path: &Path) -> Result<Vec<SavedConnection>, String> {
    crate::persistence::load_connections(path)
}
