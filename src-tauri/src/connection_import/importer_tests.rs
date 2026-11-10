//! Fixture-based tests for the foreign-app importers. Each writes a synthetic
//! copy of the source app's config to a temp dir and asserts the parsed result.
//! Credential paths that need the OS Keychain / decryption keys are exercised
//! with `include_passwords = false` (metadata only).

use std::fs;
use std::path::{Path, PathBuf};

use super::beekeeper::BeekeeperImporter;
use super::datagrip::DataGripImporter;
use super::dbeaver::DBeaverImporter;
use super::heidisql::HeidiSqlImporter;
use super::mysql_workbench::MySqlWorkbenchImporter;
use super::navicat::NavicatImporter;
use super::sequelace::SequelAceImporter;
use super::tableplus::TablePlusImporter;
use super::{
    importer_by_id, ForeignAppImporter, ForeignImportError, ImportEnvelope, ImportedConnection,
};

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
async fn tableplus_import_accepts_manual_data_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("Moved/TablePlus/Data");
    write(
        &data_dir.join("Connections.plist"),
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>ConnectionName</key><string>Moved PG</string>
    <key>Driver</key><string>PostgreSQL</string>
    <key>DatabaseHost</key><string>db.local</string>
    <key>DatabasePort</key><integer>5432</integer>
    <key>DatabaseUser</key><string>dev</string>
    <key>DatabaseName</key><string>app</string>
  </dict>
</array>
</plist>"#,
    );

    let importer = TablePlusImporter::default();
    let env = importer.import(false, Some(&data_dir)).await.unwrap();
    let c = &env.connections[0];
    assert_eq!(c.name, "Moved PG");
    assert_eq!(c.host, "db.local");
    assert_eq!(c.database, "app");
}

#[tokio::test]
async fn datagrip_parses_xml() {
    let tmp = tempfile::tempdir().unwrap();
    let ds = tmp.path().join("DataGrip2024.3/options/dataSources.xml");
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
async fn datagrip_normalizes_raw_ssl_mode() {
    let tmp = tempfile::tempdir().unwrap();
    let ds = tmp.path().join("DataGrip2024.3/options/dataSources.xml");
    write(
        &ds,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl">
    <data-source name="Secure" uuid="u-2">
      <driver-ref>postgresql</driver-ref>
      <jdbc-url>jdbc:postgresql://secure.db:5432/app</jdbc-url>
      <ssl-config>
        <enabled>true</enabled>
        <mode>VERIFY_CA</mode>
        <ca-cert>/certs/ca.pem</ca-cert>
      </ssl-config>
    </data-source>
  </component>
</project>"#,
    );

    let importer = DataGripImporter::with_root(tmp.path().to_path_buf());
    let env = importer.import(false, None).await.unwrap();
    let ssl = env.connections[0].ssl.as_ref().expect("ssl parsed");
    assert_eq!(ssl.mode, "verify-ca");
    assert_eq!(ssl.ca_certificate_path.as_deref(), Some("/certs/ca.pem"));
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
    let shop = env
        .connections
        .iter()
        .find(|c| c.name == "Shop DB")
        .unwrap();
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
    let tun = env
        .connections
        .iter()
        .find(|c| c.name == "Tunneled")
        .unwrap();
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

const HEIDISQL_EXPORT: &str = r#"FontName<|||>1<|||>Tahoma
Servers\Customers\Folder<|||>3<|||>1
Servers\Customers\Production\Host<|||>1<|||>db.example.com
Servers\Customers\Production\Port<|||>3<|||>3306
Servers\Customers\Production\User<|||>1<|||>app
Servers\Customers\Production\Password<|||>1<|||>5B2A7C41D3
Servers\Customers\Production\NetType<|||>3<|||>0
Servers\Customers\Production\Databases<|||>1<|||>shop;billing
Servers\Customers\EU\Folder<|||>3<|||>1
Servers\Customers\EU\Analytics\Host<|||>1<|||>127.0.0.1
Servers\Customers\EU\Analytics\Port<|||>3<|||>5432
Servers\Customers\EU\Analytics\User<|||>1<|||>reader
Servers\Customers\EU\Analytics\NetType<|||>3<|||>9
Servers\Customers\EU\Analytics\Databases<|||>1<|||>warehouse
Servers\Customers\EU\Analytics\SSHtunnelHost<|||>1<|||>bastion.example.com
Servers\Customers\EU\Analytics\SSHtunnelHostPort<|||>3<|||>2222
Servers\Customers\EU\Analytics\SSHtunnelUser<|||>1<|||>deploy
Servers\Customers\EU\Analytics\SSHtunnelPrivateKey<|||>1<|||>/keys/id_ed25519
Servers\Jump host\Host<|||>1<|||>10.0.0.5
Servers\Jump host\NetType<|||>3<|||>2
Servers\Jump host\SSHtunnelHost<|||>1<|||>10.0.0.1
Servers\Jump host\SSHtunnelUser<|||>1<|||>ops
Servers\Reports\Host<|||>1<|||>10.0.0.7
Servers\Reports\Port<|||>3<|||>1433
Servers\Reports\User<|||>1<|||>sa
Servers\Reports\NetType<|||>3<|||>4
Servers\Local file\Host<|||>1<|||>C:\data\app.db|C:\data\extra.db
Servers\Local file\NetType<|||>3<|||>10
Servers\Pipe\Host<|||>1<|||>.
Servers\Pipe\NetType<|||>3<|||>1
Servers\Warehouse\Host<|||>1<|||>10.0.0.9
Servers\Warehouse\NetType<|||>3<|||>14
"#;

async fn import_heidisql(
    contents: &str,
    include_passwords: bool,
) -> Result<ImportEnvelope, ForeignImportError> {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("portable_settings.txt");
    write(&file, contents);
    HeidiSqlImporter::default()
        .import(include_passwords, Some(&file))
        .await
}

fn heidisql_connection<'a>(env: &'a ImportEnvelope, name: &str) -> &'a ImportedConnection {
    env.connections
        .iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no imported connection named {name}"))
}

#[tokio::test]
async fn heidisql_parses_sessions_into_connections() {
    let env = import_heidisql(HEIDISQL_EXPORT, false).await.unwrap();
    assert_eq!(env.source_name, "HeidiSQL");

    let prod = heidisql_connection(&env, "Production");
    assert_eq!(prod.host, "db.example.com");
    assert_eq!(prod.port, 3306);
    assert_eq!(prod.username, "app");
    assert_eq!(prod.database, "shop");
    assert_eq!(prod.driver_label, "MySQL");
    assert_eq!(prod.group_name.as_deref(), Some("Customers"));
    assert!(prod.ssh.is_none());

    let top_level = heidisql_connection(&env, "Reports");
    assert!(top_level.group_name.is_none());
}

#[tokio::test]
async fn heidisql_treats_folder_entries_as_groups_not_connections() {
    let env = import_heidisql(HEIDISQL_EXPORT, false).await.unwrap();

    let analytics = heidisql_connection(&env, "Analytics");
    assert_eq!(analytics.group_name.as_deref(), Some("EU"));
    let mut groups = env.group_names.clone();
    groups.sort_unstable();
    assert_eq!(groups, ["Customers", "EU"]);
    assert!(env
        .connections
        .iter()
        .all(|c| c.name != "EU" && c.name != "Customers"));
}

#[tokio::test]
async fn heidisql_maps_net_types_to_drivers() {
    let env = import_heidisql(HEIDISQL_EXPORT, false).await.unwrap();

    let analytics = heidisql_connection(&env, "Analytics");
    assert_eq!(analytics.driver_label, "PostgreSQL");
    assert_eq!(analytics.port, 5432);
    assert_eq!(analytics.database, "warehouse");

    let reports = heidisql_connection(&env, "Reports");
    assert_eq!(reports.driver_label, "SQL Server");
    assert_eq!(reports.host, "10.0.0.7");
    assert_eq!(reports.port, 1433);
    assert_eq!(reports.username, "sa");

    let local = heidisql_connection(&env, "Local file");
    assert_eq!(local.driver_label, "SQLite");
    assert_eq!(local.database, r"C:\data\app.db");
    assert!(local.host.is_empty());
    assert_eq!(local.port, 0);
}

#[tokio::test]
async fn heidisql_skips_unsupported_net_types() {
    let env = import_heidisql(HEIDISQL_EXPORT, false).await.unwrap();

    let mut names: Vec<&str> = env.connections.iter().map(|c| c.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "Analytics",
            "Jump host",
            "Local file",
            "Production",
            "Reports"
        ]
    );
}

#[tokio::test]
async fn heidisql_imports_ssh_tunnel_settings() {
    let env = import_heidisql(HEIDISQL_EXPORT, false).await.unwrap();

    let keyed = heidisql_connection(&env, "Analytics").ssh.as_ref().unwrap();
    assert_eq!(keyed.host, "bastion.example.com");
    assert_eq!(keyed.port, Some(2222));
    assert_eq!(keyed.username, "deploy");
    assert_eq!(keyed.auth_type, "ssh_key");
    assert_eq!(keyed.private_key_path.as_deref(), Some("/keys/id_ed25519"));

    let jump = heidisql_connection(&env, "Jump host");
    assert_eq!(jump.driver_label, "MySQL");
    assert_eq!(jump.port, 3306);
    let ssh = jump.ssh.as_ref().unwrap();
    assert_eq!(ssh.host, "10.0.0.1");
    assert_eq!(ssh.port, None);
    assert_eq!(ssh.username, "ops");
    assert_eq!(ssh.auth_type, "password");
    assert!(ssh.private_key_path.is_none());
}

#[tokio::test]
async fn heidisql_imports_ssh_for_rds_sessions() {
    let export = "Servers\\Aurora\\Host<|||>1<|||>aurora.internal\n\
                  Servers\\Aurora\\NetType<|||>3<|||>16\n\
                  Servers\\Aurora\\SSHtunnelHost<|||>1<|||>bastion.example.com\n\
                  Servers\\Aurora\\SSHtunnelUser<|||>1<|||>ec2-user\n";
    let env = import_heidisql(export, false).await.unwrap();

    let aurora = heidisql_connection(&env, "Aurora");
    assert_eq!(aurora.driver_label, "MySQL");
    let ssh = aurora.ssh.as_ref().expect("RDS sessions tunnel by default");
    assert_eq!(ssh.host, "bastion.example.com");
    assert_eq!(ssh.username, "ec2-user");
}

#[tokio::test]
async fn heidisql_imports_ssh_for_sql_server_when_active() {
    let export = "Servers\\Billing\\Host<|||>1<|||>10.0.0.8\n\
                  Servers\\Billing\\NetType<|||>3<|||>4\n\
                  Servers\\Billing\\SSHtunnelActive<|||>3<|||>1\n\
                  Servers\\Billing\\SSHtunnelHost<|||>1<|||>jump.example.com\n\
                  Servers\\Billing\\SSHtunnelHostPort<|||>3<|||>2200\n\
                  Servers\\Billing\\SSHtunnelUser<|||>1<|||>ops\n";
    let env = import_heidisql(export, false).await.unwrap();

    let billing = heidisql_connection(&env, "Billing");
    assert_eq!(billing.driver_label, "SQL Server");
    let ssh = billing.ssh.as_ref().expect("SSHtunnelActive=1 enables SSH");
    assert_eq!(ssh.host, "jump.example.com");
    assert_eq!(ssh.port, Some(2200));
    assert_eq!(ssh.username, "ops");

    // Without the flag a SQL Server session stays direct.
    let env = import_heidisql(HEIDISQL_EXPORT, false).await.unwrap();
    assert!(heidisql_connection(&env, "Reports").ssh.is_none());
}

#[tokio::test]
async fn heidisql_honors_ssh_tunnel_active_off_on_tunnel_types() {
    let export = "Servers\\Jump\\Host<|||>1<|||>10.0.0.5\n\
                  Servers\\Jump\\NetType<|||>3<|||>2\n\
                  Servers\\Jump\\SSHtunnelActive<|||>3<|||>0\n\
                  Servers\\Jump\\SSHtunnelHost<|||>1<|||>10.0.0.1\n";
    let env = import_heidisql(export, false).await.unwrap();

    assert!(heidisql_connection(&env, "Jump").ssh.is_none());
}

#[tokio::test]
async fn heidisql_skips_entries_without_host_or_net_type() {
    let export = "Servers\\Prod\\Host<|||>1<|||>db.example.com\n\
                  Servers\\Prod\\NetType<|||>3<|||>0\n\
                  Servers\\Prod\\Extra\\Comment<|||>1<|||>nested sub-key\n";
    let env = import_heidisql(export, false).await.unwrap();

    assert_eq!(env.connections.len(), 1);
    assert_eq!(env.connections[0].name, "Prod");
    assert_eq!(env.connections[0].host, "db.example.com");
}

#[tokio::test]
async fn heidisql_never_imports_passwords() {
    let env = import_heidisql(HEIDISQL_EXPORT, true).await.unwrap();

    assert_eq!(env.connections.len(), 5);
    assert!(env.credentials_by_index.is_empty());
    assert!(!env.credentials_aborted);
}

#[tokio::test]
async fn heidisql_reads_bom_and_crlf_exports() {
    let export = format!("\u{feff}{}", HEIDISQL_EXPORT.replace('\n', "\r\n"));
    let env = import_heidisql(&export, false).await.unwrap();

    assert_eq!(env.connections.len(), 5);
    assert_eq!(heidisql_connection(&env, "Production").database, "shop");
}

#[tokio::test]
async fn heidisql_reads_ports_whatever_the_integer_type_code() {
    for type_code in ["3", "4"] {
        let export = format!(
            "Servers\\Dev\\Host<|||>1<|||>10.0.0.2\nServers\\Dev\\Port<|||>{type_code}<|||>3307\n"
        );
        let env = import_heidisql(&export, false).await.unwrap();
        assert_eq!(env.connections[0].port, 3307, "type code {type_code}");
    }
}

#[tokio::test]
async fn heidisql_rejects_files_that_are_not_settings_exports() {
    let err = import_heidisql("just some notes\n", false)
        .await
        .unwrap_err();
    assert!(
        matches!(err, ForeignImportError::UnsupportedFormat(_)),
        "{err:?}"
    );

    let err = import_heidisql("FontName<|||>1<|||>Tahoma\n", false)
        .await
        .unwrap_err();
    assert!(
        matches!(err, ForeignImportError::NoConnectionsFound),
        "{err:?}"
    );
}

#[tokio::test]
async fn heidisql_requires_a_picked_file() {
    let err = HeidiSqlImporter::default()
        .import(false, None)
        .await
        .unwrap_err();
    assert!(
        matches!(err, ForeignImportError::FileNotFound(_)),
        "{err:?}"
    );
}

#[tokio::test]
async fn heidisql_is_registered_as_a_file_importer() {
    let importer = importer_by_id("heidisql").expect("heidisql is registered");
    assert_eq!(importer.display_name(), "HeidiSQL");
    assert_eq!(importer.import_file_types(), Some(vec!["txt"]));
    assert!(!importer.is_available().await);
    assert!(!importer.reads_passwords_from_keychain());
}

const WORKBENCH_CONNECTIONS: &str = r#"<?xml version="1.0"?>
<data grt_format="2.0">
  <value type="list" content-type="object" content-struct-name="db.mgmt.Connection">
    <value type="object" struct-name="db.mgmt.Connection" id="00000000-0000-0000-0000-000000000001">
      <link type="object" struct-name="db.mgmt.Driver" key="driver">com.mysql.rdbms.mysql.driver.native</link>
      <value type="dict" key="parameterValues">
        <value type="string" key="hostName">db.example.com</value>
        <value type="int" key="port">3307</value>
        <value type="string" key="schema">shop</value>
        <value type="string" key="sslCA">/certs/ca.pem</value>
        <value type="int" key="useSSL">3</value>
        <value type="string" key="userName">app</value>
      </value>
      <value type="string" key="name">Local &amp; staging</value>
    </value>
    <value type="object" struct-name="db.mgmt.Connection" id="00000000-0000-0000-0000-000000000002">
      <link type="object" struct-name="db.mgmt.Driver" key="driver">com.mysql.rdbms.mysql.driver.native_sshtun</link>
      <value type="dict" key="parameterValues">
        <value type="string" key="hostName">10.0.0.12</value>
        <value type="int" key="port">3306</value>
        <value type="string" key="sshHost">bastion.example.com:2222</value>
        <value type="string" key="sshKeyFile">/keys/deploy</value>
        <value type="string" key="sshUserName">deploy</value>
        <value type="int" key="useSSL">0</value>
        <value type="string" key="userName">deploy</value>
      </value>
      <value type="string" key="name">Via bastion</value>
    </value>
    <value type="object" struct-name="db.mgmt.Connection" id="00000000-0000-0000-0000-000000000004">
      <link type="object" struct-name="db.mgmt.Driver" key="driver">com.mysql.rdbms.mysql.driver.native_sshtun</link>
      <value type="dict" key="parameterValues">
        <value type="string" key="hostName">10.0.0.13</value>
        <value type="string" key="sshHost"></value>
        <value type="string" key="userName">deploy</value>
      </value>
      <value type="string" key="name">Tunnel without SSH host</value>
    </value>
    <value type="object" struct-name="db.mgmt.Connection" id="00000000-0000-0000-0000-000000000003">
      <link type="object" struct-name="db.mgmt.Driver" key="driver">com.mysql.rdbms.mysql.driver.native_socket</link>
      <value type="dict" key="parameterValues">
        <value type="string" key="socket">/tmp/mysql.sock</value>
        <value type="string" key="userName">root</value>
      </value>
      <value type="string" key="name">Local socket</value>
    </value>
  </value>
</data>"#;

#[tokio::test]
async fn mysql_workbench_parses_connections_xml() {
    let tmp = tempfile::tempdir().unwrap();
    write(&tmp.path().join("connections.xml"), WORKBENCH_CONNECTIONS);

    let importer = MySqlWorkbenchImporter::with_data_dir(tmp.path().to_path_buf());
    assert!(importer.is_available().await);
    assert_eq!(importer.connection_count().await, 2);

    let env = importer.import(false, None).await.unwrap();
    assert_eq!(
        env.connections.len(),
        2,
        "the local socket connection and the tunnel without an SSH host are skipped"
    );

    let direct = &env.connections[0];
    assert_eq!(direct.name, "Local & staging");
    assert_eq!(direct.host, "db.example.com");
    assert_eq!(direct.port, 3307);
    assert_eq!(direct.database, "shop");
    assert_eq!(direct.username, "app");
    assert_eq!(direct.driver_label, "MySQL");
    assert!(direct.ssh.is_none());
    let ssl = direct.ssl.as_ref().unwrap();
    assert_eq!(ssl.mode, "verify_ca");
    assert_eq!(ssl.ca_certificate_path.as_deref(), Some("/certs/ca.pem"));
    assert!(ssl.client_certificate_path.is_none());

    let tunneled = &env.connections[1];
    assert_eq!(tunneled.name, "Via bastion");
    assert_eq!(tunneled.host, "10.0.0.12");
    assert_eq!(tunneled.port, 3306);
    assert!(tunneled.ssl.is_none());
    let ssh = tunneled.ssh.as_ref().unwrap();
    assert_eq!(ssh.host, "bastion.example.com");
    assert_eq!(ssh.port, Some(2222));
    assert_eq!(ssh.username, "deploy");
    assert_eq!(ssh.auth_type, "ssh_key");
    assert_eq!(ssh.private_key_path.as_deref(), Some("/keys/deploy"));
    assert!(env.credentials_by_index.is_empty());
}

#[tokio::test]
async fn mysql_workbench_import_accepts_manual_path() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("Moved/Workbench");
    write(&dir.join("connections.xml"), WORKBENCH_CONNECTIONS);

    let importer = MySqlWorkbenchImporter::default();
    let from_dir = importer.import(false, Some(&dir)).await.unwrap();
    let from_file = importer
        .import(false, Some(&dir.join("connections.xml")))
        .await
        .unwrap();
    assert_eq!(from_dir.connections.len(), 2);
    assert_eq!(from_file.connections.len(), 2);
}

#[tokio::test]
async fn mysql_workbench_reports_missing_and_unusable_files() {
    let tmp = tempfile::tempdir().unwrap();
    let importer = MySqlWorkbenchImporter::with_data_dir(tmp.path().to_path_buf());
    assert!(!importer.is_available().await);
    assert!(matches!(
        importer.import(false, None).await,
        Err(super::ForeignImportError::FileNotFound(_))
    ));

    write(&tmp.path().join("connections.xml"), "not xml");
    assert!(matches!(
        importer.import(false, None).await,
        Err(super::ForeignImportError::ParseError(_))
    ));

    write(
        &tmp.path().join("connections.xml"),
        r#"<?xml version="1.0"?><data grt_format="2.0"><value type="list"/></data>"#,
    );
    assert!(matches!(
        importer.import(false, None).await,
        Err(super::ForeignImportError::NoConnectionsFound)
    ));
}

const NAVICAT_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/connection_import/navicat.ncx"
);

async fn import_navicat_fixture(include_passwords: bool) -> ImportEnvelope {
    NavicatImporter::default()
        .import(include_passwords, Some(Path::new(NAVICAT_FIXTURE)))
        .await
        .unwrap()
}

async fn import_navicat_xml(xml: &str) -> Result<ImportEnvelope, ForeignImportError> {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("connections.ncx");
    write(&path, xml);
    NavicatImporter::default().import(false, Some(&path)).await
}

fn by_name<'a>(env: &'a ImportEnvelope, name: &str) -> &'a ImportedConnection {
    env.connections.iter().find(|c| c.name == name).unwrap()
}

#[tokio::test]
async fn navicat_asks_for_an_ncx_file() {
    let importer = importer_by_id("navicat").expect("navicat is registered");
    assert_eq!(importer.display_name(), "Navicat");
    assert_eq!(importer.import_file_types(), Some(vec!["ncx"]));
    assert!(!importer.is_available().await);
    assert!(!importer.reads_passwords_from_keychain());
}

#[tokio::test]
async fn navicat_maps_every_supported_connection_type() {
    let env = import_navicat_fixture(false).await;
    assert_eq!(env.source_name, "Navicat");

    // (name, driver label, host, port, database, username)
    let expected = [
        (
            "Orders DB",
            "PostgreSQL",
            "10.0.0.5",
            5432,
            "orders",
            "orders",
        ),
        (
            "Shop MySQL",
            "MySQL",
            "db.example.com",
            3306,
            "shop",
            "shop_app",
        ),
        (
            "Legacy MariaDB",
            "MariaDB",
            "10.0.0.12",
            3307,
            "legacy",
            "legacy_ro",
        ),
        (
            "Local Notes",
            "SQLite",
            "",
            0,
            "/home/dev/data/notes.db",
            "",
        ),
        (
            "Warehouse",
            "SQL Server",
            "sql.example.com",
            1433,
            "warehouse",
            "reporting",
        ),
        ("Billing", "Oracle", "10.0.0.20", 1521, "ORCL", "billing"),
        (
            "Events",
            "MongoDB",
            "mongo.example.com",
            27017,
            "events",
            "analyst",
        ),
    ];
    assert_eq!(env.connections.len(), expected.len());
    for (name, label, host, port, database, username) in expected {
        let c = by_name(&env, name);
        assert_eq!(c.driver_label, label, "{name}: driver");
        assert_eq!(c.host, host, "{name}: host");
        assert_eq!(c.port, port, "{name}: port");
        assert_eq!(c.database, database, "{name}: database");
        assert_eq!(c.username, username, "{name}: username");
    }
}

#[tokio::test]
async fn navicat_imports_ssh_only_when_enabled() {
    let env = import_navicat_fixture(false).await;
    assert!(by_name(&env, "Orders DB").ssh.is_none());

    let tunnel = by_name(&env, "Shop MySQL").ssh.as_ref().unwrap();
    assert_eq!(tunnel.host, "bastion.example.com");
    assert_eq!(tunnel.port, Some(2222));
    assert_eq!(tunnel.username, "deploy");
    assert_eq!(tunnel.auth_type, "password");
    assert!(tunnel.private_key_path.is_none());

    let keyed = by_name(&env, "Legacy MariaDB").ssh.as_ref().unwrap();
    assert_eq!(keyed.host, "jump.example.com");
    assert_eq!(keyed.port, Some(22));
    assert_eq!(keyed.username, "ops");
    assert_eq!(keyed.auth_type, "ssh_key");
    assert_eq!(
        keyed.private_key_path.as_deref(),
        Some("/home/dev/.ssh/id_ed25519")
    );
}

#[tokio::test]
async fn navicat_skips_unsupported_connection_types() {
    let env = import_navicat_fixture(false).await;
    assert_eq!(env.connections.len(), 7);
    assert!(env.connections.iter().all(|c| c.name != "Future Store"));
}

#[tokio::test]
async fn navicat_never_imports_passwords() {
    let env = import_navicat_fixture(true).await;
    assert!(env.credentials_by_index.is_empty());
    assert!(!env.credentials_aborted);
}

#[tokio::test]
async fn navicat_tolerates_missing_attributes() {
    let env = import_navicat_xml(
        r#"<Connections><Connection ConnType="mysql" Port="oops"/><Connection ConnectionName="No type"/></Connections>"#,
    )
    .await
    .unwrap();
    assert_eq!(env.connections.len(), 1);
    let c = &env.connections[0];
    assert_eq!(c.name, "Untitled");
    assert_eq!(c.driver_label, "MySQL");
    assert_eq!(c.host, "localhost");
    assert_eq!(c.port, 3306);
    assert_eq!(c.database, "");
    assert_eq!(c.username, "");
    assert!(c.ssh.is_none());
}

#[tokio::test]
async fn navicat_rejects_files_without_usable_connections() {
    let importer = NavicatImporter::default();
    assert!(matches!(
        importer.import(false, None).await,
        Err(ForeignImportError::FileNotFound(_))
    ));
    assert!(matches!(
        importer
            .import(false, Some(Path::new("/nonexistent/connections.ncx")))
            .await,
        Err(ForeignImportError::FileNotFound(_))
    ));
    assert!(matches!(
        import_navicat_xml("<Connections>").await,
        Err(ForeignImportError::ParseError(_))
    ));
    assert!(matches!(
        import_navicat_xml("<plist/>").await,
        Err(ForeignImportError::UnsupportedFormat(_))
    ));
    assert!(matches!(
        import_navicat_xml(
            r#"<Connections><Connection ConnectionName="x" ConnType="FUTUREDB"/></Connections>"#
        )
        .await,
        Err(ForeignImportError::NoConnectionsFound)
    ));
}

// ── Project Configuration Importer Tests ───────────────────────────────────

use super::project_config::ProjectConfigImporter;

#[tokio::test]
async fn project_config_importer_metadata() {
    let importer = ProjectConfigImporter::default();
    assert_eq!(importer.id(), "project_config");
    assert_eq!(
        importer.display_name(),
        "Project Configuration (.env / Compose)"
    );
    assert!(importer.supports_manual_path());
    assert_eq!(
        importer.import_file_types(),
        Some(vec!["env", "yaml", "yml"])
    );
    assert!(!importer.is_available().await);
    assert_eq!(importer.connection_count().await, 0);
}

#[tokio::test]
async fn project_config_env_quoted_values_and_interpolation() {
    let tmp = tempfile::tempdir().unwrap();
    let env_file = tmp.path().join(".env");
    write(
        &env_file,
        r#"
# Comment line
DB_HOST=127.0.0.1 # inline comment
DB_PORT=5432
DB_USER=alice
DB_PASSWORD=secret_password_123
APP_DB="prod_${DB_USER}_db"
SINGLE_QUOTED_DATABASE_URL='postgres://user:p$ssword@db.example.com:5433/app?sslmode=require'
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${APP_DB}"
"#,
    );

    let importer = ProjectConfigImporter::default();
    let env = importer.import(true, Some(tmp.path())).await.unwrap();

    assert!(env.connections.len() >= 2);

    // Verify interpolated DATABASE_URL
    let interpolated = env
        .connections
        .iter()
        .find(|c| c.name.contains("DATABASE_URL") && !c.name.contains("SINGLE_QUOTED"))
        .expect("should find interpolated DATABASE_URL candidate");

    assert_eq!(interpolated.driver_label, "PostgreSQL");
    assert_eq!(interpolated.host, "127.0.0.1");
    assert_eq!(interpolated.port, 5432);
    assert_eq!(interpolated.database, "prod_alice_db");
    assert_eq!(interpolated.username, "alice");

    // Password must be in credentials_by_index and isolated
    let idx = env
        .connections
        .iter()
        .position(|c| std::ptr::eq(c, interpolated))
        .unwrap();
    let creds = env.credentials_by_index.get(&idx).unwrap();
    assert_eq!(creds.password.as_deref(), Some("secret_password_123"));

    // Verify single-quoted URL (no $ expansion in single quotes)
    let single_quoted = env
        .connections
        .iter()
        .find(|c| c.name.contains("SINGLE_QUOTED_DATABASE_URL"))
        .expect("should find SINGLE_QUOTED_DATABASE_URL candidate");
    assert_eq!(single_quoted.database, "app");
    assert_eq!(single_quoted.port, 5433);
    assert_eq!(
        single_quoted.ssl.as_ref().map(|s| s.mode.as_str()),
        Some("require")
    );
}

#[tokio::test]
async fn project_config_cycle_detection_and_missing_variables() {
    let tmp = tempfile::tempdir().unwrap();
    let env_file = tmp.path().join(".env");
    write(
        &env_file,
        r#"
# Circular reference
A="${B}"
B="${A}"
DATABASE_URL="postgres://user:pass@${HOST:-127.0.0.1}:${PORT:-5432}/${A:-default_db}"
"#,
    );

    let importer = ProjectConfigImporter::default();
    let env = importer.import(true, Some(tmp.path())).await.unwrap();

    let conn = env
        .connections
        .iter()
        .find(|c| c.name.contains("DATABASE_URL"))
        .unwrap();

    // Default variable expansion should have resolved
    assert_eq!(conn.host, "127.0.0.1");
    assert_eq!(conn.port, 5432);
    assert_eq!(conn.database, "default_db");

    // Warnings should record the cycle detection for A/B
    assert!(
        conn.warnings
            .iter()
            .any(|w| w.contains("cycle detected") || w.contains("Variable interpolation cycle")),
        "Warnings must contain cycle detection notice"
    );
}

#[tokio::test]
async fn project_config_never_reads_os_process_env() {
    // If OS has an env var like PATH, project config must not read it
    let tmp = tempfile::tempdir().unwrap();
    let env_file = tmp.path().join(".env");
    write(
        &env_file,
        r#"
DATABASE_URL="postgres://user:pass@${PATH:-safe_fallback_host}:5432/mydb"
"#,
    );

    let importer = ProjectConfigImporter::default();
    let env = importer.import(false, Some(tmp.path())).await.unwrap();
    let conn = &env.connections[0];

    // Must use safe_fallback_host, NOT the real OS PATH!
    assert_eq!(conn.host, "safe_fallback_host");
}

#[tokio::test]
async fn project_config_compose_published_vs_container_ports() {
    let tmp = tempfile::tempdir().unwrap();
    let compose_file = tmp.path().join("docker-compose.yml");
    write(
        &compose_file,
        r#"
services:
  postgres_pub:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app_published
      POSTGRES_USER: pguser
      POSTGRES_PASSWORD: secret_pub_password
    ports:
      - "127.0.0.1:5433:5432"

  postgres_unpub:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app_unpublished
      POSTGRES_USER: pguser
      POSTGRES_PASSWORD: secret_unpub_password
    ports:
      - 5432
"#,
    );

    let importer = ProjectConfigImporter::default();
    let env = importer.import(true, Some(tmp.path())).await.unwrap();

    assert_eq!(env.connections.len(), 2);

    let published = env
        .connections
        .iter()
        .find(|c| c.name.contains("postgres_pub"))
        .unwrap();
    assert_eq!(published.host, "127.0.0.1");
    assert_eq!(published.port, 5433);
    assert_eq!(published.database, "app_published");
    assert!(
        !published
            .warnings
            .iter()
            .any(|w| w.contains("not published to host")),
        "Published service should not warn about unpublished endpoint"
    );

    let unpublished = env
        .connections
        .iter()
        .find(|c| c.name.contains("postgres_unpub"))
        .unwrap();
    assert_eq!(unpublished.host, "postgres_unpub");
    assert_eq!(unpublished.port, 5432);
    assert!(
        unpublished
            .warnings
            .iter()
            .any(|w| w.contains("not published to host")),
        "Unpublished service must have an explicit warning"
    );
}

#[tokio::test]
async fn project_config_compose_multiple_published_ports() {
    let tmp = tempfile::tempdir().unwrap();
    let compose_file = tmp.path().join("compose.yaml");
    write(
        &compose_file,
        r#"
services:
  mysql_multi:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: shop
      MYSQL_USER: shop_user
      MYSQL_PASSWORD: shop_password
    ports:
      - "33060:33060"
      - "3307:3306"
"#,
    );

    let importer = ProjectConfigImporter::default();
    let env = importer.import(true, Some(tmp.path())).await.unwrap();

    let mysql_conn = env
        .connections
        .iter()
        .find(|c| c.name.contains("mysql_multi"))
        .unwrap();

    assert_eq!(mysql_conn.driver_label, "MySQL");
    // Should prefer mapping that matches default container port 3306
    assert_eq!(mysql_conn.port, 3307);
    assert!(
        mysql_conn
            .warnings
            .iter()
            .any(|w| w.contains("Multiple published ports")),
        "Multiple published ports must emit a warning"
    );
}

#[tokio::test]
async fn project_config_skips_excluded_dirs_and_symlinks() {
    let tmp = tempfile::tempdir().unwrap();

    // Valid top-level .env
    write(
        &tmp.path().join(".env"),
        "DATABASE_URL=postgres://root:pass@localhost:5432/valid_db\n",
    );

    // .env inside node_modules must be ignored
    let node_modules_env = tmp.path().join("node_modules/pkg/.env");
    write(
        &node_modules_env,
        "DATABASE_URL=postgres://root:pass@localhost:5432/ignored_node_modules\n",
    );

    // .env inside target must be ignored
    let target_env = tmp.path().join("target/debug/.env");
    write(
        &target_env,
        "DATABASE_URL=postgres://root:pass@localhost:5432/ignored_target\n",
    );

    // Symlink file must be ignored
    #[cfg(unix)]
    {
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(
            outside.path(),
            "DATABASE_URL=postgres://root:pass@localhost:5432/symlinked_db\n",
        )
        .unwrap();
        let link_path = tmp.path().join(".env.symlink");
        let _ = std::os::unix::fs::symlink(outside.path(), &link_path);
    }

    let importer = ProjectConfigImporter::default();
    let env = importer.import(false, Some(tmp.path())).await.unwrap();

    // Only valid_db should be found
    assert_eq!(env.connections.len(), 1);
    assert_eq!(env.connections[0].database, "valid_db");
}

#[tokio::test]
async fn project_config_single_file_upload_opaque_filename() {
    let tmp = tempfile::tempdir().unwrap();

    // 1. Opaque single file with .env content
    let opaque_env = tmp.path().join("upload_blob_env");
    write(
        &opaque_env,
        "DATABASE_URL=postgres://env_user:env_pass@127.0.0.1:5432/opaque_env_db\n",
    );

    let importer = ProjectConfigImporter::default();
    let env_res = importer.import(true, Some(&opaque_env)).await.unwrap();
    assert_eq!(env_res.connections.len(), 1);
    assert_eq!(env_res.connections[0].database, "opaque_env_db");
    assert_eq!(env_res.connections[0].driver_label, "PostgreSQL");

    // 2. Opaque single file with Compose content
    let opaque_compose = tmp.path().join("upload_blob_compose");
    write(
        &opaque_compose,
        r#"
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: compose_uploaded_db
    ports:
      - "5432:5432"
"#,
    );

    let compose_res = importer.import(false, Some(&opaque_compose)).await.unwrap();
    assert_eq!(compose_res.connections.len(), 1);
    assert_eq!(compose_res.connections[0].database, "compose_uploaded_db");
}

#[tokio::test]
async fn project_config_exponential_expansion_bounded() {
    let tmp = tempfile::tempdir().unwrap();
    let env_file = tmp.path().join(".env");
    let mut content = String::from("V0=x\n");
    for i in 1..=22 {
        content.push_str(&format!("V{} = \"${{V{}}}${{V{}}}\"\n", i, i - 1, i - 1));
    }
    content.push_str("DATABASE_URL=\"postgres://user:pass@127.0.0.1:5432/${V22:-fallback_db}\"\n");
    write(&env_file, &content);

    let importer = ProjectConfigImporter::default();
    let env = importer.import(false, Some(tmp.path())).await.unwrap();

    let conn = env
        .connections
        .iter()
        .find(|c| c.name.contains("DATABASE_URL"))
        .expect("should discover candidate");

    // The expansion must be bounded without exponential memory allocation or stall
    assert!(
        conn.warnings.iter().any(|w| {
            w.contains("exceeded maximum reference depth")
                || w.contains("exceeded total work budget")
                || w.contains("exceeded maximum value size limit")
        }),
        "Candidate warnings must report that expansion limits were reached: {:?}",
        conn.warnings
    );
}

#[tokio::test]
async fn project_config_escaped_dollar_in_password_and_url() {
    let tmp = tempfile::tempdir().unwrap();
    let env_file = tmp.path().join(".env");
    write(
        &env_file,
        r#"
DB_PASSWORD="pa\$ss"
DATABASE_URL="postgres://alice:${DB_PASSWORD}@127.0.0.1:5432/app"
SINGLE_URL='postgres://bob:sec\$ret@127.0.0.1:5433/shop'
UNQUOTED_PASSWORD=raw\$pass
UNQUOTED_URL="postgres://charlie:${UNQUOTED_PASSWORD}@127.0.0.1:5434/warehouse"
"#,
    );

    let importer = ProjectConfigImporter::default();
    let env = importer.import(true, Some(tmp.path())).await.unwrap();

    // 1. Double-quoted password with \$
    let db_url_conn = env
        .connections
        .iter()
        .find(|c| c.name.contains("DATABASE_URL"))
        .unwrap();
    let db_url_idx = env
        .connections
        .iter()
        .position(|c| std::ptr::eq(c, db_url_conn))
        .unwrap();
    let db_url_creds = env.credentials_by_index.get(&db_url_idx).unwrap();
    assert_eq!(db_url_creds.password.as_deref(), Some("pa$ss"));

    // 2. Single-quoted URL with \$
    let single_conn = env
        .connections
        .iter()
        .find(|c| c.name.contains("SINGLE_URL"))
        .unwrap();
    let single_idx = env
        .connections
        .iter()
        .position(|c| std::ptr::eq(c, single_conn))
        .unwrap();
    let single_creds = env.credentials_by_index.get(&single_idx).unwrap();
    assert_eq!(single_creds.password.as_deref(), Some("sec\\$ret"));

    // 3. Unquoted password with \$
    let unquoted_conn = env
        .connections
        .iter()
        .find(|c| c.name.contains("UNQUOTED_URL"))
        .unwrap();
    let unquoted_idx = env
        .connections
        .iter()
        .position(|c| std::ptr::eq(c, unquoted_conn))
        .unwrap();
    let unquoted_creds = env.credentials_by_index.get(&unquoted_idx).unwrap();
    assert_eq!(unquoted_creds.password.as_deref(), Some("raw$pass"));
}
