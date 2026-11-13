use crate::application::linked_folder_git::{self, GitCommit, GitReview, GitStatus, ReviewedFile};
use crate::application::linked_folders::{
    self, LinkedDirectoryListing, LinkedFileContent, LinkedFileSaved, LinkedFolder,
    LinkedFolderStatus,
};
use crate::runtime::RuntimeContext;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tokio::task::spawn_blocking;

fn store<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    linked_folders::links_file_path(app.state::<RuntimeContext>().paths.config_dir())
}

#[tauri::command]
pub async fn linked_git_status<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<GitStatus, String> {
    let store = store(&app);
    blocking(move || linked_folder_git::status(&linked_folders::linked_git_root(&store, &id)?))
        .await
}

#[tauri::command]
pub async fn linked_git_review<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    relative_path: String,
) -> Result<GitReview, String> {
    let store = store(&app);
    blocking(move || {
        linked_folder_git::review(
            &linked_folders::linked_git_root(&store, &id)?,
            &relative_path,
        )
    })
    .await
}

#[tauri::command]
pub async fn linked_git_commit<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    files: Vec<ReviewedFile>,
    message: String,
) -> Result<GitCommit, String> {
    let store = store(&app);
    blocking(move || {
        linked_folder_git::commit(
            &linked_folders::linked_git_root(&store, &id)?,
            &files,
            &message,
        )
    })
    .await
}

async fn blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    spawn_blocking(task).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_linked_folders<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<LinkedFolderStatus>, String> {
    let store = store(&app);
    blocking(move || linked_folders::list_linked_folders(&store)).await
}

#[tauri::command]
pub async fn link_local_folder<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<LinkedFolder, String> {
    let store = store(&app);
    blocking(move || linked_folders::link_folder(&store, &path)).await
}

#[tauri::command]
pub async fn unlink_local_folder<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let store = store(&app);
    blocking(move || linked_folders::unlink_folder(&store, &id)).await
}

#[tauri::command]
pub async fn list_linked_directory<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    relative_path: String,
) -> Result<LinkedDirectoryListing, String> {
    let store = store(&app);
    blocking(move || linked_folders::list_linked_directory(&store, &id, &relative_path)).await
}

#[tauri::command]
pub async fn read_linked_sql_file<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    relative_path: String,
) -> Result<LinkedFileContent, String> {
    let store = store(&app);
    blocking(move || linked_folders::read_linked_sql_file(&store, &id, &relative_path)).await
}

#[tauri::command]
pub async fn write_linked_sql_file<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    relative_path: String,
    content: String,
    expected_version: Option<String>,
    overwrite: bool,
) -> Result<LinkedFileSaved, String> {
    let store = store(&app);
    blocking(move || {
        linked_folders::write_linked_sql_file(
            &store,
            &id,
            &relative_path,
            &content,
            expected_version.as_deref(),
            overwrite,
        )
    })
    .await
}
