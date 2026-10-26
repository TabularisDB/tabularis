use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::RwLock;

use std::collections::HashMap;

fn default_true() -> bool {
    true
}

fn default_backup_time() -> String {
    "02:00".to_string()
}

fn default_backup_timezone() -> String {
    "local".to_string()
}

fn default_backup_retention() -> u32 {
    7
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupPlan {
    pub enabled: bool,
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default = "default_backup_time")]
    pub time: String,
    #[serde(default = "default_backup_timezone")]
    pub timezone: String,
    #[serde(default)]
    pub destination_directory: String,
    #[serde(default = "default_backup_retention")]
    pub retention: u32,
    #[serde(default = "default_true")]
    pub include_structure: bool,
    #[serde(default = "default_true")]
    pub include_data: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tables: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    pub interpreter: Option<String>,
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
    /// Per-plugin override of `AppConfig::plugin_call_timeout_seconds`.
    /// `None` inherits the global value; `0` disables the timeout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call_timeout_seconds: Option<u32>,
    /// Per-plugin override of `AppConfig::plugin_shutdown_grace_seconds`.
    /// `None` inherits the global value; values below 1 are clamped at runtime.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shutdown_grace_seconds: Option<u32>,
}

/// Per-connection column masking overrides (`table.column` entries).
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMaskingOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WindowDecorationsMode {
    #[default]
    Automatic,
    AlwaysShow,
    AlwaysHide,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme: Option<String>,
    /// When true, the app follows the OS light/dark appearance using
    /// `light_theme_id` / `dark_theme_id`. None/false ⇒ static `theme`.
    pub follow_system_theme: Option<bool>,
    /// Theme applied while the OS is in light mode and follow-system is on.
    pub light_theme_id: Option<String>,
    /// Theme applied while the OS is in dark mode and follow-system is on.
    pub dark_theme_id: Option<String>,
    pub language: Option<String>,
    pub result_page_size: Option<u32>,
    pub font_family: Option<String>,
    pub font_size: Option<u32>,
    /// Colorize query result cell values by their data type (number, string,
    /// date, boolean). Default: false — values render in the primary text color.
    pub result_color_by_type: Option<bool>,
    /// Per-type hex color overrides for result cell values. Keys: "number",
    /// "string", "date", "boolean". Missing keys fall back to the active theme's
    /// semantic colors.
    pub result_type_colors: Option<HashMap<String, String>>,
    /// Keep data grid column headers pinned while scrolling. Default: true.
    pub sticky_column_headers: Option<bool>,
    /// Alternate the background of data grid rows. Default: false.
    pub result_zebra_stripes: Option<bool>,
    /// Default sort direction on data grid header click: `"asc"` or `"desc"`.
    pub default_sort_direction: Option<String>,
    /// Keep the row editor sidebar in sync with the selected grid row. Default: true.
    pub row_editor_follow_selection: Option<bool>,
    pub group_sidebar_connections_by_folder: Option<bool>,
    /// What double-clicking a grid cell does: `"inline"` (default), `"sidebar"`
    /// or `"both"`.
    pub cell_double_click_action: Option<String>,
    pub ai_enabled: Option<bool>,
    pub ai_provider: Option<String>,
    pub ai_model: Option<String>,
    pub ai_custom_models: Option<HashMap<String, Vec<String>>>,
    pub ai_ollama_port: Option<u16>,
    pub ai_custom_openai_url: Option<String>,
    pub ai_custom_openai_model: Option<String>,
    pub check_for_updates: Option<bool>,
    pub auto_check_updates_on_startup: Option<bool>,
    pub last_dismissed_version: Option<String>,
    /// Last plugin release shown in a startup notification, keyed by plugin id.
    pub notified_plugin_versions: Option<HashMap<String, String>>,
    pub er_diagram_default_layout: Option<String>,
    pub schema_preferences: Option<HashMap<String, String>>,
    pub selected_schemas: Option<HashMap<String, Vec<String>>>,
    pub max_blob_size: Option<u64>,
    pub copy_format: Option<String>,
    pub csv_delimiter: Option<String>,
    /// Whether copied CSV output includes a header row. Default: true.
    pub csv_include_headers: Option<bool>,
    pub active_external_drivers: Option<Vec<String>>,
    /// COMPAT(registry-ga): legacy config key from before the Tabularium API
    /// cutover. Read once by `compat::migrate_legacy_config`, then cleared.
    #[serde(default)]
    pub custom_registry_url: Option<String>,
    /// COMPAT(registry-ga): override URL for the legacy static `registry.json`
    /// merged into the catalogue during migration. Defaults to the built-in
    /// GitHub-hosted file when unset.
    #[serde(default)]
    pub legacy_registry_url: Option<String>,
    /// Base URL of the Tabularium plugin registry (e.g. https://registry.tabularis.dev).
    /// Defaults to the built-in instance when unset.
    pub tabularium_registry_url: Option<String>,
    /// Update channel: "stable" (default) or "nightly". None ⇒ stable.
    pub release_channel: Option<String>,
    pub plugins: Option<HashMap<String, PluginConfig>>,
    /// Maximum seconds the host waits for a plugin to answer a single call.
    /// `0` disables the timeout. Default: 120. Overridable per plugin.
    pub plugin_call_timeout_seconds: Option<u32>,
    /// Seconds in-flight plugin calls may run after shutdown is requested.
    /// Values below 1 are clamped at runtime. Default: 2. Overridable per plugin.
    pub plugin_shutdown_grace_seconds: Option<u32>,
    pub editor_theme: Option<String>,
    /// Font for query result cells ("inherit" follows the interface font). Default: JetBrains Mono.
    pub result_font_family: Option<String>,
    pub editor_font_family: Option<String>,
    pub editor_font_size: Option<u32>,
    pub editor_line_height: Option<f32>,
    pub editor_tab_size: Option<u32>,
    pub editor_word_wrap: Option<bool>,
    /// Highlight hidden Unicode and look-alike characters in the SQL editor.
    pub editor_highlight_invisible_characters: Option<bool>,
    pub editor_show_line_numbers: Option<bool>,
    /// Whether the Enter key accepts the active autocomplete suggestion in the
    /// SQL editor. Maps to Monaco's `acceptSuggestionOnEnter` setting: `true`
    /// becomes `"smart"` (the safer variant), `false` becomes `"off"`.
    /// Default: `true` — matches the behaviour users expect from most editors.
    pub editor_accept_suggestion_on_enter: Option<bool>,
    pub run_statement_under_cursor: Option<bool>,
    /// Delay destructive-query and production-write confirmations for five seconds. Default: false.
    pub safety_confirmation_delay_enabled: Option<bool>,
    /// Send a desktop notification when a long-running query finishes while the window is unfocused. Default: true.
    pub notify_long_queries: Option<bool>,
    /// Minimum execution time in seconds before a finished query triggers a notification. Default: 20.
    pub notify_long_queries_threshold_sec: Option<u32>,
    // ----- SQL Formatter -----
    pub formatter_keyword_case: Option<String>,
    pub formatter_indent_style: Option<String>,
    pub formatter_tab_width: Option<u32>,
    pub formatter_use_tabs: Option<bool>,
    pub formatter_function_case: Option<String>,
    pub formatter_lines_between_queries: Option<u32>,
    pub formatter_dense_operators: Option<bool>,
    /// Case of SQL keywords inserted by autocomplete: "match" | "upper" | "lower"
    pub autocomplete_keyword_case: Option<String>,
    /// Connection health check interval in seconds. 0 = disabled. Default: 30.
    pub ping_interval: Option<u32>,
    /// Maximum number of query history entries per connection. Default: 500.
    pub query_history_max_entries: Option<u32>,
    /// Whether to show the welcome screen on startup. Default: true (first launch).
    pub show_welcome: Option<bool>,
    /// Maximize the window on startup. Default: false.
    pub start_maximized: Option<bool>,
    /// Controls native window decorations. Automatic hides them for recognized
    /// tiling window managers and keeps them on other desktop environments.
    pub window_decorations: Option<WindowDecorationsMode>,
    /// IANA timezone name (e.g. `Asia/Tokyo`) used to render timestamps in the
    /// UI and exports. `None` or `"auto"` follows the OS local timezone.
    pub display_timezone: Option<String>,

    // ----- AI Audit Log -----
    /// Record every MCP tool call to the audit log. Default: true.
    pub ai_audit_enabled: Option<bool>,
    /// Maximum entries per audit-log file before rotation. Default: 5000.
    pub ai_audit_max_entries: Option<u32>,
    /// Inactivity gap (in minutes) after which a new MCP session id is minted.
    /// Default: 10.
    pub ai_session_gap_minutes: Option<u32>,

    // ----- MCP Tool Output -----
    /// Default text encoding for MCP tool results: `"json"` or `"toon"`.
    /// Per-call `output_format` arguments override this preference. Default: `"json"`.
    pub mcp_output_format: Option<String>,

    // ----- MCP Read-only Mode -----
    /// Default behaviour for MCP `run_query`: when true, every connection is
    /// read-only unless explicitly listed as writable. Default: false.
    pub mcp_readonly_default: Option<bool>,
    /// Per-connection override list. Semantics depend on `mcp_readonly_default`:
    /// when default is `false` this is the *inclusion* list of read-only
    /// connections; when default is `true` this is the *exclusion* list of
    /// connections that are allowed to write.
    pub mcp_readonly_connections: Option<Vec<String>>,

    // ----- MCP Approval Gate -----
    /// `"off"` | `"writes_only"` | `"all"`. Default: `"writes_only"`.
    pub mcp_approval_mode: Option<String>,
    /// Maximum time the MCP subprocess waits for the user to decide. Default: 120.
    pub mcp_approval_timeout_seconds: Option<u32>,
    /// Run a pre-flight EXPLAIN before opening the approval modal. Default: true.
    pub mcp_preflight_explain: Option<bool>,
    /// Bring the main window to the foreground and make it temporarily top-most
    /// while an MCP approval is pending. Default: true.
    pub mcp_approval_always_on_top: Option<bool>,
    /// Send a native notification and play a short sound when a new MCP
    /// approval request arrives. Default: true.
    pub mcp_approval_notify_sound: Option<bool>,

    // ----- Automatic connections backup -----
    /// When backups run: `"manual"` (default), `"interval"`, `"onClose"`
    /// or `"onLaunch"`.
    pub backup_mode: Option<String>,
    /// Directory the backup files are written to.
    pub backup_directory: Option<String>,
    /// Minutes between automatic backups in interval mode. Default: 1440.
    pub backup_interval_minutes: Option<u32>,
    /// Number of backup files kept before rotation. Default: 10.
    pub backup_retention: Option<u32>,
    /// Backup destination: `"local"` (default) or `"webdav"`.
    pub backup_target: Option<String>,
    /// WebDAV collection URL the backups are uploaded into.
    pub backup_webdav_url: Option<String>,
    /// WebDAV username; the password lives in the OS keychain.
    pub backup_webdav_username: Option<String>,
    pub database_backup_plan: Option<DatabaseBackupPlan>,

    // ----- Privacy -----
    /// Mask values of sensitive columns in the results grid (display only). Default: true.
    pub column_masking_enabled: Option<bool>,
    /// Column-name patterns (case-insensitive substring) that trigger masking.
    pub column_masking_patterns: Option<Vec<String>>,
    /// Per-connection `table.column` include/exclude overrides, keyed by connection id.
    pub column_masking_overrides: Option<HashMap<String, ColumnMaskingOverride>>,

    // ----- Session restore -----
    /// Reconnect to the last active connection on startup. Default: true.
    pub auto_connect_last_connection: Option<bool>,
    /// Id of the connection that was active when the app was last closed.
    pub last_active_connection_id: Option<String>,
    /// Ids of all connections that were open when the app was last closed.
    pub last_open_connection_ids: Option<Vec<String>>,

    // ----- Built-in driver migration -----
    /// Whether the user has dismissed the PostgreSQL-plugin migration banner.
    /// `None`/`false` → banner is eligible to show. All four fields in this
    /// section are driver-id-generic so future built-in deprecations reuse
    /// them without new config plumbing.
    #[serde(default)]
    pub postgres_plugin_migration_banner_dismissed: Option<bool>,
    /// Connection ids that existed (on the builtin driver) at the moment the
    /// banner was dismissed. A builtin connection id not in this list means
    /// the trigger condition changed since the dismissal, so the banner
    /// resurfaces — mirrors `WhatsNewModal`'s own version-comparison gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postgres_plugin_migration_banner_dismissed_for: Option<Vec<String>>,
    /// Append-only record of every connection migrated between built-in and
    /// plugin drivers. Kept even after an undo, so a filed issue has the
    /// before/after to attach and a later deprecation pass can see who
    /// already tried and bounced off a given plugin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub driver_migration_history: Option<Vec<DriverMigrationRecord>>,
    /// Map of `plugin_id` → list of capability-gap feature names the user has
    /// already reported. Prevents re-prompting for a gap already filed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_capability_gaps: Option<HashMap<String, Vec<String>>>,
    /// Per built-in driver id → migration mode. Defaults to `opt-in` when
    /// unset; flipping an entry to `forced` is a separate, later decision
    /// gated on adoption signal — never enabled by this field's existence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migration_mode_by_driver: Option<HashMap<String, MigrationMode>>,

    // ----- Network / Proxy -----
    /// Shared custom proxy endpoint and per-scope routing modes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<crate::proxy::GlobalProxySettings>,
    /// Per AI-provider proxy overrides (`openai`, `anthropic`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_provider_proxies: Option<HashMap<String, crate::proxy::ProxyOverride>>,
}

/// One entry in the append-only driver-migration history.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriverMigrationRecord {
    /// Connection that was migrated.
    pub connection_id: String,
    /// Driver id migrated from (e.g. the built-in `"postgres"`).
    pub from_driver: String,
    /// Driver id migrated to (e.g. the plugin `"postgresql"`).
    pub to_driver: String,
    /// ISO-8601 timestamp of the migration.
    pub migrated_at: String,
    /// Whether the post-migration "Switched — Undo" toast was dismissed.
    #[serde(default)]
    pub toast_dismissed: bool,
}

/// Whether a built-in driver's migration is opt-in or forced. Flipping to
/// `Forced` is a separate, later decision; the default everywhere is
/// `OptIn`.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MigrationMode {
    #[default]
    OptIn,
    Forced,
}

static CONFIG_CACHE: Lazy<RwLock<AppConfig>> = Lazy::new(|| RwLock::new(AppConfig::default()));

pub(crate) fn cache_config(config: &AppConfig) {
    crate::plugins::call_timeout::apply_config(config);
    crate::plugins::shutdown_grace::apply_config(config);
    if let Ok(mut cached) = CONFIG_CACHE.write() {
        *cached = config.clone();
    }
}

pub fn get_cached_config() -> AppConfig {
    CONFIG_CACHE
        .read()
        .map(|cached| cached.clone())
        .unwrap_or_default()
}

// ---------- AI/MCP safety defaults ----------
pub const DEFAULT_AI_AUDIT_ENABLED: bool = true;
pub const DEFAULT_AI_AUDIT_MAX_ENTRIES: u32 = 5000;
pub const DEFAULT_AI_SESSION_GAP_MINUTES: u32 = 10;
pub const DEFAULT_MCP_OUTPUT_FORMAT: &str = "json";
pub const DEFAULT_MCP_READONLY_DEFAULT: bool = false;
pub const DEFAULT_MCP_APPROVAL_MODE: &str = "writes_only";
pub const DEFAULT_MCP_APPROVAL_TIMEOUT_SECONDS: u32 = 120;
pub const DEFAULT_MCP_PREFLIGHT_EXPLAIN: bool = true;
pub const DEFAULT_MCP_APPROVAL_ALWAYS_ON_TOP: bool = true;
pub const DEFAULT_MCP_APPROVAL_NOTIFY_SOUND: bool = true;

/// Load `config.json` directly from disk without an `AppHandle`.
///
/// Used by the standalone MCP subprocess (`tabularis --mcp`) which has no
/// Tauri runtime. Falls back to `AppConfig::default()` when missing or
/// unreadable.
pub fn load_config_from_disk() -> AppConfig {
    let path = crate::paths::get_app_config_dir().join("config.json");
    let (config, trusted) = parse_config_file(fs::read_to_string(&path));
    // The MCP subprocess never goes through `cache_config`; keep its plugin
    // call timeouts in sync with what is on disk. A transient read or parse
    // failure must not reset them to the defaults, so the last-known-good
    // snapshot is kept in that case.
    if trusted {
        crate::plugins::call_timeout::apply_config(&config);
        crate::plugins::shutdown_grace::apply_config(&config);
    }
    config
}

/// Turns the result of reading `config.json` into a config plus whether it
/// reflects what the user actually configured. A missing file is trusted
/// (the defaults are the real config), a read or parse error is not.
fn parse_config_file(read: std::io::Result<String>) -> (AppConfig, bool) {
    match read {
        Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
            Ok(config) => (config, true),
            Err(_) => (AppConfig::default(), false),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (AppConfig::default(), true),
        Err(_) => (AppConfig::default(), false),
    }
}

/// True when `connection_id` should be treated as read-only by MCP, taking
/// the per-connection override list into account.
pub fn is_connection_readonly(config: &AppConfig, connection_id: &str) -> bool {
    let default_ro = config
        .mcp_readonly_default
        .unwrap_or(DEFAULT_MCP_READONLY_DEFAULT);
    let listed = config
        .mcp_readonly_connections
        .as_ref()
        .map(|v| v.iter().any(|s| s == connection_id))
        .unwrap_or(false);
    // When default is false the list flips that connection to read-only.
    // When default is true the list flips that connection to writable.
    if default_ro {
        !listed
    } else {
        listed
    }
}

/// Composes the config-storage key for per-connection schema selection/
/// preference. A non-empty `database` scopes the key to that database, so a
/// nested multi-database driver (e.g. PostgreSQL browsing several databases
/// on one connection) keeps each database's schema selection independent
/// instead of every database sharing one flat per-connection entry.
pub(crate) fn schema_storage_key(connection_id: &str, database: Option<&str>) -> String {
    match database {
        Some(db) if !db.is_empty() => format!("{connection_id}::{db}"),
        _ => connection_id.to_string(),
    }
}

/// Looks up a schema preference, falling back to the pre-multi-db flat
/// per-connection entry when the database-scoped key has never been set.
///
/// A connection's schema preference saved before it opted into
/// multi-database browsing lives under the flat `connection_id` key. Once
/// opted in, every lookup passes a database and scopes to
/// `connection_id::database` instead — without this fallback, that old
/// preference is orphaned and silently lost the first time each database is
/// looked up under its new per-database key.
pub(crate) fn resolve_schema_preference(
    prefs: &HashMap<String, String>,
    connection_id: &str,
    database: Option<&str>,
) -> Option<String> {
    let key = schema_storage_key(connection_id, database);
    if let Some(value) = prefs.get(&key) {
        return Some(value.clone());
    }
    if key != connection_id {
        return prefs.get(connection_id).cloned();
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyStatus {
    pub configured: bool,
    pub from_env: bool,
}

#[cfg(test)]
#[path = "config/plugin_notification_tests.rs"]
mod plugin_notification_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_config_deserializes_system_theme_fields() {
        let json = r#"{"theme":"tabularis-dark","followSystemTheme":true,"lightThemeId":"tabularis-light","darkThemeId":"dracula"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.follow_system_theme, Some(true));
        assert_eq!(config.light_theme_id.as_deref(), Some("tabularis-light"));
        assert_eq!(config.dark_theme_id.as_deref(), Some("dracula"));
    }

    #[test]
    fn app_config_defaults_system_theme_fields_to_none() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(config.follow_system_theme.is_none());
        assert!(config.light_theme_id.is_none());
        assert!(config.dark_theme_id.is_none());
    }

    #[test]
    fn selected_schemas_default_is_none() {
        let config = AppConfig::default();
        assert!(config.selected_schemas.is_none());
    }

    #[test]
    fn selected_schemas_serialization_round_trip() {
        let mut config = AppConfig::default();
        let mut map = HashMap::new();
        map.insert(
            "conn-1".to_string(),
            vec!["public".to_string(), "analytics".to_string()],
        );
        config.selected_schemas = Some(map);

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        let schemas = deserialized.selected_schemas.unwrap();
        let conn1 = schemas.get("conn-1").unwrap();
        assert_eq!(conn1, &vec!["public".to_string(), "analytics".to_string()]);
    }

    #[test]
    fn selected_schemas_camel_case_in_json() {
        let mut config = AppConfig::default();
        let mut map = HashMap::new();
        map.insert("conn-1".to_string(), vec!["public".to_string()]);
        config.selected_schemas = Some(map);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("selectedSchemas"));
        assert!(!json.contains("selected_schemas"));
    }

    #[test]
    fn multiple_connections_independent_selected_schemas() {
        let mut config = AppConfig::default();
        let mut map = HashMap::new();
        map.insert("conn-1".to_string(), vec!["public".to_string()]);
        map.insert(
            "conn-2".to_string(),
            vec!["staging".to_string(), "prod".to_string()],
        );
        config.selected_schemas = Some(map);

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        let schemas = deserialized.selected_schemas.unwrap();
        assert_eq!(schemas.get("conn-1").unwrap(), &vec!["public".to_string()]);
        assert_eq!(
            schemas.get("conn-2").unwrap(),
            &vec!["staging".to_string(), "prod".to_string()]
        );
    }

    #[test]
    pub(crate) fn schema_storage_key_plain_connection_without_database() {
        assert_eq!(schema_storage_key("conn-1", None), "conn-1");
        assert_eq!(schema_storage_key("conn-1", Some("")), "conn-1");
    }

    #[test]
    pub(crate) fn schema_storage_key_scopes_to_database_when_given() {
        assert_eq!(
            schema_storage_key("conn-1", Some("analytics")),
            "conn-1::analytics"
        );
    }

    #[test]
    pub(crate) fn schema_storage_key_keeps_two_databases_on_the_same_connection_independent() {
        let a = schema_storage_key("conn-1", Some("db_a"));
        let b = schema_storage_key("conn-1", Some("db_b"));
        assert_ne!(a, b);
    }

    #[test]
    pub(crate) fn resolve_schema_preference_prefers_the_scoped_key_when_it_exists() {
        let mut prefs = HashMap::new();
        prefs.insert("conn-1".to_string(), "legacy_public".to_string());
        prefs.insert(
            "conn-1::analytics".to_string(),
            "analytics_schema".to_string(),
        );

        assert_eq!(
            resolve_schema_preference(&prefs, "conn-1", Some("analytics")),
            Some("analytics_schema".to_string())
        );
    }

    #[test]
    pub(crate) fn resolve_schema_preference_falls_back_to_the_flat_key_after_a_multi_db_opt_in() {
        // Regression: a connection's schema preference saved before it opted
        // into multi-database browsing lives under the flat "conn-1" key.
        // Once opted in, every lookup passes a database and would otherwise
        // silently miss under the new "conn-1::analytics" key forever.
        let mut prefs = HashMap::new();
        prefs.insert("conn-1".to_string(), "legacy_public".to_string());

        assert_eq!(
            resolve_schema_preference(&prefs, "conn-1", Some("analytics")),
            Some("legacy_public".to_string())
        );
    }

    #[test]
    pub(crate) fn resolve_schema_preference_returns_none_when_neither_key_exists() {
        let prefs = HashMap::new();
        assert_eq!(
            resolve_schema_preference(&prefs, "conn-1", Some("analytics")),
            None
        );
    }

    #[test]
    pub(crate) fn resolve_schema_preference_plain_connection_reads_only_the_flat_key() {
        let mut prefs = HashMap::new();
        prefs.insert("conn-1".to_string(), "public".to_string());

        assert_eq!(
            resolve_schema_preference(&prefs, "conn-1", None),
            Some("public".to_string())
        );
        assert_eq!(
            resolve_schema_preference(&prefs, "conn-1", Some("")),
            Some("public".to_string())
        );
    }

    #[test]
    fn old_hidden_schemas_json_deserializes_without_error() {
        // Ensure old config files with hiddenSchemas don't break deserialization
        let json = r#"{"hiddenSchemas":{"conn-1":["secret"]}}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        // hiddenSchemas is no longer a field, so it's ignored; selectedSchemas is None
        assert!(config.selected_schemas.is_none());
    }

    #[test]
    fn editor_fields_default_to_none() {
        let config = AppConfig::default();
        assert!(config.safety_confirmation_delay_enabled.is_none());
        assert!(config.notify_long_queries.is_none());
        assert!(config.notify_long_queries_threshold_sec.is_none());
        assert!(config.editor_theme.is_none());
        assert!(config.result_font_family.is_none());
        assert!(config.editor_font_family.is_none());
        assert!(config.editor_font_size.is_none());
        assert!(config.editor_line_height.is_none());
        assert!(config.editor_tab_size.is_none());
        assert!(config.editor_word_wrap.is_none());
        assert!(config.editor_highlight_invisible_characters.is_none());
        assert!(config.editor_show_line_numbers.is_none());
        assert!(config.editor_accept_suggestion_on_enter.is_none());
    }

    #[test]
    fn editor_fields_serialize_with_camel_case() {
        let mut config = AppConfig::default();
        config.editor_font_family = Some("JetBrains Mono".to_string());
        config.result_font_family = Some("inherit".to_string());
        config.editor_font_size = Some(16);
        config.editor_line_height = Some(1.5);
        config.editor_tab_size = Some(4);
        config.editor_word_wrap = Some(false);
        config.editor_highlight_invisible_characters = Some(false);
        config.editor_show_line_numbers = Some(true);
        config.editor_theme = Some("tabularis-light".to_string());
        config.editor_accept_suggestion_on_enter = Some(true);
        config.safety_confirmation_delay_enabled = Some(true);
        config.notify_long_queries = Some(true);
        config.notify_long_queries_threshold_sec = Some(20);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("editorFontFamily"));
        assert!(json.contains("resultFontFamily"));
        assert!(json.contains("editorFontSize"));
        assert!(json.contains("editorLineHeight"));
        assert!(json.contains("editorTabSize"));
        assert!(json.contains("editorWordWrap"));
        assert!(json.contains("editorHighlightInvisibleCharacters"));
        assert!(json.contains("editorShowLineNumbers"));
        assert!(json.contains("editorTheme"));
        assert!(json.contains("editorAcceptSuggestionOnEnter"));
        assert!(json.contains("safetyConfirmationDelayEnabled"));
        assert!(json.contains("notifyLongQueries"));
        assert!(json.contains("notifyLongQueriesThresholdSec"));
        // snake_case must not appear
        assert!(!json.contains("editor_font_family"));
        assert!(!json.contains("result_font_family"));
        assert!(!json.contains("editor_accept_suggestion_on_enter"));
        assert!(!json.contains("safety_confirmation_delay_enabled"));
        assert!(!json.contains("notify_long_queries"));
        assert!(!json.contains("notify_long_queries_threshold_sec"));
    }

    #[test]
    fn editor_fields_round_trip() {
        let json = r#"{
            "editorFontFamily": "Hack",
            "resultFontFamily": "Open Sans",
            "editorFontSize": 14,
            "editorLineHeight": 1.8,
            "editorTabSize": 2,
            "editorWordWrap": true,
            "editorHighlightInvisibleCharacters": false,
            "editorShowLineNumbers": true,
            "editorTheme": "tabularis-dark",
            "editorAcceptSuggestionOnEnter": true,
            "safetyConfirmationDelayEnabled": true,
            "notifyLongQueries": true,
            "notifyLongQueriesThresholdSec": 30
        }"#;

        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.editor_font_family.as_deref(), Some("Hack"));
        assert_eq!(config.result_font_family.as_deref(), Some("Open Sans"));
        assert_eq!(config.editor_font_size, Some(14));
        assert_eq!(config.editor_tab_size, Some(2));
        assert_eq!(config.editor_word_wrap, Some(true));
        assert_eq!(config.editor_highlight_invisible_characters, Some(false));
        assert_eq!(config.editor_show_line_numbers, Some(true));
        assert_eq!(config.editor_theme.as_deref(), Some("tabularis-dark"));
        assert_eq!(config.editor_accept_suggestion_on_enter, Some(true));
        assert_eq!(config.safety_confirmation_delay_enabled, Some(true));
        assert_eq!(config.notify_long_queries, Some(true));
        assert_eq!(config.notify_long_queries_threshold_sec, Some(30));
    }

    #[test]
    fn save_config_json_rejects_invalid_json() {
        // Test that the validation logic catches malformed AppConfig JSON
        let invalid = r#"{"editorFontSize": "not-a-number"}"#;
        let result = serde_json::from_str::<AppConfig>(invalid);
        assert!(result.is_err());
    }

    #[test]
    fn ai_safety_fields_default_to_none() {
        let config = AppConfig::default();
        assert!(config.ai_audit_enabled.is_none());
        assert!(config.ai_audit_max_entries.is_none());
        assert!(config.ai_session_gap_minutes.is_none());
        assert!(config.mcp_output_format.is_none());
        assert!(config.mcp_readonly_default.is_none());
        assert!(config.mcp_readonly_connections.is_none());
        assert!(config.mcp_approval_mode.is_none());
        assert!(config.mcp_approval_timeout_seconds.is_none());
        assert!(config.mcp_preflight_explain.is_none());
        assert!(config.mcp_approval_always_on_top.is_none());
        assert!(config.mcp_approval_notify_sound.is_none());
    }

    #[test]
    fn ai_safety_fields_serialize_with_camel_case() {
        let mut config = AppConfig::default();
        config.ai_audit_enabled = Some(true);
        config.ai_audit_max_entries = Some(1000);
        config.ai_session_gap_minutes = Some(5);
        config.mcp_output_format = Some("toon".into());
        config.mcp_readonly_default = Some(true);
        config.mcp_readonly_connections = Some(vec!["c1".into()]);
        config.mcp_approval_mode = Some("all".into());
        config.mcp_approval_timeout_seconds = Some(60);
        config.mcp_preflight_explain = Some(false);
        config.mcp_approval_always_on_top = Some(true);
        config.mcp_approval_notify_sound = Some(true);

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("aiAuditEnabled"));
        assert!(json.contains("aiAuditMaxEntries"));
        assert!(json.contains("aiSessionGapMinutes"));
        assert!(json.contains("mcpOutputFormat"));
        assert!(json.contains("mcpReadonlyDefault"));
        assert!(json.contains("mcpReadonlyConnections"));
        assert!(json.contains("mcpApprovalMode"));
        assert!(json.contains("mcpApprovalTimeoutSeconds"));
        assert!(json.contains("mcpPreflightExplain"));
        assert!(json.contains("mcpApprovalAlwaysOnTop"));
        assert!(json.contains("mcpApprovalNotifySound"));
    }

    #[test]
    fn ai_safety_fields_round_trip() {
        let json = r#"{
            "aiAuditEnabled": false,
            "aiAuditMaxEntries": 2000,
            "aiSessionGapMinutes": 30,
            "mcpOutputFormat": "toon",
            "mcpReadonlyDefault": true,
            "mcpReadonlyConnections": ["a", "b"],
            "mcpApprovalMode": "writes_only",
            "mcpApprovalTimeoutSeconds": 90,
            "mcpPreflightExplain": true,
            "mcpApprovalAlwaysOnTop": false,
            "mcpApprovalNotifySound": true
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.ai_audit_enabled, Some(false));
        assert_eq!(config.ai_audit_max_entries, Some(2000));
        assert_eq!(config.ai_session_gap_minutes, Some(30));
        assert_eq!(config.mcp_output_format.as_deref(), Some("toon"));
        assert_eq!(config.mcp_readonly_default, Some(true));
        assert_eq!(
            config.mcp_readonly_connections.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
        assert_eq!(config.mcp_approval_mode.as_deref(), Some("writes_only"));
        assert_eq!(config.mcp_approval_timeout_seconds, Some(90));
        assert_eq!(config.mcp_preflight_explain, Some(true));
        assert_eq!(config.mcp_approval_always_on_top, Some(false));
        assert_eq!(config.mcp_approval_notify_sound, Some(true));
    }

    #[test]
    fn display_timezone_serializes_with_camel_case_and_round_trips() {
        let mut config = AppConfig::default();
        assert!(config.display_timezone.is_none());
        config.display_timezone = Some("Asia/Tokyo".into());
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("displayTimezone"));
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.display_timezone.as_deref(), Some("Asia/Tokyo"));
    }

    #[test]
    fn default_sort_direction_serializes_with_camel_case_and_round_trips() {
        let mut config = AppConfig::default();
        assert!(config.default_sort_direction.is_none());
        config.default_sort_direction = Some("desc".into());
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("defaultSortDirection"));
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.default_sort_direction.as_deref(), Some("desc"));
    }

    #[test]
    fn is_connection_readonly_default_false_no_override_returns_false() {
        let config = AppConfig::default();
        assert!(!is_connection_readonly(&config, "c1"));
    }

    #[test]
    fn is_connection_readonly_default_false_with_inclusion_list() {
        let mut config = AppConfig::default();
        config.mcp_readonly_default = Some(false);
        config.mcp_readonly_connections = Some(vec!["c1".into()]);
        assert!(is_connection_readonly(&config, "c1"));
        assert!(!is_connection_readonly(&config, "c2"));
    }

    #[test]
    fn is_connection_readonly_default_true_with_exclusion_list() {
        let mut config = AppConfig::default();
        config.mcp_readonly_default = Some(true);
        config.mcp_readonly_connections = Some(vec!["c1".into()]);
        assert!(!is_connection_readonly(&config, "c1"));
        assert!(is_connection_readonly(&config, "c2"));
    }

    #[test]
    fn load_config_from_disk_returns_default_when_missing() {
        // The default config dir is unlikely to have our test sentinels, so
        // we just confirm the call returns a valid AppConfig (Default fallback
        // path is exercised indirectly via parse failures + missing file).
        let _ = load_config_from_disk();
    }

    #[test]
    fn parse_config_file_trusts_valid_content() {
        let (config, trusted) =
            parse_config_file(Ok(r#"{"pluginCallTimeoutSeconds":0}"#.to_string()));
        assert!(trusted);
        assert_eq!(config.plugin_call_timeout_seconds, Some(0));
    }

    #[test]
    fn parse_config_file_trusts_missing_file() {
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        let (config, trusted) = parse_config_file(Err(missing));
        assert!(trusted);
        assert_eq!(config.plugin_call_timeout_seconds, None);
    }

    #[test]
    fn parse_config_file_distrusts_read_errors() {
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let (_, trusted) = parse_config_file(Err(denied));
        assert!(!trusted);
    }

    #[test]
    fn parse_config_file_distrusts_malformed_content() {
        let (_, trusted) = parse_config_file(Ok("{ truncated".to_string()));
        assert!(!trusted);
    }

    #[test]
    fn grid_and_privacy_settings_round_trip_through_config_file() {
        // Payload shape sent by the frontend's `save_config` call.
        let json = r#"{
            "rowEditorFollowSelection": false,
            "groupSidebarConnectionsByFolder": true,
            "cellDoubleClickAction": "sidebar",
            "columnMaskingEnabled": false,
            "columnMaskingPatterns": ["password", "ssn"],
            "columnMaskingOverrides": {
                "conn-1": { "include": ["users.email"], "exclude": ["users.token"] },
                "conn-2": { "exclude": ["orders.card"] }
            }
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();

        // Same path as save_config (write) followed by load_config (read).
        let saved = serde_json::to_string_pretty(&config).unwrap();
        let reloaded = parse_config_file(Ok(saved.clone())).0;

        assert_eq!(reloaded.row_editor_follow_selection, Some(false));
        assert_eq!(reloaded.group_sidebar_connections_by_folder, Some(true));
        assert_eq!(
            reloaded.cell_double_click_action.as_deref(),
            Some("sidebar")
        );
        assert_eq!(reloaded.column_masking_enabled, Some(false));
        assert_eq!(
            reloaded.column_masking_patterns,
            Some(vec!["password".to_string(), "ssn".to_string()])
        );
        let overrides = reloaded.column_masking_overrides.unwrap();
        assert_eq!(
            overrides.get("conn-1"),
            Some(&ColumnMaskingOverride {
                include: Some(vec!["users.email".to_string()]),
                exclude: Some(vec!["users.token".to_string()]),
            })
        );
        assert_eq!(
            overrides.get("conn-2"),
            Some(&ColumnMaskingOverride {
                include: None,
                exclude: Some(vec!["orders.card".to_string()]),
            })
        );

        // Keys are written in camelCase, matching `SettingsContext.ts`.
        for key in [
            "rowEditorFollowSelection",
            "groupSidebarConnectionsByFolder",
            "cellDoubleClickAction",
            "columnMaskingEnabled",
            "columnMaskingPatterns",
            "columnMaskingOverrides",
        ] {
            assert!(saved.contains(key), "missing {key} in saved config");
        }
    }

    #[test]
    fn grid_and_privacy_settings_default_to_none_for_existing_configs() {
        let (config, trusted) = parse_config_file(Ok(r#"{"theme":"dracula"}"#.to_string()));
        assert!(trusted);
        assert!(config.row_editor_follow_selection.is_none());
        assert!(config.group_sidebar_connections_by_folder.is_none());
        assert!(config.cell_double_click_action.is_none());
        assert!(config.column_masking_enabled.is_none());
        assert!(config.column_masking_patterns.is_none());
        assert!(config.column_masking_overrides.is_none());
    }
}
