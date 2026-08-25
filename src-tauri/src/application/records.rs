use super::file_transfers::{ClaimedUpload, FileTransferStore};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::DatabaseSelection;
use crate::runtime::RuntimeContext;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

pub const MAX_WEB_BLOB_BYTES: u64 = crate::drivers::common::DEFAULT_MAX_BLOB_SIZE;
const UPLOAD_PREFIX: &str = "BLOB_UPLOAD_REF:";
const BLOB_TRANSFER_PURPOSE: &str = "blob";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlobFetchPolicy {
    Inline,
    DownloadToken { session_id: Uuid },
}

#[derive(Debug)]
pub enum RecordCommand {
    Delete {
        connection_id: String,
        table: String,
        pk_map: HashMap<String, Value>,
        schema: Option<String>,
        database: Option<String>,
    },
    Update {
        connection_id: String,
        table: String,
        pk_map: HashMap<String, Value>,
        col_name: String,
        new_val: Value,
        schema: Option<String>,
        database: Option<String>,
    },
    Insert {
        connection_id: String,
        table: String,
        data: HashMap<String, Value>,
        schema: Option<String>,
        database: Option<String>,
    },
    FetchBlob {
        connection_id: String,
        table: String,
        col_name: String,
        pk_map: HashMap<String, Value>,
        schema: Option<String>,
        database: Option<String>,
    },
    DetectBlobMime {
        base64_data: String,
    },
    DetectMimeType {
        header_base64: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BlobFetchResponse {
    Inline {
        wire_value: String,
    },
    Download {
        token: String,
        size: u64,
        mime_type: String,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    command: RecordCommand,
) -> Result<Value, String> {
    let result = match command {
        RecordCommand::Delete {
            connection_id,
            table,
            pk_map,
            schema,
            database,
        } => serde_json::to_value(
            delete_record(
                runtime,
                session_id,
                &connection_id,
                table,
                pk_map,
                schema,
                database,
            )
            .await?,
        ),
        RecordCommand::Update {
            connection_id,
            table,
            pk_map,
            col_name,
            new_val,
            schema,
            database,
        } => serde_json::to_value(
            update_record(
                runtime,
                session_id,
                &connection_id,
                table,
                pk_map,
                col_name,
                new_val,
                schema,
                database,
            )
            .await?,
        ),
        RecordCommand::Insert {
            connection_id,
            table,
            data,
            schema,
            database,
        } => serde_json::to_value(
            insert_record(
                runtime,
                session_id,
                &connection_id,
                table,
                data,
                schema,
                database,
            )
            .await?,
        ),
        RecordCommand::FetchBlob {
            connection_id,
            table,
            col_name,
            pk_map,
            schema,
            database,
        } => {
            let session_id = session_id.ok_or_else(|| {
                "An authenticated browser session is required for tokenized BLOB downloads"
                    .to_string()
            })?;
            serde_json::to_value(
                fetch_blob(
                    runtime,
                    Some(session_id),
                    &connection_id,
                    table,
                    col_name,
                    pk_map,
                    schema,
                    database,
                    BlobFetchPolicy::DownloadToken { session_id },
                )
                .await?,
            )
        }
        RecordCommand::DetectBlobMime { base64_data } => {
            serde_json::to_value(detect_blob_mime(&base64_data)?)
        }
        RecordCommand::DetectMimeType { header_base64 } => {
            serde_json::to_value(detect_mime_type(&header_base64)?)
        }
    };
    result.map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
pub async fn delete_record(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    pk_map: HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    log::info!(
        "Deleting a record on connection {} from table {}",
        connection_id,
        table
    );
    reject_server_file_refs(session_id, pk_map.values())?;
    let (driver_id, mut params) = crate::application::connections::resolve_saved_connection_params(
        runtime,
        session_id,
        connection_id,
    )?;
    apply_database(&mut params.database, database);
    driver_for(&driver_id)
        .await?
        .delete_record(&params, &table, &pk_map, schema.as_deref())
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_record(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    pk_map: HashMap<String, Value>,
    col_name: String,
    mut new_val: Value,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    log::info!(
        "Updating column {} on connection {} in table {}",
        col_name,
        connection_id,
        table
    );
    let max_blob_size = max_blob_size(runtime);
    reject_server_file_refs(session_id, pk_map.values())?;
    let upload = resolve_upload_value(
        runtime.paths.data_dir(),
        session_id,
        &mut new_val,
        max_blob_size,
    )?;
    let (driver_id, mut params) = crate::application::connections::resolve_saved_connection_params(
        runtime,
        session_id,
        connection_id,
    )?;
    apply_database(&mut params.database, database);
    let result = driver_for(&driver_id)
        .await?
        .update_record(
            &params,
            &table,
            &pk_map,
            &col_name,
            new_val,
            schema.as_deref(),
            max_blob_size,
        )
        .await;
    drop(upload);
    result
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_record(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    mut data: HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<u64, String> {
    log::info!(
        "Inserting a record on connection {} into table {}",
        connection_id,
        table
    );
    let max_blob_size = max_blob_size(runtime);
    let mut uploads = Vec::new();
    for value in data.values_mut() {
        if let Some(upload) =
            resolve_upload_value(runtime.paths.data_dir(), session_id, value, max_blob_size)?
        {
            uploads.push(upload);
        }
    }
    let (driver_id, mut params) = crate::application::connections::resolve_saved_connection_params(
        runtime,
        session_id,
        connection_id,
    )?;
    apply_database(&mut params.database, database);
    let result = driver_for(&driver_id)
        .await?
        .insert_record(&params, &table, data, schema.as_deref(), max_blob_size)
        .await;
    drop(uploads);
    result
}

#[allow(clippy::too_many_arguments)]
pub async fn fetch_blob(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    col_name: String,
    pk_map: HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
    policy: BlobFetchPolicy,
) -> Result<BlobFetchResponse, String> {
    reject_server_file_refs(session_id, pk_map.values())?;
    let (driver_id, mut params) = crate::application::connections::resolve_saved_connection_params(
        runtime,
        session_id,
        connection_id,
    )?;
    apply_database(&mut params.database, database);
    let wire_value = driver_for(&driver_id)
        .await?
        .fetch_blob_as_data_url(&params, &table, &col_name, &pk_map, schema.as_deref())
        .await?;

    match policy {
        BlobFetchPolicy::Inline => Ok(BlobFetchResponse::Inline { wire_value }),
        BlobFetchPolicy::DownloadToken { session_id } => {
            let max_size = max_blob_size(runtime).min(MAX_WEB_BLOB_BYTES);
            let bytes = crate::drivers::common::decode_blob_wire_format(&wire_value, max_size)
                .ok_or_else(|| "Invalid BLOB wire format".to_string())?;
            if bytes.len() as u64 > max_size {
                return Err(format!(
                    "BLOB size {} exceeds the maximum web download size of {} bytes",
                    bytes.len(),
                    max_size
                ));
            }
            let mime_type =
                blob_wire_mime(&wire_value).unwrap_or_else(|| detect_mime(&bytes).to_string());
            let metadata = FileTransferStore::new(runtime.paths.data_dir())
                .store_download_bytes(
                    session_id,
                    BLOB_TRANSFER_PURPOSE,
                    "blob-download.bin",
                    Some(&mime_type),
                    bytes,
                )
                .await?;
            Ok(BlobFetchResponse::Download {
                token: metadata.token,
                size: metadata.size,
                mime_type: metadata.mime_type,
            })
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn fetch_blob_as_data_url(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    col_name: String,
    pk_map: HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<String, String> {
    let BlobFetchResponse::Inline { wire_value } = fetch_blob(
        runtime,
        session_id,
        connection_id,
        table,
        col_name,
        pk_map,
        schema,
        database,
        BlobFetchPolicy::Inline,
    )
    .await?
    else {
        unreachable!("inline fetch policy always returns an inline value")
    };
    let mime = blob_wire_mime(&wire_value).ok_or_else(|| "Invalid BLOB wire format".to_string())?;
    if !mime.starts_with("image/") {
        return Err(format!("Not an image: {mime}"));
    }
    let payload = wire_value
        .rsplit_once(':')
        .map(|(_, payload)| payload)
        .ok_or_else(|| "Invalid BLOB wire format".to_string())?;
    Ok(format!("data:{mime};base64,{payload}"))
}

pub fn detect_blob_mime(base64_data: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|error| format!("Invalid base64: {error}"))?;
    if bytes.len() as u64 > MAX_WEB_BLOB_BYTES {
        return Err("BLOB payload exceeds the maximum allowed size".to_string());
    }
    Ok(crate::drivers::common::encode_blob_full(&bytes))
}

pub fn detect_mime_type(header_base64: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(header_base64)
        .map_err(|error| format!("Invalid base64: {error}"))?;
    if bytes.len() > 8192 {
        return Err("MIME detection headers cannot exceed 8192 bytes".to_string());
    }
    Ok(detect_mime(&bytes).to_string())
}

async fn driver_for(driver_id: &str) -> Result<std::sync::Arc<dyn DatabaseDriver>, String> {
    crate::drivers::registry::get_driver(driver_id)
        .await
        .ok_or_else(|| format!("Unsupported driver: {driver_id}"))
}

fn apply_database(selection: &mut DatabaseSelection, database: Option<String>) {
    if let Some(database) = database {
        *selection = DatabaseSelection::Single(database);
    }
}

fn max_blob_size(runtime: &RuntimeContext) -> u64 {
    fs::read_to_string(runtime.paths.config_dir().join("config.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<crate::config::AppConfig>(&content).ok())
        .and_then(|config| config.max_blob_size)
        .unwrap_or(crate::drivers::common::DEFAULT_MAX_BLOB_SIZE)
}

fn reject_server_file_refs<'a>(
    session_id: Option<Uuid>,
    values: impl Iterator<Item = &'a Value>,
) -> Result<(), String> {
    if session_id.is_some()
        && values
            .filter_map(Value::as_str)
            .any(|value| value.starts_with("BLOB_FILE_REF:"))
    {
        return Err("Browser record values cannot contain server file paths".to_string());
    }
    Ok(())
}

fn resolve_upload_value(
    data_dir: &Path,
    session_id: Option<Uuid>,
    value: &mut Value,
    max_size: u64,
) -> Result<Option<ClaimedUpload>, String> {
    let Some(reference) = value.as_str() else {
        return Ok(None);
    };
    if session_id.is_some() && reference.starts_with("BLOB_FILE_REF:") {
        return Err("Browser record values cannot contain server file paths".to_string());
    }
    if !reference.starts_with(UPLOAD_PREFIX) {
        return Ok(None);
    }
    let session_id = session_id.ok_or_else(|| {
        "Browser BLOB upload references require an authenticated session".to_string()
    })?;
    let (claimed_size, _claimed_mime, token) = parse_upload_reference(reference)?;
    let upload =
        FileTransferStore::new(data_dir).claim_upload(session_id, token, BLOB_TRANSFER_PURPOSE)?;
    if upload.metadata().size != claimed_size {
        return Err("BLOB upload metadata does not match the uploaded file".to_string());
    }
    if upload.metadata().size > max_size {
        return Err(format!(
            "BLOB size {} exceeds the configured maximum of {} bytes",
            upload.metadata().size,
            max_size
        ));
    }
    *value = Value::String(format!(
        "BLOB_FILE_REF:{}:{}:{}",
        upload.metadata().size,
        upload.metadata().mime_type,
        upload.path().display()
    ));
    Ok(Some(upload))
}

fn parse_upload_reference(reference: &str) -> Result<(u64, &str, &str), String> {
    let suffix = reference
        .strip_prefix(UPLOAD_PREFIX)
        .ok_or_else(|| "Invalid BLOB upload reference".to_string())?;
    let mut fields = suffix.splitn(3, ':');
    let size = fields
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "Invalid BLOB upload size".to_string())?;
    let mime = fields
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Invalid BLOB upload MIME type".to_string())?;
    let token = fields
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Invalid BLOB upload token".to_string())?;
    validate_token(token)?;
    Ok((size, mime, token))
}

fn blob_wire_mime(wire_value: &str) -> Option<String> {
    let suffix = wire_value.strip_prefix("BLOB:")?;
    let (_, suffix) = suffix.split_once(':')?;
    let (mime, _) = suffix.split_once(':')?;
    (!mime.is_empty()).then(|| mime.to_string())
}

fn detect_mime(bytes: &[u8]) -> &str {
    infer::get(bytes)
        .map(|kind| kind.mime_type())
        .unwrap_or("application/octet-stream")
}

fn validate_token(token: &str) -> Result<(), String> {
    match Uuid::parse_str(token) {
        Ok(parsed) if parsed.get_version_num() == 4 => Ok(()),
        _ => Err("Invalid BLOB transfer token".to_string()),
    }
}

#[cfg(test)]
#[path = "records_tests.rs"]
mod tests;
