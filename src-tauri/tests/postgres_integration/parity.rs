//! Parity test harness — runs identical assertions against multiple driver
//! implementations to prove behavioral equivalence.
//!
//! # Phase 0
//!
//! Only `DriverTarget::Builtin` is registered. Tests pass trivially (single
//! result, nothing to compare), but the harness infrastructure is ready for
//! Phase 1 to add `DriverTarget::Plugin`.
//!
//! # Phase 1
//!
//! Both targets are registered. Tests now run against both drivers and assert
//! that their outputs are identical — proving parity by construction.
//!
//! # Comparison Strategy
//!
//! Since model structs don't derive `PartialEq`, the harness serializes results
//! to `serde_json::Value` and compares those. This also catches subtle
//! differences in field ordering or null handling that direct struct comparison
//! might miss.

use std::collections::HashMap;
use std::fmt::Debug;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value as JsonValue;

use tabularis_lib::drivers::driver_trait::{
    DatabaseDriver, DriverCapabilities, PluginManifest, SqlDialect,
};
use tabularis_lib::drivers::postgres::PostgresDriver;
use tabularis_lib::models::{ConnectionParams, DataTypeInfo};
use tabularis_lib::plugins::driver::RpcDriver;

use crate::helpers::{pg_params, pg_params_secondary, retry_transient};

/// Identifies which driver implementation to test.
#[derive(Debug, Clone)]
pub enum DriverTarget {
    /// The built-in PostgreSQL driver (direct sqlx implementation).
    Builtin,
    /// A plugin driver communicating over JSON-RPC stdio.
    /// The string is the plugin id (e.g. "postgres-plugin").
    Plugin(String),
}

impl std::fmt::Display for DriverTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Builtin => write!(f, "builtin"),
            Self::Plugin(id) => write!(f, "plugin:{}", id),
        }
    }
}

/// The parity harness. Holds configured driver targets and connection params.
pub struct ParityHarness {
    targets: Vec<(DriverTarget, Arc<dyn DatabaseDriver>)>,
    pub params: ConnectionParams,
    pub params_secondary: ConnectionParams,
}

impl ParityHarness {
    /// Create a harness with only the built-in driver (Phase 0 fallback).
    pub fn builtin_only() -> Self {
        let driver = Arc::new(PostgresDriver::new()) as Arc<dyn DatabaseDriver>;
        Self {
            targets: vec![(DriverTarget::Builtin, driver)],
            params: pg_params(),
            params_secondary: pg_params_secondary(),
        }
    }

    /// Create a harness, optionally including the plugin driver if
    /// `POSTGRES_PLUGIN_BIN` is set. This is the primary constructor for
    /// Phase 1+ parity tests.
    pub async fn new() -> Self {
        let mut harness = Self::builtin_only();
        if let Some(plugin_driver) = try_plugin_driver().await {
            harness = harness.with_plugin("postgres-plugin", plugin_driver);
        }
        harness
    }

    /// Add a plugin driver target.
    pub fn with_plugin(mut self, id: &str, driver: Arc<dyn DatabaseDriver>) -> Self {
        self.targets
            .push((DriverTarget::Plugin(id.to_string()), driver));
        self
    }

    /// Returns a reference to the list of configured targets.
    pub fn targets(&self) -> &[(DriverTarget, Arc<dyn DatabaseDriver>)] {
        &self.targets
    }

    /// Run a test function against all configured targets and assert identical
    /// results (compared via JSON serialization). The `method_name` is used in
    /// assertion messages for diagnostics.
    ///
    /// With a single target (Phase 0), this simply runs the function once and
    /// returns the JSON value. With multiple targets (Phase 1+), it compares all
    /// serialized results pairwise.
    pub async fn assert_parity<T, F, Fut>(&self, method_name: &str, test_fn: F) -> JsonValue
    where
        T: Debug + Serialize,
        F: Fn(Arc<dyn DatabaseDriver>, ConnectionParams) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        self.run_parity_inner(method_name, &self.params, test_fn)
            .await
    }

    /// Same as `assert_parity` but uses `params_secondary` for multi-database tests.
    pub async fn assert_parity_secondary<T, F, Fut>(
        &self,
        method_name: &str,
        test_fn: F,
    ) -> JsonValue
    where
        T: Debug + Serialize,
        F: Fn(Arc<dyn DatabaseDriver>, ConnectionParams) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        self.run_parity_inner(method_name, &self.params_secondary, test_fn)
            .await
    }

    async fn run_parity_inner<T, F, Fut>(
        &self,
        method_name: &str,
        params: &ConnectionParams,
        test_fn: F,
    ) -> JsonValue
    where
        T: Debug + Serialize,
        F: Fn(Arc<dyn DatabaseDriver>, ConnectionParams) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let mut results: Vec<(String, JsonValue)> = Vec::new();

        for (target, driver) in &self.targets {
            let result = retry_transient(3, || test_fn(Arc::clone(driver), params.clone()))
                .await
                .unwrap_or_else(|e| {
                    panic!(
                        "Parity test '{}' failed on target {}: {}",
                        method_name, target, e
                    )
                });
            let json = serde_json::to_value(&result).unwrap_or_else(|e| {
                panic!(
                    "Parity test '{}': failed to serialize result from {}: {}",
                    method_name, target, e
                )
            });
            results.push((target.to_string(), json));
        }

        // Compare all results pairwise
        for window in results.windows(2) {
            let (ref name_a, ref val_a) = window[0];
            let (ref name_b, ref val_b) = window[1];
            assert_eq!(
                val_a,
                val_b,
                "Parity failure in '{}': {} and {} returned different results.\n\
                 Left:  {}\n\
                 Right: {}",
                method_name,
                name_a,
                name_b,
                serde_json::to_string_pretty(val_a).unwrap(),
                serde_json::to_string_pretty(val_b).unwrap()
            );
        }

        // Return the first result (all are equal)
        results.into_iter().next().unwrap().1
    }

    /// Assert that a method produces the same error semantics across targets.
    /// For methods expected to fail, this checks that all targets either succeed
    /// with equal results or fail (error messages may differ between drivers,
    /// so only the success/failure outcome is compared).
    #[allow(dead_code)]
    pub async fn assert_error_parity<T, F, Fut>(&self, method_name: &str, test_fn: F)
    where
        T: Debug + Serialize,
        F: Fn(Arc<dyn DatabaseDriver>, ConnectionParams) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let mut results: Vec<(String, Result<JsonValue, String>)> = Vec::new();

        for (target, driver) in &self.targets {
            let result = test_fn(Arc::clone(driver), self.params.clone()).await;
            let mapped = result.map(|v| {
                serde_json::to_value(&v)
                    .unwrap_or_else(|e| panic!("Failed to serialize result from {}: {}", target, e))
            });
            results.push((target.to_string(), mapped));
        }

        for window in results.windows(2) {
            let (ref name_a, ref res_a) = window[0];
            let (ref name_b, ref res_b) = window[1];
            match (res_a, res_b) {
                (Ok(a), Ok(b)) => assert_eq!(
                    a, b,
                    "Parity failure in '{}': {} and {} returned different success values",
                    method_name, name_a, name_b
                ),
                (Err(_), Err(_)) => {
                    // Both failed — parity holds (error messages may differ between drivers)
                }
                _ => panic!(
                    "Parity failure in '{}': {} {} but {} {}",
                    method_name,
                    name_a,
                    if res_a.is_ok() { "succeeded" } else { "failed" },
                    name_b,
                    if res_b.is_ok() { "succeeded" } else { "failed" }
                ),
            }
        }
    }
}

/// Attempt to construct a plugin driver from the `POSTGRES_PLUGIN_BIN` env var.
/// Returns `None` if the env var is unset (Phase 0 / no plugin available).
/// Panics if the env var is set but the path doesn't exist or the plugin
/// fails to start — an explicit `POSTGRES_PLUGIN_BIN` is a request to run
/// against a real plugin, so a bad path must fail loud rather than silently
/// falling back to builtin-only parity (which would trivially "pass").
async fn try_plugin_driver() -> Option<Arc<dyn DatabaseDriver>> {
    let bin_path = std::env::var("POSTGRES_PLUGIN_BIN").ok()?;
    let path = PathBuf::from(&bin_path);

    if !path.exists() {
        panic!(
            "POSTGRES_PLUGIN_BIN is set to '{}' but the file does not exist — \
             fix the path or unset the variable to run builtin-only parity",
            bin_path
        );
    }

    eprintln!("  [parity] Spawning plugin driver from: {}", bin_path);

    let manifest = plugin_manifest();
    let data_types = plugin_data_types();

    let driver = RpcDriver::new(manifest, path, None, data_types, HashMap::new())
        .await
        .unwrap_or_else(|e| panic!("Failed to start plugin driver: {}", e));

    Some(Arc::new(driver) as Arc<dyn DatabaseDriver>)
}

/// Build the PluginManifest matching the plugin's .tabularium file.
fn plugin_manifest() -> PluginManifest {
    PluginManifest {
        id: "postgres-plugin".to_string(),
        name: "PostgreSQL Plugin".to_string(),
        version: "0.1.0".to_string(),
        description: "PostgreSQL plugin driver for Tabularis".to_string(),
        default_port: Some(5432),
        capabilities: DriverCapabilities {
            schemas: true,
            single_database: false,
            views: true,
            materialized_views: true,
            routines: true,
            routine_management: true,
            file_based: false,
            folder_based: false,
            connection_string: true,
            connection_string_example: "postgres://user:pass@localhost:5432/db".into(),
            connection_uri: false,
            connection_uri_schemes: Vec::new(),
            identifier_quote: "\"".into(),
            alter_primary_key: true,
            auto_increment_keyword: String::new(),
            serial_type: "SERIAL".into(),
            inline_pk: false,
            alter_column: true,
            create_foreign_keys: true,
            no_connection_required: false,
            manage_tables: true,
            explain: true,
            readonly: false,
            triggers: true,
            supports_ssl: true,
            user_management: false,
            sql_dialect: Some(SqlDialect::Postgres),
        },
        is_builtin: false,
        engine: Some("postgresql".to_string()),
        paradigms: vec!["relational".to_string()],
        default_username: "postgres".to_string(),
        color: "#3b82f6".to_string(),
        icon: "postgres".to_string(),
        settings: vec![],
        ui_extensions: None,
        explain_parsers: None,
        type_mappings: {
            let mut m = HashMap::new();
            m.insert("DATETIME".to_string(), "TIMESTAMP".to_string());
            m.insert("JSON".to_string(), "JSONB".to_string());
            m
        },
    }
}

/// Data types the plugin supports (matches .tabularium data_types array).
fn plugin_data_types() -> Vec<DataTypeInfo> {
    // For the parity harness, data types are used for display only.
    // Return an empty vec — the RpcDriver doesn't use these for query execution.
    Vec::new()
}
