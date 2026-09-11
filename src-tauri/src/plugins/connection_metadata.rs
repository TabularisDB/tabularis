use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, OnceCell};

use crate::drivers::driver_trait::{DriverCapabilities, PluginManifest, SqlDialect};
use crate::models::{ConnectionParams, DataTypeInfo};

/// Adds discovery support to the single-driver command without changing the
/// serialized manifest of static drivers or the registered manifest itself.
#[derive(Serialize)]
pub struct DriverManifestDetails {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_metadata: Option<bool>,
}

/// The UI invalidates only discovery-enabled contexts. Emitting for every
/// replacement also covers an update that removes a plugin's discovery opt-in.
pub async fn notify_plugin_reload<R: tauri::Runtime>(app: &tauri::AppHandle<R>, driver_id: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "connection-metadata-invalidated",
        serde_json::json!({"driverId": driver_id}),
    );
}

/// Only connection-dependent fields belong here. Connection-form fields and
/// plugin identity always come from the installed manifest.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectionCapabilityOverrides {
    pub schemas: Option<bool>,
    pub views: Option<bool>,
    pub materialized_views: Option<bool>,
    pub routines: Option<bool>,
    pub triggers: Option<bool>,
    pub user_management: Option<bool>,
    pub routine_management: Option<bool>,
    pub identifier_quote: Option<String>,
    pub sql_dialect: Option<SqlDialect>,
    pub alter_primary_key: Option<bool>,
    pub alter_column: Option<bool>,
    pub create_foreign_keys: Option<bool>,
    pub manage_tables: Option<bool>,
    pub readonly: Option<bool>,
    pub explain: Option<bool>,
    pub auto_increment_keyword: Option<String>,
    pub serial_type: Option<String>,
    pub inline_pk: Option<bool>,
}

impl ConnectionCapabilityOverrides {
    pub fn apply(&self, base: &DriverCapabilities) -> Result<DriverCapabilities, String> {
        let mut result = base.clone();
        macro_rules! apply {
            ($($field:ident),+ $(,)?) => { $(
                if let Some(value) = &self.$field {
                    result.$field = value.clone();
                }
            )+ };
        }
        apply!(
            schemas,
            views,
            materialized_views,
            routines,
            triggers,
            user_management,
            routine_management,
            identifier_quote,
            alter_primary_key,
            alter_column,
            create_foreign_keys,
            manage_tables,
            explain,
            auto_increment_keyword,
            serial_type,
            inline_pk
        );
        if let Some(dialect) = self.sql_dialect {
            result.sql_dialect = Some(dialect);
        }
        // Discovery cannot lift a manifest-level read-only restriction.
        result.readonly = base.readonly || self.readonly.unwrap_or(false);
        if let Some(quote) = &self.identifier_quote {
            if !matches!(quote.as_str(), "\"" | "`") {
                return Err(
                    "connection metadata identifier_quote must be a double quote or backtick"
                        .into(),
                );
            }
        }
        Ok(result)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectionMetadataOverrides {
    #[serde(default)]
    pub capabilities: ConnectionCapabilityOverrides,
    pub data_types: Option<Vec<DataTypeInfo>>,
    pub type_mappings: Option<HashMap<String, String>>,
}

/// A connection-local snapshot. Never inserted into the driver registry.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionMetadata {
    pub capabilities: DriverCapabilities,
    pub data_types: Vec<DataTypeInfo>,
    pub type_mappings: HashMap<String, String>,
}

impl ConnectionMetadataOverrides {
    pub fn resolve(
        &self,
        manifest: &PluginManifest,
        data_types: &[DataTypeInfo],
    ) -> Result<ConnectionMetadata, String> {
        let types = self.data_types.as_deref().unwrap_or(data_types);
        if self.data_types.is_some() {
            for ty in types {
                if ty.name.trim().is_empty()
                    || !matches!(
                        ty.category.as_str(),
                        "numeric" | "string" | "date" | "binary" | "json" | "spatial" | "other"
                    )
                {
                    return Err(
                        "connection metadata contains an invalid data type name or category".into(),
                    );
                }
            }
        }
        Ok(ConnectionMetadata {
            capabilities: self.capabilities.apply(&manifest.capabilities)?,
            data_types: types.to_vec(),
            type_mappings: self
                .type_mappings
                .clone()
                .unwrap_or_else(|| manifest.type_mappings.clone()),
        })
    }
}

type MetadataCell = Arc<OnceCell<ConnectionMetadata>>;

/// Per-process cache, bounded for temporary connections. Keys retain connection
/// IDs and parameter hashes, never URLs, passwords, or serialized parameters.
#[derive(Default)]
pub struct ConnectionMetadataCache {
    entries: Mutex<HashMap<(Option<String>, [u8; 32]), MetadataCell>>,
}

impl ConnectionMetadataCache {
    pub async fn entry(&self, params: &ConnectionParams) -> Result<MetadataCell, String> {
        // Serializing through Value sorts object keys, including plugin extras.
        let value = serde_json::to_value(params).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        let fingerprint: [u8; 32] = Sha256::digest(&bytes).into();
        let key = (params.connection_id.clone(), fingerprint);
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.get(&key) {
            return Ok(entry.clone());
        }
        if entries.len() >= 128 {
            entries.clear();
        }
        let cell = Arc::new(OnceCell::new());
        entries.insert(key, cell.clone());
        Ok(cell)
    }

    pub async fn invalidate(&self, connection_id: Option<&str>) {
        self.entries
            .lock()
            .await
            .retain(|(id, _), _| id.as_deref() != connection_id);
    }
}

#[cfg(test)]
#[path = "connection_metadata_tests.rs"]
mod tests;
