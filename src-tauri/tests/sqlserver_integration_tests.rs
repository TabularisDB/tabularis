use std::collections::HashMap;

use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::sqlserver::SqlServerDriver;
use tabularis_lib::models::{ConnectionParams, DatabaseSelection};

fn live_params() -> Option<ConnectionParams> {
    let password = std::env::var("TABULARIS_TEST_MSSQL_PASSWORD").ok()?;
    let host =
        std::env::var("TABULARIS_TEST_MSSQL_HOST").unwrap_or_else(|_| "localhost".to_string());
    let port = std::env::var("TABULARIS_TEST_MSSQL_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1433);

    Some(ConnectionParams {
        driver: "sqlserver".to_string(),
        host: Some(host),
        port: Some(port),
        username: Some("sa".to_string()),
        password: Some(password),
        database: DatabaseSelection::Single("master".to_string()),
        ssl_mode: Some(
            std::env::var("TABULARIS_TEST_MSSQL_SSL_MODE").unwrap_or_else(|_| "prefer".to_string()),
        ),
        ..ConnectionParams::default()
    })
}

fn row(tenant_id: i64, id: i64, name: &str) -> HashMap<String, serde_json::Value> {
    HashMap::from([
        ("tenant_id".to_string(), serde_json::json!(tenant_id)),
        ("id".to_string(), serde_json::json!(id)),
        ("name".to_string(), serde_json::json!(name)),
    ])
}

#[tokio::test]
async fn sqlserver_live_driver_workflow() {
    let Some(params) = live_params() else {
        eprintln!("skipped: TABULARIS_TEST_MSSQL_PASSWORD is not set");
        return;
    };

    let driver = SqlServerDriver::new();
    let table = format!("tabularis_driver_test_{}", std::process::id());
    let view = format!("{table}_view");
    let qualified = format!("[dbo].[{table}]");

    driver
        .test_connection(&params)
        .await
        .expect("SQL Server connection must succeed");
    let _ = driver.drop_view(&params, &view, Some("dbo")).await;
    let _ = driver
        .execute_query(
            &params,
            &format!("DROP TABLE IF EXISTS {qualified}"),
            None,
            1,
            Some("dbo"),
        )
        .await;
    driver
        .execute_query(
            &params,
            &format!(
                "CREATE TABLE {qualified} (\
                 [tenant_id] INT NOT NULL, \
                 [id] INT IDENTITY(1,1) NOT NULL, \
                 [name] NVARCHAR(100) NOT NULL, \
                 PRIMARY KEY ([tenant_id], [id]))"
            ),
            None,
            1,
            Some("dbo"),
        )
        .await
        .expect("test table must be created");

    let result = async {
        let tables = driver.get_tables(&params, Some("dbo")).await?;
        if !tables.iter().any(|candidate| candidate.name == table) {
            return Err("created table was not discovered".to_string());
        }

        let add_column = driver
            .get_add_column_sql(
                &table,
                tabularis_lib::models::ColumnDefinition {
                    name: "note".into(),
                    data_type: "NVARCHAR(50)".into(),
                    is_nullable: true,
                    is_pk: false,
                    is_auto_increment: false,
                    default_value: None,
                },
                Some("dbo"),
            )
            .await?;
        for statement in add_column {
            driver
                .execute_query(&params, &statement, None, 1, Some("dbo"))
                .await?;
        }

        let columns = driver.get_columns(&params, &table, Some("dbo")).await?;
        if columns.len() != 4
            || columns.iter().filter(|column| column.is_pk).count() != 2
            || !columns.iter().any(|column| column.is_auto_increment)
        {
            return Err("columns, composite PK, or IDENTITY were not discovered".to_string());
        }

        let index_name = format!("ix_{table}_name");
        let create_index = driver
            .get_create_index_sql(&table, &index_name, vec!["name".into()], false, Some("dbo"))
            .await?;
        for statement in create_index {
            driver
                .execute_query(&params, &statement, None, 1, Some("dbo"))
                .await?;
        }
        if !driver
            .get_indexes(&params, &table, Some("dbo"))
            .await?
            .iter()
            .any(|index| index.name == index_name)
        {
            return Err("created index was not discovered".to_string());
        }
        driver
            .drop_index(&params, &table, &index_name, Some("dbo"))
            .await?;

        for (id, name) in [(1, "alpha"), (2, "bravo"), (3, "charlie")] {
            let affected = driver
                .insert_record(&params, &table, row(7, id, name), Some("dbo"), 1024 * 1024)
                .await?;
            if affected != 1 {
                return Err(format!("INSERT affected {affected} rows instead of 1"));
            }
        }

        driver
            .insert_record(
                &params,
                &table,
                row(7, 1, "duplicate"),
                Some("dbo"),
                1024 * 1024,
            )
            .await
            .expect_err("duplicate identity insert must fail");
        let affected = driver
            .insert_record(
                &params,
                &table,
                row(7, 4, "after-error"),
                Some("dbo"),
                1024 * 1024,
            )
            .await?;
        if affected != 1 {
            return Err("IDENTITY_INSERT was not restored after an error".to_string());
        }
        let temporary_key = HashMap::from([
            ("tenant_id".to_string(), serde_json::json!(7)),
            ("id".to_string(), serde_json::json!(4)),
        ]);
        driver
            .delete_record(&params, &table, &temporary_key, Some("dbo"))
            .await?;

        let primary_key = HashMap::from([
            ("tenant_id".to_string(), serde_json::json!(7)),
            ("id".to_string(), serde_json::json!(1)),
        ]);
        let affected = driver
            .update_record(
                &params,
                &table,
                &primary_key,
                "name",
                serde_json::json!("beta"),
                Some("dbo"),
                1024 * 1024,
            )
            .await?;
        if affected != 1 {
            return Err(format!("UPDATE affected {affected} rows instead of 1"));
        }
        let cte_update = driver
            .execute_query(
                &params,
                &format!(
                    "WITH [target] AS (SELECT [name] FROM {qualified} WHERE [tenant_id] = 7 AND [id] = 1) \
                     UPDATE [target] SET [name] = N'gamma'"
                ),
                Some(10),
                1,
                Some("dbo"),
            )
            .await?;
        if cte_update.affected_rows != 1 || cte_update.pagination.is_some() {
            return Err("CTE UPDATE was treated as a paginated SELECT".to_string());
        }

        let insert_then_select = driver
            .execute_query(
                &params,
                &format!(
                    "INSERT INTO {qualified} ([tenant_id], [name]) VALUES (7, N'mixed'); \
                     SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS [inserted_id]"
                ),
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if insert_then_select.rows.len() != 1 {
            return Err("INSERT followed by SELECT lost its result set".to_string());
        }
        driver
            .execute_query(
                &params,
                &format!("DELETE FROM {qualified} WHERE [name] = N'mixed'"),
                None,
                1,
                Some("dbo"),
            )
            .await?;

        let bigint = driver
            .execute_query(
                &params,
                "SELECT CAST(9223372036854775807 AS BIGINT) AS [bigint]",
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if bigint.rows != vec![vec![serde_json::json!("9223372036854775807")]] {
            return Err("BIGINT exceeded JavaScript-safe precision".to_string());
        }

        let exec_result = driver
            .execute_query(
                &params,
                "EXEC sp_executesql N'SELECT 77 AS [value]'",
                Some(10),
                1,
                Some("dbo"),
            )
            .await?;
        if exec_result.rows != vec![vec![serde_json::json!(77)]]
            || exec_result.pagination.is_some()
        {
            return Err("EXEC result set was lost or paginated".to_string());
        }

        let output_result = driver
            .execute_query(
                &params,
                &format!(
                    "UPDATE {qualified} SET [note] = N'output' \
                     OUTPUT INSERTED.[id] WHERE [tenant_id] = 7 AND [id] = 2"
                ),
                Some(10),
                1,
                Some("dbo"),
            )
            .await?;
        if output_result.rows != vec![vec![serde_json::json!(2)]]
            || output_result.pagination.is_some()
        {
            return Err("DML OUTPUT result set was lost or paginated".to_string());
        }

        driver
            .create_view(
                &params,
                &view,
                &format!("SELECT [tenant_id], [id], [name] FROM {qualified}"),
                Some("dbo"),
            )
            .await?;
        let views = driver.get_views(&params, Some("dbo")).await?;
        if !views.iter().any(|candidate| candidate.name == view) {
            return Err("created view was not discovered".to_string());
        }
        driver
            .alter_view(
                &params,
                &view,
                &format!("SELECT [id], [name] FROM {qualified}"),
                Some("dbo"),
            )
            .await?;

        let first_page = driver
            .execute_query(
                &params,
                &format!("SELECT [id], [name] FROM {qualified} ORDER BY [id]"),
                Some(2),
                1,
                Some("dbo"),
            )
            .await?;
        if first_page.rows.len() != 2
            || !first_page.truncated
            || !first_page.pagination.is_some_and(|page| page.has_more)
        {
            return Err(format!("unexpected first page: {:?}", first_page.rows));
        }

        let cte_page = driver
            .execute_query(
                &params,
                &format!(
                    "WITH [rows] AS (SELECT [id], [name] FROM {qualified}) \
                     SELECT [id], [name] FROM [rows] ORDER BY [id]"
                ),
                Some(2),
                2,
                Some("dbo"),
            )
            .await?;
        if cte_page.rows.len() != 1 || cte_page.rows[0][0] != serde_json::json!(3) {
            return Err(format!("unexpected CTE page: {:?}", cte_page.rows));
        }

        let multi = driver
            .execute_query(
                &params,
                "SELECT 1 AS [first]; SELECT 2 AS [second]",
                None,
                1,
                Some("dbo"),
            )
            .await?;
        let additional = multi
            .additional_results
            .as_ref()
            .ok_or_else(|| "multiple SQL Server result sets were not preserved".to_string())?;
        if multi.rows != vec![vec![serde_json::json!(1)]]
            || additional.first().map(|result| &result.rows)
                != Some(&vec![vec![serde_json::json!(2)]])
        {
            return Err("multiple result sets contained unexpected rows".to_string());
        }

        let batch = driver
            .execute_batch(
                &params,
                &[
                    "CREATE TABLE #tabularis_batch ([value] INT NOT NULL)".into(),
                    "INSERT INTO #tabularis_batch ([value]) VALUES (42) -- trailing comment".into(),
                    "SELECT [value] FROM #tabularis_batch".into(),
                    "BEGIN TRANSACTION".into(),
                    format!(
                        "INSERT INTO {qualified} ([tenant_id], [name]) VALUES (7, N'rolled-back')"
                    ),
                ],
                None,
                1,
                Some("dbo"),
                None,
            )
            .await?;
        let batch_rows = batch
            .get(2)
            .and_then(|item| item.result.as_ref())
            .map(|result| &result.rows);
        let batch_insert_affected = batch
            .get(1)
            .and_then(|item| item.result.as_ref())
            .map(|result| result.affected_rows);
        if batch_rows != Some(&vec![vec![serde_json::json!(42)]])
            || batch_insert_affected != Some(1)
        {
            return Err(format!(
                "batch did not preserve session state or affected rows: {batch:?}"
            ));
        }

        let reset_state = driver
            .execute_query(
                &params,
                "SELECT OBJECT_ID('tempdb..#tabularis_batch') AS [object_id]",
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if reset_state.rows != vec![vec![serde_json::Value::Null]] {
            return Err("temporary table leaked across pool checkout".to_string());
        }
        let rolled_back = driver
            .execute_query(
                &params,
                &format!(
                    "SELECT [id] FROM {qualified} WHERE [name] = N'rolled-back'"
                ),
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if !rolled_back.rows.is_empty() {
            return Err("open transaction leaked across pool checkout".to_string());
        }

        let mut scripted_params = params.clone();
        scripted_params.connection_id = Some(format!("sqlserver-startup-{}", std::process::id()));
        scripted_params.startup_script = Some("SET DATEFIRST 3".into());
        for _ in 0..2 {
            let date_first = driver
                .execute_query(
                    &scripted_params,
                    "SELECT @@DATEFIRST AS [date_first]",
                    None,
                    1,
                    Some("dbo"),
                )
                .await?;
            if date_first.rows != vec![vec![serde_json::json!(3)]] {
                return Err("startup script was not applied after pool recycle".to_string());
            }
        }
        tabularis_lib::pool_manager::close_pool(&scripted_params).await;

        let selected_then_update = driver
            .execute_query(
                &params,
                &format!(
                    "SELECT 99 AS [marker]; UPDATE {qualified} SET [note] = N'updated' WHERE [tenant_id] = 7 AND [id] = 2"
                ),
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if selected_then_update.rows != vec![vec![serde_json::json!(99)]] {
            return Err("SELECT followed by UPDATE lost its result set".to_string());
        }
        let updated_note = driver
            .execute_query(
                &params,
                &format!("SELECT [note] FROM {qualified} WHERE [tenant_id] = 7 AND [id] = 2"),
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if updated_note.rows != vec![vec![serde_json::json!("updated")]] {
            return Err("UPDATE after SELECT was not executed".to_string());
        }

        let affected = driver
            .delete_record(&params, &table, &primary_key, Some("dbo"))
            .await?;
        if affected != 1 {
            return Err(format!("DELETE affected {affected} rows instead of 1"));
        }
        let empty = driver
            .execute_query(
                &params,
                &format!("SELECT [id] FROM {qualified} WHERE [id] = -1"),
                None,
                1,
                Some("dbo"),
            )
            .await?;
        if empty.columns != vec!["id"] || !empty.rows.is_empty() {
            return Err(format!(
                "empty result metadata was not preserved: {:?}",
                empty.columns
            ));
        }

        driver.drop_view(&params, &view, Some("dbo")).await?;
        Ok::<(), String>(())
    }
    .await;

    let _ = driver.drop_view(&params, &view, Some("dbo")).await;
    let cleanup = driver
        .execute_query(
            &params,
            &format!("DROP TABLE IF EXISTS {qualified}"),
            None,
            1,
            Some("dbo"),
        )
        .await;

    result.expect("live SQL Server workflow must succeed");
    cleanup.expect("test table must be removed");
}
