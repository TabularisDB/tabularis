//! Fixture-based tests for the foreign-app importers. Each writes a synthetic
//! copy of the source app's config to a temp dir and asserts the parsed result.
//! Credential paths that need the OS Keychain / decryption keys are exercised
//! with `include_passwords = false` (metadata only).

use std::fs;
use std::path::PathBuf;

use super::beekeeper::BeekeeperImporter;
use super::datagrip::DataGripImporter;
use super::dbeaver::DBeaverImporter;
use super::sequelace::SequelAceImporter;
use super::tableplus::TablePlusImporter;
use super::ForeignAppImporter;

fn write(path: &PathBuf, contents: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

#[tokio::test]
async fn dbeaver_parses_data_sources() {
    let tmp = tempfile::tempdir().unwrap();
    let ds = tmp
        .path()
        .join("workspace6/General/.dbeaver/data-sources.json");
    write(
        &ds,
        r#"{
          "connections": {
            "pg-1": {
              "name": "Prod",
              "provider": "postgresql",
              "folder": "Work",
              "configuration": {
                "host": "db.example.com",
                "port": 6543,
                "database": "app",
                "user": "postgres"
              }
            }
          },
          "folders": { "Work": {} }
        }"#,
    );

    let importer = DBeaverImporter::with_data_root(tmp.path().to_path_buf());
    assert!(importer.is_available().await);
    assert_eq!(importer.connection_count().await, 1);

    let env = importer.import(false, None).await.unwrap();
    assert_eq!(env.connections.len(), 1);
    let c = &env.connections[0];
    assert_eq!(c.name, "Prod");
    assert_eq!(c.host, "db.example.com");
    assert_eq!(c.port, 6543);
    assert_eq!(c.database, "app");
    assert_eq!(c.username, "postgres");
    assert_eq!(c.driver_label, "PostgreSQL");
    assert_eq!(c.group_name.as_deref(), Some("Work"));
}

#[tokio::test]
async fn tableplus_parses_plist() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("Data");
    write(
        &data_dir.join("Connections.plist"),
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>ConnectionName</key><string>Local PG</string>
    <key>Driver</key><string>PostgreSQL</string>
    <key>DatabaseHost</key><string>localhost</string>
    <key>DatabasePort</key><string>5433</string>
    <key>DatabaseUser</key><string>me</string>
    <key>DatabaseName</key><string>mydb</string>
    <key>ID</key><string>ABC</string>
  </dict>
</array>
</plist>"#,
    );

    let importer = TablePlusImporter::with_data_dir(data_dir);
    assert_eq!(importer.connection_count().await, 1);

    let env = importer.import(false, None).await.unwrap();
    let c = &env.connections[0];
    assert_eq!(c.name, "Local PG");
    assert_eq!(c.driver_label, "PostgreSQL");
    assert_eq!(c.port, 5433);
    assert_eq!(c.database, "mydb");
    assert_eq!(c.username, "me");
}

#[tokio::test]
async fn datagrip_parses_xml() {
    let tmp = tempfile::tempdir().unwrap();
    let ds = tmp
        .path()
        .join("DataGrip2024.3/options/dataSources.xml");
    write(
        &ds,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl">
    <data-source name="Reporting" uuid="u-1">
      <driver-ref>postgresql</driver-ref>
      <jdbc-url>jdbc:postgresql://reports.db:5432/analytics</jdbc-url>
      <user-name>analyst</user-name>
    </data-source>
  </component>
</project>"#,
    );

    let importer = DataGripImporter::with_root(tmp.path().to_path_buf());
    assert!(importer.is_available().await);

    let env = importer.import(false, None).await.unwrap();
    assert_eq!(env.connections.len(), 1);
    let c = &env.connections[0];
    assert_eq!(c.name, "Reporting");
    assert_eq!(c.host, "reports.db");
    assert_eq!(c.port, 5432);
    assert_eq!(c.database, "analytics");
    assert_eq!(c.username, "analyst");
    assert_eq!(c.driver_label, "PostgreSQL");
}

#[tokio::test]
async fn sequelace_parses_favorites_plist() {
    let tmp = tempfile::tempdir().unwrap();
    let plist = tmp.path().join("Favorites.plist");
    write(
        &plist,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Favorites Root</key>
  <dict>
    <key>Children</key>
    <array>
      <dict>
        <key>Name</key><string>Work</string>
        <key>Children</key>
        <array>
          <dict>
            <key>name</key><string>Shop DB</string>
            <key>host</key><string>db.example.com</string>
            <key>port</key><integer>3307</integer>
            <key>database</key><string>shop</string>
            <key>user</key><string>appuser</string>
            <key>type</key><integer>0</integer>
            <key>useSSL</key><integer>1</integer>
            <key>sslCACertFileLocation</key><string>/certs/ca.pem</string>
          </dict>
        </array>
      </dict>
      <dict>
        <key>name</key><string>Tunneled</string>
        <key>host</key><string>127.0.0.1</string>
        <key>port</key><string>3306</string>
        <key>database</key><string>main</string>
        <key>user</key><string>root</string>
        <key>type</key><integer>2</integer>
        <key>sshHost</key><string>bastion</string>
        <key>sshPort</key><integer>2222</integer>
        <key>sshUser</key><string>deploy</string>
        <key>sshKeyLocationEnabled</key><integer>1</integer>
        <key>sshKeyLocation</key><string>/home/u/.ssh/id_ed25519</string>
      </dict>
    </array>
  </dict>
</dict>
</plist>"#,
    );

    let importer = SequelAceImporter::with_favorites(plist);
    assert!(importer.is_available().await);
    assert_eq!(importer.connection_count().await, 2);

    let env = importer.import(false, None).await.unwrap();
    assert_eq!(env.connections.len(), 2);

    // Grouped connection: fields, MySQL default driver, SSL mapped, group name.
    let shop = env.connections.iter().find(|c| c.name == "Shop DB").unwrap();
    assert_eq!(shop.host, "db.example.com");
    assert_eq!(shop.port, 3307);
    assert_eq!(shop.database, "shop");
    assert_eq!(shop.username, "appuser");
    assert_eq!(shop.driver_label, "MySQL");
    assert_eq!(shop.group_name.as_deref(), Some("Work"));
    assert!(shop.ssh.is_none());
    let ssl = shop.ssl.as_ref().unwrap();
    assert_eq!(ssl.mode, "require");
    assert_eq!(ssl.ca_certificate_path.as_deref(), Some("/certs/ca.pem"));

    // Top-level SSH connection (type 2), port given as a string.
    let tun = env.connections.iter().find(|c| c.name == "Tunneled").unwrap();
    assert_eq!(tun.port, 3306);
    assert!(tun.group_name.is_none());
    let ssh = tun.ssh.as_ref().unwrap();
    assert_eq!(ssh.host, "bastion");
    assert_eq!(ssh.port, Some(2222));
    assert_eq!(ssh.username, "deploy");
    assert_eq!(ssh.auth_type, "ssh_key");
    assert!(ssh
        .private_key_path
        .as_deref()
        .unwrap()
        .ends_with("id_ed25519"));
}

#[tokio::test]
async fn beekeeper_reads_sqlite() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("app.db");

    // Seed a minimal Beekeeper-shaped database.
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE saved_connection (
            id INTEGER PRIMARY KEY, name TEXT, connectionType TEXT, host TEXT, port INTEGER,
            username TEXT, defaultDatabase TEXT, password TEXT, ssl INTEGER, sslCaFile TEXT,
            sslCertFile TEXT, sslKeyFile TEXT, sslRejectUnauthorized INTEGER,
            trustServerCertificate INTEGER, sshEnabled INTEGER, sshHost TEXT, sshPort INTEGER,
            sshUsername TEXT, sshMode TEXT, sshKeyfile TEXT, sshKeyfilePassword TEXT,
            sshPassword TEXT, sshBastionHost TEXT, sshBastionHostPort INTEGER,
            sshBastionUsername TEXT, sshBastionMode TEXT, sshBastionKeyfile TEXT,
            labelColor TEXT, connectionFolderId INTEGER, workspaceId INTEGER )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO saved_connection (name, connectionType, host, port, username, defaultDatabase, ssl, sshEnabled, workspaceId)
         VALUES ('Staging', 'mysql', 'mysql.local', 3307, 'root', 'shop', 0, 0, -1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let importer = BeekeeperImporter::with_data_dir(tmp.path().to_path_buf());
    assert!(importer.is_available().await);
    assert_eq!(importer.connection_count().await, 1);

    let env = importer.import(false, None).await.unwrap();
    let c = &env.connections[0];
    assert_eq!(c.name, "Staging");
    assert_eq!(c.driver_label, "MySQL");
    assert_eq!(c.host, "mysql.local");
    assert_eq!(c.port, 3307);
    assert_eq!(c.database, "shop");
    assert_eq!(c.username, "root");
}
