#[tauri::command]
pub async fn create_sqlite_file(path: String) -> Result<String, String> {
    crate::sqlite_database::create_sqlite_file(path).await
}
