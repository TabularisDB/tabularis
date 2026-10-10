use super::productivity::*;
use futures::future::join_all;
use serde_json::from_value;
use std::sync::Arc;

fn save_command(connection_id: &str, index: usize) -> ProductivityCommand {
    ProductivityCommand::SaveQuery {
        connection_id: connection_id.to_string(),
        name: format!("Query {index}"),
        sql: format!("SELECT {index}"),
        database: Some("app".to_string()),
    }
}

#[tokio::test]
async fn saved_query_crud_is_connection_scoped() {
    let temp = tempfile::tempdir().unwrap();
    let config_dir = temp.path();
    let saved: SavedQuery = from_value(
        execute(config_dir, save_command("connection-a", 1))
            .await
            .unwrap(),
    )
    .unwrap();

    let connection_a: Vec<SavedQuery> = from_value(
        execute(
            config_dir,
            ProductivityCommand::GetSavedQueries {
                connection_id: "connection-a".to_string(),
            },
        )
        .await
        .unwrap(),
    )
    .unwrap();
    let connection_b: Vec<SavedQuery> = from_value(
        execute(
            config_dir,
            ProductivityCommand::GetSavedQueries {
                connection_id: "connection-b".to_string(),
            },
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(connection_a.len(), 1);
    assert!(connection_b.is_empty());

    let update_error = execute(
        config_dir,
        ProductivityCommand::UpdateSavedQuery {
            connection_id: Some("connection-b".to_string()),
            id: saved.id.clone(),
            name: "Other".to_string(),
            sql: "SELECT 2".to_string(),
            database: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(update_error, "Query not found");

    let updated: SavedQuery = from_value(
        execute(
            config_dir,
            ProductivityCommand::UpdateSavedQuery {
                connection_id: Some("connection-a".to_string()),
                id: saved.id.clone(),
                name: "Updated".to_string(),
                sql: "SELECT 2".to_string(),
                database: Some("analytics".to_string()),
            },
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(updated.name, "Updated");
    assert_eq!(updated.database.as_deref(), Some("analytics"));

    assert!(execute(
        config_dir,
        ProductivityCommand::DeleteSavedQuery {
            connection_id: Some("connection-b".to_string()),
            id: saved.id.clone(),
        },
    )
    .await
    .is_err());
    execute(
        config_dir,
        ProductivityCommand::DeleteSavedQuery {
            connection_id: Some("connection-a".to_string()),
            id: saved.id,
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn concurrent_sessions_do_not_lose_saved_queries() {
    let temp = tempfile::tempdir().unwrap();
    let config_dir = Arc::new(temp.path().to_path_buf());
    let writes = (0..32).map(|index| {
        let config_dir = config_dir.clone();
        tokio::spawn(async move {
            execute(&config_dir, save_command("shared-connection", index))
                .await
                .unwrap();
        })
    });
    for result in join_all(writes).await {
        result.unwrap();
    }

    let queries: Vec<SavedQuery> = from_value(
        execute(
            &config_dir,
            ProductivityCommand::GetSavedQueries {
                connection_id: "shared-connection".to_string(),
            },
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(queries.len(), 32);
}

#[tokio::test]
async fn concurrent_sessions_do_not_lose_or_cross_scope_history_entries() {
    let temp = tempfile::tempdir().unwrap();
    let config_dir = Arc::new(temp.path().to_path_buf());
    let writes = (0..24).map(|index| {
        let config_dir = config_dir.clone();
        let connection_id = if index % 2 == 0 {
            "connection-a"
        } else {
            "connection-b"
        };
        tokio::spawn(async move {
            execute(
                &config_dir,
                ProductivityCommand::AddQueryHistoryEntry {
                    connection_id: connection_id.to_string(),
                    sql: format!("SELECT {index}"),
                    executed_at: format!("2026-08-22T00:00:{index:02}Z"),
                    execution_time_ms: Some(index as f64),
                    status: "success".to_string(),
                    rows_affected: Some(1),
                    error: None,
                    database: Some("app".to_string()),
                },
            )
            .await
            .unwrap();
        })
    });
    for result in join_all(writes).await {
        result.unwrap();
    }

    for connection_id in ["connection-a", "connection-b"] {
        let history: QueryHistoryResponse = from_value(
            execute(
                &config_dir,
                ProductivityCommand::GetQueryHistory {
                    connection_id: connection_id.to_string(),
                },
            )
            .await
            .unwrap(),
        )
        .unwrap();
        assert_eq!(history.entries.len(), 12);
        assert!(history
            .entries
            .iter()
            .all(|entry| entry.sql != "SELECT 100"));
    }
}

#[tokio::test]
async fn query_history_crud_preserves_recovery_and_deduplication_contracts() {
    let temp = tempfile::tempdir().unwrap();
    let config_dir = temp.path();
    let add = |executed_at: &str| ProductivityCommand::AddQueryHistoryEntry {
        connection_id: "connection-a".to_string(),
        sql: "SELECT 1".to_string(),
        executed_at: executed_at.to_string(),
        execution_time_ms: Some(1.0),
        status: "success".to_string(),
        rows_affected: Some(1),
        error: None,
        database: Some("app".to_string()),
    };
    let first: QueryHistoryEntry = from_value(
        execute(config_dir, add("2026-08-22T00:00:00Z"))
            .await
            .unwrap(),
    )
    .unwrap();
    let deduplicated: QueryHistoryEntry = from_value(
        execute(config_dir, add("2026-08-22T00:01:00Z"))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(deduplicated.id, first.id);
    assert_eq!(deduplicated.executed_at, "2026-08-22T00:01:00Z");

    execute(
        config_dir,
        ProductivityCommand::DeleteQueryHistoryEntry {
            connection_id: "connection-a".to_string(),
            id: first.id,
        },
    )
    .await
    .unwrap();
    execute(
        config_dir,
        ProductivityCommand::ClearQueryHistory {
            connection_id: "connection-a".to_string(),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn rejects_history_connection_path_traversal() {
    let temp = tempfile::tempdir().unwrap();
    let error = execute(
        temp.path(),
        ProductivityCommand::GetQueryHistory {
            connection_id: "../outside".to_string(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(error, "Invalid connection identifier");
}
