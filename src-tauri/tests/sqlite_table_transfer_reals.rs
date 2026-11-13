//! "Export table to SQL" (#709) keeps every SQLite real bit for bit,
//! whichever decimal parser the SQLite build uses. SQLite reads decimals
//! with `long double` where it is wider than `double` (Linux x86-64) and
//! with double-double arithmetic elsewhere (macOS on Apple Silicon); the
//! two disagree on some values, and neither is exact for all of them. This
//! test switches between the two in-process, so every platform runs both.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::sync::Arc;
use tabularis_lib::application::database_transfers::DumpCancellationState;
use tabularis_lib::application::table_transfers::{
    export_table, import_table, IfTableExists, TableExportDestination, TableExportOptions,
    TableImportOptions, TableImportSource,
};
use tabularis_lib::export::ExportCancellationState;
use tabularis_lib::models::{
    ConnectionParams, ConnectionsFile, DatabaseSelection, SavedConnection,
};
use tabularis_lib::runtime::events::NoopRuntimeEvents;
use tabularis_lib::runtime::paths::FixedRuntimePaths;
use tabularis_lib::runtime::RuntimeContext;
use tabularis_lib::table_sql::TableSqlContent;

extern "C" {
    // Part of the SQLite bundled through `libsqlite3-sys`.
    fn sqlite3_test_control(op: std::os::raw::c_int, ...) -> std::os::raw::c_int;
}

/// `SQLITE_TESTCTRL_USELONGDOUBLE`: 1 or 0 picks the parser, -1 reads it.
const USE_LONG_DOUBLE: std::os::raw::c_int = 34;

fn use_long_double(setting: i32) -> i32 {
    unsafe { sqlite3_test_control(USE_LONG_DOUBLE, setting as std::os::raw::c_int) }
}

struct NoSecrets;

impl tabularis_lib::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _value: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn params(path: &Path) -> ConnectionParams {
    ConnectionParams {
        driver: "sqlite".to_string(),
        database: DatabaseSelection::Single(path.to_string_lossy().into_owned()),
        ..Default::default()
    }
}

/// A runtime with the saved connections `source` and `target`.
fn runtime(dir: &Path) -> RuntimeContext {
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(dir.to_path_buf(), dir.to_path_buf())),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let connections = ["source", "target"]
        .into_iter()
        .map(|id| SavedConnection {
            id: id.to_string(),
            name: id.to_string(),
            params: params(&dir.join(format!("{id}.sqlite"))),
            plugin_secret_keys: Vec::new(),
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
            managed: false,
        })
        .collect();
    tabularis_lib::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &ConnectionsFile {
            connections,
            ..Default::default()
        },
    )
    .expect("save the test connections");
    runtime
}

async fn open(path: &Path) -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true),
        )
        .await
        .expect("open the database")
}

/// Every value's storage class, and a real's bits.
async fn stored(pool: &SqlitePool) -> Vec<(i64, Vec<(String, Option<u64>)>)> {
    sqlx::query("SELECT id, typeof(r), r, typeof(u), u, typeof(b), b FROM items ORDER BY id")
        .fetch_all(pool)
        .await
        .expect("read the table")
        .iter()
        .map(|row| {
            let cell = |at: usize| {
                let class: String = row.get(at);
                let bits = (class == "real").then(|| row.get::<f64, _>(at + 1).to_bits());
                (class, bits)
            };
            (row.get(0), vec![cell(1), cell(3), cell(5)])
        })
        .collect()
}

fn sample() -> Vec<f64> {
    let mut values = vec![
        f64::MAX,
        -f64::MAX,
        f64::MIN_POSITIVE,
        5e-324,
        -2.5e-320,
        0.1,
        4.35,
        0.30000000000000004,
        1e300,
        1e-300,
        123456789012345678.0,
        1.5e18,
        2.0,
        -0.5,
        3.621_169_826_913_291_7e121,
        -1.559_352_507_113_789_3e286,
        -5.730_500_128_638_256e257,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ];
    // Random bit patterns, then random short decimals like the ones people type.
    let mut state = 88_172_645_463_325_252u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    while values.len() < 15_000 {
        let value = f64::from_bits(next());
        if value.is_finite() {
            values.push(value);
        }
    }
    while values.len() < 20_000 {
        let bits = next();
        let digits = (bits % 100_000_000_000_000) as f64;
        let power = (bits >> 50) % 45;
        values.push(format!("{digits}e-{power}").parse().unwrap());
    }
    values
}

async fn round_trip(dir: &Path, values: &[f64]) -> (usize, usize) {
    let source_path = dir.join("source.sqlite");
    let target_path = dir.join("target.sqlite");
    for path in [&source_path, &target_path] {
        let _ = std::fs::remove_file(path);
    }
    let source = open(&source_path).await;
    sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY, r REAL, u, b BLOB)")
        .execute(&source)
        .await
        .unwrap();
    let mut insert = source.begin().await.unwrap();
    for (id, value) in values.iter().enumerate() {
        // Bound, so the stored value doesn't go through a decimal parser.
        sqlx::query("INSERT INTO items VALUES (?, ?, ?, ?)")
            .bind(id as i64)
            .bind(value)
            .bind(value)
            .bind(value)
            .execute(&mut *insert)
            .await
            .unwrap();
    }
    insert.commit().await.unwrap();
    drop(open(&target_path).await);

    let runtime = runtime(dir);
    let path = dir.join("items.sql");
    let _ = std::fs::remove_file(&path);
    export_table(
        &runtime,
        &ExportCancellationState::default(),
        None,
        "source".to_string(),
        TableExportOptions {
            table: "items".to_string(),
            content: TableSqlContent::StructureAndData,
            schema: None,
            database: None,
        },
        TableExportDestination::ServerPath(path.clone()),
    )
    .await
    .expect("export");
    import_table(
        &runtime,
        &DumpCancellationState::default(),
        None,
        "target".to_string(),
        TableImportSource::ServerPath(path),
        TableImportOptions {
            if_exists: IfTableExists::Fail,
            schema: None,
            database: None,
        },
    )
    .await
    .expect("import");
    tabularis_lib::pool_manager::close_pool(&params(&source_path)).await;
    tabularis_lib::pool_manager::close_pool(&params(&target_path)).await;

    let target = open(&target_path).await;
    let expected = stored(&source).await;
    let actual = stored(&target).await;
    assert_eq!(actual.len(), expected.len());
    let differing = expected
        .iter()
        .zip(&actual)
        .filter(|(left, right)| left != right)
        .count();
    (expected.len(), differing)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_real_comes_back_with_either_decimal_parser() {
    tabularis_lib::drivers::registry::register_driver(
        tabularis_lib::drivers::sqlite::SqliteDriver::new(),
    )
    .await;
    let values = sample();
    let original = use_long_double(-1);
    let mut differing = Vec::new();
    for parser in [1, 0] {
        use_long_double(parser);
        let dir = tempfile::tempdir().unwrap();
        let (rows, wrong) = round_trip(dir.path(), &values).await;
        assert_eq!(rows, values.len());
        differing.push((parser, wrong));
    }
    use_long_double(original);
    assert_eq!(
        differing,
        [(1, 0), (0, 0)],
        "(long double parser, rows that changed)"
    );
}
