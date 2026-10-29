use crate::ai::*;
use crate::credential_cache::CredentialCache;
use crate::runtime::RuntimeContext;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_ai_providers(app: AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<std::sync::Arc<crate::runtime::state::ApplicationState>>();
    crate::application::ai::execute(
        &app.state::<RuntimeContext>(),
        &state,
        None,
        crate::application::ai::AiCommand::GetProviders,
    )
    .await
}

#[tauri::command]
pub async fn migrate_ai_providers(app: AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<std::sync::Arc<crate::runtime::state::ApplicationState>>();
    crate::application::ai::execute(
        &app.state::<RuntimeContext>(),
        &state,
        None,
        crate::application::ai::AiCommand::MigrateProviders,
    )
    .await
}

#[tauri::command]
pub fn clear_ai_models_cache(app: AppHandle) -> Result<(), String> {
    clear_models_cache(&app.state::<RuntimeContext>())
}

#[tauri::command]
pub async fn get_ai_models(
    app: AppHandle,
    force_refresh: bool,
) -> Result<HashMap<String, Vec<String>>, String> {
    get_models(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        force_refresh,
    )
    .await
}

#[tauri::command]
pub async fn generate_ai_query(app: AppHandle, req: AiGenerateRequest) -> Result<String, String> {
    generate_query(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        req,
    )
    .await
}

#[tauri::command]
pub async fn explain_ai_query(app: AppHandle, req: AiExplainRequest) -> Result<String, String> {
    explain_query(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        req,
    )
    .await
}

#[tauri::command]
pub async fn analyze_ai_explain_plan(
    app: AppHandle,
    req: AiExplainRequest,
) -> Result<String, String> {
    analyze_explain_plan(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        req,
    )
    .await
}

#[tauri::command]
pub async fn generate_cell_name(app: AppHandle, req: AiCellNameRequest) -> Result<String, String> {
    generate_cellname(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        req,
    )
    .await
}

#[tauri::command]
pub async fn suggest_table_name(
    app: AppHandle,
    req: AiSuggestTableNameRequest,
) -> Result<String, String> {
    suggest_table_name_with_runtime(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        req,
    )
    .await
}

#[tauri::command]
pub async fn generate_tab_rename(
    app: AppHandle,
    req: AiTabRenameRequest,
) -> Result<String, String> {
    generate_tab_name(
        &app.state::<RuntimeContext>(),
        &app.state::<std::sync::Arc<CredentialCache>>(),
        req,
    )
    .await
}
