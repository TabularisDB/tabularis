//! Desktop entry points for local schema notes; the behaviour lives in
//! [`crate::application::schema_notes`], shared with the web RPC.

use crate::application::productivity::{self, ProductivityCommand};
use crate::schema_notes::SchemaNoteTarget;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

async fn execute<R: Runtime>(
    app: &AppHandle<R>,
    command: ProductivityCommand,
) -> Result<Value, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    productivity::execute(runtime.paths.config_dir(), command).await
}

#[tauri::command]
pub async fn get_schema_notes<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Value, String> {
    execute(&app, ProductivityCommand::GetSchemaNotes { connection_id }).await
}

#[tauri::command]
pub async fn set_schema_note<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    target: Option<SchemaNoteTarget>,
    domain: Option<String>,
    note: String,
) -> Result<Value, String> {
    execute(
        &app,
        ProductivityCommand::SetSchemaNote {
            connection_id,
            target,
            domain,
            note,
        },
    )
    .await
}

#[tauri::command]
pub async fn set_schema_notes_ai_context<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    enabled: bool,
) -> Result<Value, String> {
    execute(
        &app,
        ProductivityCommand::SetSchemaNotesAiContext {
            connection_id,
            enabled,
        },
    )
    .await
}

#[tauri::command]
pub async fn import_schema_notes<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    contents: String,
) -> Result<Value, String> {
    execute(
        &app,
        ProductivityCommand::ImportSchemaNotes {
            connection_id,
            contents,
        },
    )
    .await
}

#[tauri::command]
pub async fn export_schema_notes<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Value, String> {
    execute(
        &app,
        ProductivityCommand::ExportSchemaNotes { connection_id },
    )
    .await
}
