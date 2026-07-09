//! Maps a foreign app's database label to a Tabularis driver id.
//!
//! Built-in drivers are `postgres`, `mysql`, `sqlite` (see
//! `src/utils/connections.ts`). MariaDB rides the MySQL driver. Anything else
//! is only importable when a plugin driver with the same id is registered; the
//! analyzer flags the rest with a "driver not installed" warning but still lets
//! the user import the metadata.

/// Canonical driver id for a foreign label, plus whether that driver is
/// currently registered (built-in or via plugin).
pub fn map_driver_label(label: &str, registered_ids: &[String]) -> (String, bool) {
    let id = canonical_id(label);
    let installed = registered_ids.iter().any(|r| r == &id);
    (id, installed)
}

/// Normalize a source-app driver label/provider/subprotocol to a Tabularis id.
/// Built-ins win; for everything else we lower-case the label as a best guess
/// at a plugin id (e.g. "MongoDB" -> "mongodb").
pub fn canonical_id(label: &str) -> String {
    match label.trim().to_ascii_lowercase().as_str() {
        "postgresql" | "postgres" | "postgre" => "postgres".to_string(),
        "mysql" | "mariadb" => "mysql".to_string(),
        "sqlite" | "sqlite3" => "sqlite".to_string(),
        "sql server" | "sqlserver" | "mssql" | "jtds" => "mssql".to_string(),
        "mongodb" | "mongo" => "mongodb".to_string(),
        "redis" => "redis".to_string(),
        "oracle" => "oracle".to_string(),
        "clickhouse" => "clickhouse".to_string(),
        "cockroachdb" | "cockroach" => "cockroachdb".to_string(),
        "redshift" => "redshift".to_string(),
        "cassandra" => "cassandra".to_string(),
        "bigquery" => "bigquery".to_string(),
        "duckdb" => "duckdb".to_string(),
        "libsql" => "libsql".to_string(),
        other => other.replace(' ', ""),
    }
}

/// Default port for a Tabularis driver id, used when the source omits one.
/// 0 means "no port" (file-based drivers such as SQLite).
pub fn default_port(driver_id: &str) -> u16 {
    match driver_id {
        "postgres" | "redshift" => 5432,
        "mysql" => 3306,
        "cockroachdb" => 26257,
        "mssql" => 1433,
        "oracle" => 1521,
        "mongodb" => 27017,
        "redis" => 6379,
        "clickhouse" => 8123,
        "cassandra" => 9042,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_builtin_labels() {
        assert_eq!(canonical_id("PostgreSQL"), "postgres");
        assert_eq!(canonical_id("MySQL"), "mysql");
        assert_eq!(canonical_id("MariaDB"), "mysql");
        assert_eq!(canonical_id("SQLite"), "sqlite");
    }

    #[test]
    fn maps_plugin_labels_lowercased() {
        assert_eq!(canonical_id("MongoDB"), "mongodb");
        assert_eq!(canonical_id("SQL Server"), "mssql");
        assert_eq!(canonical_id("ClickHouse"), "clickhouse");
    }

    #[test]
    fn installed_flag_reflects_registry() {
        let registered = vec!["postgres".to_string(), "mysql".to_string()];
        assert_eq!(
            map_driver_label("PostgreSQL", &registered),
            ("postgres".to_string(), true)
        );
        assert_eq!(
            map_driver_label("MongoDB", &registered),
            ("mongodb".to_string(), false)
        );
    }

    #[test]
    fn default_ports() {
        assert_eq!(default_port("postgres"), 5432);
        assert_eq!(default_port("mysql"), 3306);
        assert_eq!(default_port("sqlite"), 0);
        assert_eq!(default_port("mssql"), 1433);
    }
}
