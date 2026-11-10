#[tauri::command]
pub async fn read_sql_file(path: String) -> Result<String, String> {
    crate::sql_file::read_sql_file(path).await
}

#[tauri::command]
pub async fn write_sql_file(path: String, content: String) -> Result<(), String> {
    crate::sql_file::write_sql_file(path, content).await
}
