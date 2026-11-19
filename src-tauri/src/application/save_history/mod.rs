//! Recorded grid saves: opt-in capture of verified before/after values for
//! single-row updates, and a guarded restore of what a save changed.
//!
//! A restore is a new write, not a rollback: it only puts back the recorded
//! columns of one row, and only while the row still holds what the save
//! wrote. Triggers, external effects and other committed SQL are out of its
//! reach, so saves on tables with triggers are kept for review but are not
//! restorable.

mod model;
mod plan;
mod store;
mod target;

#[cfg(test)]
mod plan_tests;
#[cfg(test)]
mod store_tests;
#[cfg(test)]
mod target_tests;

pub use model::{
    NonRestorableReason, PlanStatus, RecordedColumn, RecordedSaveResponse, RestorePlan,
    RestorePlanColumn, SaveHistoryFile, SaveHistoryStatus, SaveRecord,
};
pub use plan::{
    build_record, evaluate_plan, evaluate_target_mismatch, prune, restore_columns, target_matches,
};
pub use store::remove_for_connection;
pub use target::target_fingerprint;

use crate::application::records;
use crate::drivers::driver_trait::DatabaseDriver;
use crate::drivers::recorded_save::{RecordedCapture, RestoreOutcome};
use crate::models::{ConnectionParams, DatabaseSelection};
use crate::runtime::RuntimeContext;
use chrono::Utc;
use model::{SKIPPED_RECORDING_DISABLED, SKIPPED_STORAGE_ERROR, SKIPPED_UNCHANGED};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug)]
pub enum SaveHistoryCommand {
    SaveRow {
        connection_id: String,
        table: String,
        pk_map: HashMap<String, Value>,
        changes: HashMap<String, Value>,
        schema: Option<String>,
        database: Option<String>,
    },
    Status {
        connection_id: String,
    },
    SetEnabled {
        connection_id: String,
        enabled: bool,
    },
    List {
        connection_id: String,
        table: Option<String>,
        schema: Option<String>,
        database: Option<String>,
    },
    PlanRestore {
        connection_id: String,
        record_id: String,
    },
    ApplyRestore {
        connection_id: String,
        record_id: String,
    },
    Delete {
        connection_id: String,
        record_id: Option<String>,
    },
}

pub async fn execute(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    command: SaveHistoryCommand,
) -> Result<Value, String> {
    let value = match command {
        SaveHistoryCommand::SaveRow {
            connection_id,
            table,
            pk_map,
            changes,
            schema,
            database,
        } => serde_json::to_value(
            save_row(
                runtime,
                session_id,
                &connection_id,
                table,
                pk_map,
                changes,
                schema,
                database,
            )
            .await?,
        ),
        SaveHistoryCommand::Status { connection_id } => {
            serde_json::to_value(status(runtime, session_id, &connection_id).await?)
        }
        SaveHistoryCommand::SetEnabled {
            connection_id,
            enabled,
        } => serde_json::to_value(set_enabled(runtime, session_id, &connection_id, enabled).await?),
        SaveHistoryCommand::List {
            connection_id,
            table,
            schema,
            database,
        } => serde_json::to_value(list(runtime, &connection_id, table, schema, database)?),
        SaveHistoryCommand::PlanRestore {
            connection_id,
            record_id,
        } => serde_json::to_value(
            plan_restore(runtime, session_id, &connection_id, &record_id).await?,
        ),
        SaveHistoryCommand::ApplyRestore {
            connection_id,
            record_id,
        } => serde_json::to_value(
            apply_restore(runtime, session_id, &connection_id, &record_id).await?,
        ),
        SaveHistoryCommand::Delete {
            connection_id,
            record_id,
        } => serde_json::to_value(delete(runtime, &connection_id, record_id.as_deref())?),
    };
    value.map_err(|error| error.to_string())
}

/// Fingerprint of the server the saved connection points at right now.
fn current_target(runtime: &RuntimeContext, connection_id: &str) -> Result<String, String> {
    let saved =
        crate::application::connections::load_connections(&runtime.paths.connections_file())?
            .into_iter()
            .find(|connection| connection.id == connection_id)
            .ok_or_else(|| "Connection not found".to_string())?;
    let expanded = target::expand_target(runtime, &saved.params)?;
    Ok(target_fingerprint(&expanded))
}

async fn connect(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    database: Option<&str>,
) -> Result<(Arc<dyn DatabaseDriver>, ConnectionParams), String> {
    let (_driver_id, mut params) =
        crate::application::connections::resolve_saved_connection_params(
            runtime,
            session_id,
            connection_id,
        )?;
    if let Some(database) = database {
        params.database = DatabaseSelection::Single(database.to_string());
    }
    let driver = crate::drivers::registry::get_connection_driver(&params).await?;
    Ok((driver, params))
}

pub async fn status(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<SaveHistoryStatus, String> {
    let (driver, _params) = connect(runtime, session_id, connection_id, None).await?;
    Ok(SaveHistoryStatus {
        supported: driver.supports_recorded_saves(),
        enabled: store::is_enabled(runtime.paths.data_dir(), connection_id)?,
    })
}

pub async fn set_enabled(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    enabled: bool,
) -> Result<SaveHistoryStatus, String> {
    let (driver, _params) = connect(runtime, session_id, connection_id, None).await?;
    let supported = driver.supports_recorded_saves();
    if enabled && !supported {
        return Err("This connection's driver cannot record saves".to_string());
    }
    store::update(runtime.paths.data_dir(), connection_id, |file| {
        file.enabled = enabled;
        Ok(())
    })?;
    Ok(SaveHistoryStatus { supported, enabled })
}

/// Saves the changes to one row and, when recording is on and the target
/// qualifies, keeps the verified before/after values. Anything that stops the
/// recording never undoes or fails the save itself.
#[allow(clippy::too_many_arguments)]
pub async fn save_row(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    table: String,
    pk_map: HashMap<String, Value>,
    changes: HashMap<String, Value>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<RecordedSaveResponse, String> {
    let data_dir = runtime.paths.data_dir();
    let enabled = store::is_enabled(data_dir, connection_id).unwrap_or(false);
    let (driver, params) = connect(runtime, session_id, connection_id, database.as_deref()).await?;
    if !enabled || !driver.supports_recorded_saves() {
        let mut affected = 0;
        let mut ordered: Vec<(String, Value)> = changes.into_iter().collect();
        ordered.sort_by(|a, b| a.0.cmp(&b.0));
        for (col_name, new_val) in ordered {
            affected += records::update_record(
                runtime,
                session_id,
                connection_id,
                table.clone(),
                pk_map.clone(),
                col_name,
                new_val,
                schema.clone(),
                database.clone(),
            )
            .await?;
        }
        return Ok(RecordedSaveResponse {
            affected,
            record_id: None,
            skipped_reason: Some(SKIPPED_RECORDING_DISABLED.to_string()),
        });
    }

    let recorded = records::update_row_recorded(
        runtime,
        session_id,
        connection_id,
        driver.as_ref(),
        &params,
        &table,
        &pk_map,
        changes,
        schema.as_deref(),
    )
    .await?;

    let capture = match recorded.capture {
        RecordedCapture::Captured(capture) => capture,
        RecordedCapture::Skipped { reason } => {
            return Ok(RecordedSaveResponse {
                affected: recorded.affected,
                record_id: None,
                skipped_reason: Some(reason),
            })
        }
    };
    let key: BTreeMap<String, Value> = pk_map.into_iter().collect();
    // Pin the database the write went to, so a later change of the
    // connection's selected database cannot redirect a restore.
    let database = match &params.database {
        DatabaseSelection::Single(name) if !name.is_empty() => Some(name.clone()),
        _ => database,
    };
    let record = match current_target(runtime, connection_id) {
        Ok(target) => build_record(
            Uuid::new_v4().to_string(),
            Utc::now().to_rfc3339(),
            database,
            schema,
            table,
            target,
            key,
            capture,
        ),
        Err(error) => {
            log::warn!("The save on connection {connection_id} was not recorded: {error}");
            return Ok(RecordedSaveResponse {
                affected: recorded.affected,
                record_id: None,
                skipped_reason: Some(SKIPPED_STORAGE_ERROR.to_string()),
            });
        }
    };
    let Some(record) = record else {
        return Ok(RecordedSaveResponse {
            affected: recorded.affected,
            record_id: None,
            skipped_reason: Some(SKIPPED_UNCHANGED.to_string()),
        });
    };
    let record_id = record.id.clone();
    match store::append(data_dir, connection_id, record) {
        Ok(()) => Ok(RecordedSaveResponse {
            affected: recorded.affected,
            record_id: Some(record_id),
            skipped_reason: None,
        }),
        Err(error) => {
            log::warn!("The save on connection {connection_id} was not recorded: {error}");
            Ok(RecordedSaveResponse {
                affected: recorded.affected,
                record_id: None,
                skipped_reason: Some(SKIPPED_STORAGE_ERROR.to_string()),
            })
        }
    }
}

/// Newest first.
pub fn list(
    runtime: &RuntimeContext,
    connection_id: &str,
    table: Option<String>,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Vec<SaveRecord>, String> {
    let mut records = store::load(runtime.paths.data_dir(), connection_id)?.records;
    records.retain(|record| {
        table.as_ref().map_or(true, |table| &record.table == table)
            && (schema.is_none() || record.schema == schema)
            && (database.is_none() || record.database == database)
    });
    records.reverse();
    Ok(records)
}

pub fn delete(
    runtime: &RuntimeContext,
    connection_id: &str,
    record_id: Option<&str>,
) -> Result<usize, String> {
    store::delete(runtime.paths.data_dir(), connection_id, record_id)
}

fn find_record(
    runtime: &RuntimeContext,
    connection_id: &str,
    record_id: &str,
) -> Result<SaveRecord, String> {
    store::load(runtime.paths.data_dir(), connection_id)?
        .records
        .into_iter()
        .find(|record| record.id == record_id)
        .ok_or_else(|| "The recorded save no longer exists".to_string())
}

fn pk_map_of(record: &SaveRecord) -> HashMap<String, Value> {
    record.key.clone().into_iter().collect()
}

/// Re-reads the row and compares it with the recorded save. Writes nothing.
pub async fn plan_restore(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    record_id: &str,
) -> Result<RestorePlan, String> {
    let record = find_record(runtime, connection_id, record_id)?;
    if !record.restorable || record.restored_at.is_some() {
        return Ok(evaluate_plan(&record, None));
    }
    if !target_matches(&record, &current_target(runtime, connection_id)?) {
        return Ok(evaluate_target_mismatch(&record));
    }
    let (driver, params) = connect(
        runtime,
        session_id,
        connection_id,
        record.database.as_deref(),
    )
    .await?;
    let names: Vec<String> = record.columns.iter().map(|c| c.name.clone()).collect();
    let current = driver
        .read_row_images(
            &params,
            &record.table,
            &pk_map_of(&record),
            &names,
            record.schema.as_deref(),
        )
        .await?;
    Ok(evaluate_plan(&record, current.as_deref()))
}

/// Restores the recorded columns of one row. The driver locks the row,
/// compares it with what the save wrote and only then writes, in one
/// transaction; a changed or missing row is refused and reported.
pub async fn apply_restore(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    connection_id: &str,
    record_id: &str,
) -> Result<RestorePlan, String> {
    crate::application::read_only::ensure_writable(runtime, connection_id)?;
    let record = find_record(runtime, connection_id, record_id)?;
    if !record.restorable || record.restored_at.is_some() {
        return Ok(evaluate_plan(&record, None));
    }
    if !target_matches(&record, &current_target(runtime, connection_id)?) {
        return Ok(evaluate_target_mismatch(&record));
    }
    log::info!(
        "Restoring a recorded save on connection {} in table {}",
        connection_id,
        record.table
    );
    let (driver, params) = connect(
        runtime,
        session_id,
        connection_id,
        record.database.as_deref(),
    )
    .await?;
    let outcome = driver
        .restore_row_images(
            &params,
            &record.table,
            &pk_map_of(&record),
            &restore_columns(&record),
            record.schema.as_deref(),
        )
        .await?;
    match outcome {
        RestoreOutcome::Restored { .. } => {
            let restored_at = Utc::now().to_rfc3339();
            let marked = store::update(runtime.paths.data_dir(), connection_id, |file| {
                if let Some(stored) = file.records.iter_mut().find(|r| r.id == record.id) {
                    stored.restored_at = Some(restored_at.clone());
                }
                Ok(())
            });
            if let Err(error) = marked {
                log::warn!("A restored save could not be marked as restored: {error}");
            }
            let mut restored = record;
            restored.restored_at = Some(restored_at);
            let mut plan = evaluate_plan(&restored, None);
            plan.status = PlanStatus::Restored;
            Ok(plan)
        }
        RestoreOutcome::RowMissing => Ok(evaluate_plan(&record, None)),
        RestoreOutcome::Conflict { current } => Ok(evaluate_plan(&record, Some(&current))),
    }
}
