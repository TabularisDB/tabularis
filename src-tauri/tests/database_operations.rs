//! Destructive integration tests, restricted to explicitly enabled disposable servers.
//! TABULARIS_TEST_DATABASE_OPERATIONS=1 POSTGRES_PLUGIN_BIN=/absolute/path ... --ignored
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tabularis_lib::{
    database_operations::DatabaseOperation,
    drivers::{driver_trait::DatabaseDriver, mysql::MysqlDriver, postgres::PostgresDriver},
    models::{ConnectionParams, DatabaseSelection},
    plugins::driver::RpcDriver,
};

fn params(driver: &str, port: u16) -> ConnectionParams {
    assert_eq!(
        std::env::var("TABULARIS_TEST_DATABASE_OPERATIONS").as_deref(),
        Ok("1"),
        "Explicit disposable-server opt-in is required"
    );
    serde_json::from_value(serde_json::json!({"driver":driver,"host":"127.0.0.1","port":port,"username":if driver=="mysql" {"root"} else {"postgres"},"password":"tabularis827","database":if driver=="mysql" {"mysql"} else {"postgres"},"ssl_mode":"disable"})).unwrap()
}

async fn query(
    driver: &dyn DatabaseDriver,
    p: &ConnectionParams,
    sql: &str,
) -> tabularis_lib::models::QueryResult {
    driver
        .execute_query(p, sql, None, 1, None)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

async fn mysql(port: u16) {
    sqlx::any::install_default_drivers();
    let driver = MysqlDriver::new();
    let admin = params("mysql", port);
    let name = format!("t827_{}_` db", uuid::Uuid::new_v4().simple());
    let quoted = format!("`{}`", name.replace('`', "``"));
    query(&driver, &admin, &format!("CREATE DATABASE {quoted}")).await;
    let mut p = admin.clone();
    p.database = DatabaseSelection::Single(name.clone());
    for sql in [
        "CREATE TABLE parent (id INTEGER AUTO_INCREMENT PRIMARY KEY)",
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))",
        "INSERT INTO parent VALUES (1)",
        "INSERT INTO child VALUES (1,1)",
        "CREATE VIEW items AS SELECT * FROM parent",
        "CREATE PROCEDURE routine827() SELECT 1",
    ] {
        query(&driver, &p, sql).await;
    }
    sqlx::raw_sql("CREATE EVENT event827 ON SCHEDULE EVERY 1 DAY DO SELECT 1")
        .execute(
            &tabularis_lib::pool_manager::get_mysql_pool(&p)
                .await
                .unwrap(),
        )
        .await
        .unwrap();
    let external_name = format!("{name}_external");
    let external = format!("`{}`", external_name.replace('`', "``"));
    query(&driver, &admin, &format!("CREATE DATABASE {external}")).await;
    query(&driver, &admin, &format!("CREATE TABLE {external}.guard827 (id INTEGER, parent_id INTEGER, FOREIGN KEY(parent_id) REFERENCES {quoted}.parent(id))")).await;
    assert!(driver
        .database_operation(&p, DatabaseOperation::Truncate)
        .await
        .is_err());
    assert_eq!(
        query(&driver, &p, "SELECT count(*) FROM parent").await.rows[0][0].to_string(),
        "1"
    );
    query(&driver, &admin, &format!("DROP DATABASE {external}")).await;
    if port == 53328 {
        query(
            &driver,
            &p,
            "CREATE TABLE history827 (id INTEGER) WITH SYSTEM VERSIONING",
        )
        .await;
        assert!(driver
            .database_operation(&p, DatabaseOperation::Truncate)
            .await
            .is_err());
        assert_eq!(
            query(&driver, &p, "SELECT count(*) FROM parent").await.rows[0][0].to_string(),
            "1"
        );
        query(&driver, &p, "DROP TABLE history827").await;
        query(&driver, &p, "CREATE SEQUENCE sequence827 START WITH 5").await;
    }

    driver
        .database_operation(&p, DatabaseOperation::Truncate)
        .await
        .unwrap();
    assert_eq!(
        query(&driver, &p, "SELECT count(*) AS n FROM parent")
            .await
            .rows[0][0]
            .to_string(),
        "0"
    );
    assert_eq!(
        query(&driver, &p, "SELECT count(*) AS n FROM child")
            .await
            .rows[0][0]
            .to_string(),
        "0"
    );
    assert_eq!(driver.get_views(&p, None).await.unwrap().len(), 1);
    assert_eq!(driver.get_routines(&p, None).await.unwrap().len(), 1);
    query(&driver, &p, "INSERT INTO parent VALUES (NULL)").await;
    assert_eq!(
        query(&driver, &p, "SELECT id FROM parent").await.rows[0][0].to_string(),
        "1"
    );
    if port == 53328 {
        query(
            &driver,
            &p,
            "CREATE TABLE history827 (id INTEGER) WITH SYSTEM VERSIONING",
        )
        .await;
    }
    driver
        .database_operation(&p, DatabaseOperation::Empty)
        .await
        .unwrap();
    assert!(driver.get_tables(&p, None).await.unwrap().is_empty());
    assert_eq!(
        query(
            &driver,
            &p,
            "SELECT count(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
        )
        .await
        .rows[0][0]
            .to_string(),
        "0"
    );
    assert!(driver.get_views(&p, None).await.unwrap().is_empty());
    assert!(driver.get_routines(&p, None).await.unwrap().is_empty());
    assert_eq!(
        query(
            &driver,
            &p,
            "SELECT count(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()"
        )
        .await
        .rows[0][0]
            .to_string(),
        "0"
    );
    driver
        .database_operation(&p, DatabaseOperation::Empty)
        .await
        .unwrap();
    driver
        .database_operation(&p, DatabaseOperation::Truncate)
        .await
        .unwrap();
    let mut readonly = p.clone();
    readonly.read_only = true;
    for op in [
        DatabaseOperation::Empty,
        DatabaseOperation::Truncate,
        DatabaseOperation::Drop,
    ] {
        assert!(driver.database_operation(&readonly, op).await.is_err());
    }
    driver
        .database_operation(&p, DatabaseOperation::Drop)
        .await
        .unwrap();
    assert!(!driver.get_databases(&admin).await.unwrap().contains(&name));
    assert!(driver
        .database_operation(&admin, DatabaseOperation::Empty)
        .await
        .is_err());
}

#[tokio::test]
#[ignore = "requires disposable MySQL on 53327"]
async fn mysql_all_database_operations() {
    mysql(53327).await;
}
#[tokio::test]
#[ignore = "requires disposable MariaDB on 53328"]
async fn mariadb_all_database_operations() {
    mysql(53328).await;
}

async fn postgres(plugin: bool) {
    let admin = params("postgres", 55427);
    let builtin = PostgresDriver::new();
    let driver: Arc<dyn DatabaseDriver> = if plugin {
        let mut manifest = builtin.manifest().clone();
        manifest.id = "postgresql".into();
        manifest.is_builtin = false;
        Arc::new(
            RpcDriver::new(
                manifest,
                PathBuf::from(
                    std::env::var("POSTGRES_PLUGIN_BIN").expect("plugin binary required"),
                ),
                None,
                vec![],
                HashMap::new(),
            )
            .await
            .unwrap(),
        )
    } else {
        Arc::new(PostgresDriver::new())
    };
    let name = format!("t827_{}_\" db", uuid::Uuid::new_v4().simple());
    query(
        &builtin,
        &admin,
        &format!("CREATE DATABASE \"{}\"", name.replace('"', "\"\"")),
    )
    .await;
    let mut p = admin.clone();
    p.database = DatabaseSelection::Single(name.clone());
    for sql in ["CREATE SCHEMA other", "CREATE TABLE public.parent (id SERIAL PRIMARY KEY)", "CREATE TABLE other.child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES public.parent(id))", "INSERT INTO public.parent DEFAULT VALUES", "INSERT INTO other.child VALUES (1,1)", "CREATE VIEW public.items AS SELECT * FROM public.parent", "CREATE FUNCTION other.f827() RETURNS INTEGER LANGUAGE SQL AS 'SELECT 1'", "CREATE TYPE other.color AS ENUM ('red','blue')"] { query(driver.as_ref(), &p, sql).await; }
    query(driver.as_ref(), &p, "CREATE FUNCTION other.block_truncate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'blocked'; END$$").await;
    query(driver.as_ref(), &p, "CREATE TRIGGER stop827 BEFORE TRUNCATE ON other.child FOR EACH STATEMENT EXECUTE FUNCTION other.block_truncate()").await;
    assert!(driver
        .database_operation(&p, DatabaseOperation::Truncate)
        .await
        .is_err());
    assert_eq!(
        query(driver.as_ref(), &p, "SELECT count(*) FROM public.parent")
            .await
            .rows[0][0]
            .to_string(),
        "1"
    );
    query(driver.as_ref(), &p, "DROP TRIGGER stop827 ON other.child").await;
    query(driver.as_ref(), &p, "DROP FUNCTION other.block_truncate()").await;
    driver
        .database_operation(&p, DatabaseOperation::Truncate)
        .await
        .unwrap();
    assert_eq!(
        query(driver.as_ref(), &p, "SELECT count(*) FROM public.parent")
            .await
            .rows[0][0]
            .to_string(),
        "0"
    );
    assert_eq!(
        query(driver.as_ref(), &p, "SELECT count(*) FROM other.child")
            .await
            .rows[0][0]
            .to_string(),
        "0"
    );
    assert_eq!(driver.get_views(&p, Some("public")).await.unwrap().len(), 1);
    query(
        driver.as_ref(),
        &p,
        "INSERT INTO public.parent DEFAULT VALUES",
    )
    .await;
    assert_eq!(
        query(driver.as_ref(), &p, "SELECT id FROM public.parent")
            .await
            .rows[0][0]
            .to_string(),
        "1"
    );
    driver
        .database_operation(&p, DatabaseOperation::Empty)
        .await
        .unwrap();
    assert!(driver
        .get_tables(&p, Some("public"))
        .await
        .unwrap()
        .is_empty());
    assert!(driver
        .get_views(&p, Some("public"))
        .await
        .unwrap()
        .is_empty());
    assert!(driver
        .get_routines(&p, Some("other"))
        .await
        .unwrap()
        .is_empty());
    assert_eq!(query(driver.as_ref(), &p, "SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='other' AND t.typname='color'").await.rows[0][0].to_string(), "0");
    driver
        .database_operation(&p, DatabaseOperation::Empty)
        .await
        .unwrap();
    driver
        .database_operation(&p, DatabaseOperation::Truncate)
        .await
        .unwrap();
    let mut readonly = p.clone();
    readonly.read_only = true;
    for op in [
        DatabaseOperation::Empty,
        DatabaseOperation::Truncate,
        DatabaseOperation::Drop,
    ] {
        assert!(driver.database_operation(&readonly, op).await.is_err());
    }
    // The fixture's built-in verification client must release its target pool too.
    tabularis_lib::pool_manager::close_pool(&p).await;
    driver
        .database_operation(&p, DatabaseOperation::Drop)
        .await
        .unwrap();
    assert!(!builtin.get_databases(&admin).await.unwrap().contains(&name));
    assert!(driver
        .database_operation(&admin, DatabaseOperation::Drop)
        .await
        .is_err());
    driver.shutdown().await;
}
#[tokio::test]
#[ignore = "requires disposable PostgreSQL on 55427"]
async fn postgres_builtin_all_database_operations() {
    postgres(false).await;
}
#[tokio::test]
#[ignore = "requires disposable PostgreSQL and plugin binary"]
async fn postgres_plugin_all_database_operations() {
    postgres(true).await;
}
