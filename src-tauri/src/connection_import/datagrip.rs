//! DataGrip importer. Reads `dataSources.xml` (+ `dataSources.local.xml`) and
//! `sshConfigs.xml` from the JetBrains config dirs, parsing the JDBC URL for
//! host/port/database. Ported from TablePro's `DataGripImporter.swift` and
//! `DataGripDataSourceParser.swift`.
//!
//! Cross-platform for connection metadata. Passwords are NOT imported:
//! DataGrip keeps them in a JetBrains credential store (Keychain or a KeePass
//! `c.kdbx`) whose format is out of scope for this version.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use roxmltree::{Document, Node};

use super::types::{ImportEnvelope, ImportedConnection, ImportedSsh, ImportedSsl};
use super::{driver_map, resolve_key_path, ForeignAppImporter, ForeignImportError};

mod jdbc;

pub struct DataGripImporter {
    jetbrains_root: PathBuf,
}

impl Default for DataGripImporter {
    fn default() -> Self {
        Self {
            jetbrains_root: default_jetbrains_root(),
        }
    }
}

fn default_jetbrains_root() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        super::home_dir()
            .map(|h| h.join("Library/Application Support/JetBrains"))
            .unwrap_or_default()
    }
    #[cfg(target_os = "linux")]
    {
        directories::BaseDirs::new()
            .map(|d| d.config_dir().join("JetBrains"))
            .unwrap_or_default()
    }
    #[cfg(target_os = "windows")]
    {
        directories::BaseDirs::new()
            .map(|d| d.data_dir().join("JetBrains"))
            .unwrap_or_default()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        PathBuf::new()
    }
}

struct Location {
    data_sources: PathBuf,
    local: Option<PathBuf>,
    config_dir: PathBuf,
}

#[async_trait::async_trait]
impl ForeignAppImporter for DataGripImporter {
    fn id(&self) -> &'static str {
        "datagrip"
    }
    fn display_name(&self) -> &'static str {
        "DataGrip"
    }
    async fn is_available(&self) -> bool {
        !self.locations().is_empty()
    }
    async fn connection_count(&self) -> usize {
        let mut seen = std::collections::HashSet::new();
        for loc in self.locations() {
            for ds in self.data_sources(&loc) {
                seen.insert(ds.uuid.clone());
            }
        }
        seen.len()
    }

    async fn import(
        &self,
        _include_passwords: bool,
        _file: Option<&Path>,
    ) -> Result<ImportEnvelope, ForeignImportError> {
        let locations = self.locations();
        if locations.is_empty() {
            return Err(ForeignImportError::FileNotFound(self.display_name().to_string()));
        }

        let mut envelope = ImportEnvelope {
            source_name: self.display_name().to_string(),
            ..Default::default()
        };
        let mut group_names: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut ssh_cache: HashMap<PathBuf, HashMap<String, SshConfig>> = HashMap::new();

        for loc in locations {
            let ssh_configs = ssh_cache
                .entry(loc.config_dir.clone())
                .or_insert_with(|| load_ssh_configs(&loc.config_dir))
                .clone();

            for ds in self.data_sources(&loc) {
                if !seen.insert(ds.uuid.clone()) {
                    continue;
                }
                if let Some(conn) = make_connection(&ds, &ssh_configs) {
                    if let Some(g) = &conn.group_name {
                        if !group_names.contains(g) {
                            group_names.push(g.clone());
                        }
                    }
                    envelope.connections.push(conn);
                }
            }
        }

        if envelope.connections.is_empty() {
            return Err(ForeignImportError::NoConnectionsFound);
        }
        envelope.group_names = group_names;
        Ok(envelope)
    }
}

impl DataGripImporter {
    #[cfg(test)]
    pub(crate) fn with_root(jetbrains_root: PathBuf) -> Self {
        Self { jetbrains_root }
    }

    /// All `DataGrip*` config dirs, highest version first.
    fn config_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(&self.jetbrains_root)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("DataGrip"))
                        .unwrap_or(false)
            })
            .collect();
        dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        dirs
    }

    fn locations(&self) -> Vec<Location> {
        let mut result = Vec::new();
        for config_dir in self.config_dirs() {
            push_location(&config_dir.join("options"), &config_dir, &mut result);

            let projects = config_dir.join("projects");
            if let Ok(entries) = std::fs::read_dir(&projects) {
                for project in entries.flatten() {
                    push_location(&project.path().join(".idea"), &config_dir, &mut result);
                }
            }
            for project_path in recent_project_paths(&config_dir) {
                push_location(
                    &PathBuf::from(project_path).join(".idea"),
                    &config_dir,
                    &mut result,
                );
            }
        }
        result
    }

    /// Merge the shared and machine-local fragments for one location by uuid.
    fn data_sources(&self, location: &Location) -> Vec<DataSource> {
        let mut fragments: HashMap<String, Fragment> = HashMap::new();
        let mut order: Vec<String> = Vec::new();

        for path in [Some(&location.data_sources), location.local.as_ref()]
            .into_iter()
            .flatten()
        {
            let Ok(text) = std::fs::read_to_string(path) else { continue };
            for frag in parse_fragments(&text) {
                if let Some(existing) = fragments.get_mut(&frag.uuid) {
                    existing.merge(frag);
                } else {
                    order.push(frag.uuid.clone());
                    fragments.insert(frag.uuid.clone(), frag);
                }
            }
        }
        order
            .iter()
            .filter_map(|uuid| fragments.get(uuid).and_then(Fragment::resolved))
            .collect()
    }
}

fn push_location(dir: &Path, config_dir: &Path, out: &mut Vec<Location>) {
    let data_sources = dir.join("dataSources.xml");
    if !data_sources.is_file() {
        return;
    }
    let local = dir.join("dataSources.local.xml");
    out.push(Location {
        data_sources,
        local: local.is_file().then_some(local),
        config_dir: config_dir.to_path_buf(),
    });
}

fn recent_project_paths(config_dir: &Path) -> Vec<String> {
    let path = config_dir.join("options/recentProjects.xml");
    let Ok(text) = std::fs::read_to_string(&path) else { return Vec::new() };
    let Ok(doc) = Document::parse(&text) else { return Vec::new() };
    doc.descendants()
        .filter(|n| n.has_tag_name("entry"))
        .filter_map(|n| n.attribute("key"))
        .map(expand_macros)
        .collect()
}

// MARK: - XML model

#[derive(Default)]
struct Fragment {
    uuid: String,
    name: Option<String>,
    driver_ref: Option<String>,
    jdbc_url: Option<String>,
    username: Option<String>,
    group_name: Option<String>,
    ssh: Option<SshReference>,
    ssl: Option<ImportedSsl>,
}

impl Fragment {
    fn merge(&mut self, other: Fragment) {
        self.name = other.name.or(self.name.take());
        self.driver_ref = other.driver_ref.or(self.driver_ref.take());
        self.jdbc_url = other.jdbc_url.or(self.jdbc_url.take());
        self.username = other.username.or(self.username.take());
        self.group_name = other.group_name.or(self.group_name.take());
        self.ssh = other.ssh.or(self.ssh.take());
        self.ssl = other.ssl.or(self.ssl.take());
    }

    fn resolved(&self) -> Option<DataSource> {
        let driver_ref = self.driver_ref.clone().filter(|s| !s.is_empty())?;
        let jdbc_url = self.jdbc_url.clone().filter(|s| !s.is_empty())?;
        Some(DataSource {
            uuid: self.uuid.clone(),
            name: self.name.clone().unwrap_or_else(|| self.uuid.clone()),
            driver_ref,
            jdbc_url,
            username: self.username.clone().unwrap_or_default(),
            group_name: self.group_name.clone(),
            ssh: self.ssh.clone(),
            ssl: self.ssl.clone(),
        })
    }
}

struct DataSource {
    uuid: String,
    name: String,
    driver_ref: String,
    jdbc_url: String,
    username: String,
    group_name: Option<String>,
    ssh: Option<SshReference>,
    ssl: Option<ImportedSsl>,
}

#[derive(Clone)]
struct SshReference {
    config_id: Option<String>,
    inline_host: Option<String>,
    inline_port: Option<u16>,
    inline_user: Option<String>,
}

#[derive(Clone)]
struct SshConfig {
    host: String,
    port: Option<u16>,
    username: String,
    auth_type: Option<String>,
    key_path: Option<String>,
}

fn parse_fragments(xml: &str) -> Vec<Fragment> {
    let Ok(doc) = Document::parse(xml) else { return Vec::new() };
    doc.descendants()
        .filter(|n| n.has_tag_name("data-source"))
        .filter_map(parse_fragment)
        .collect()
}

fn parse_fragment(el: Node) -> Option<Fragment> {
    let uuid = el.attribute("uuid")?.to_string();
    Some(Fragment {
        uuid,
        name: el.attribute("name").filter(|s| !s.is_empty()).map(String::from),
        driver_ref: child_text(el, "driver-ref"),
        jdbc_url: child_text(el, "jdbc-url"),
        username: child_text(el, "user-name"),
        group_name: el
            .attribute("group-name")
            .filter(|s| !s.is_empty())
            .map(String::from),
        ssh: parse_ssh_reference(el),
        ssl: parse_ssl_properties(el),
    })
}

fn parse_ssh_reference(el: Node) -> Option<SshReference> {
    let ssh = child_element(el, "ssh-properties")?;
    let enabled = child_text(ssh, "enabled")
        .or_else(|| ssh.attribute("enabled").map(String::from))
        .as_deref()
        == Some("true");
    if !enabled {
        return None;
    }
    let config_id = child_text(ssh, "ssh-config-id")
        .or_else(|| ssh.attribute("ssh-config-id").map(String::from))
        .filter(|s| !s.is_empty());
    Some(SshReference {
        config_id,
        inline_host: ssh.attribute("host").map(String::from),
        inline_port: ssh.attribute("port").and_then(|p| p.parse().ok()),
        inline_user: ssh
            .attribute("user")
            .or_else(|| ssh.attribute("username"))
            .map(String::from),
    })
}

fn parse_ssl_properties(el: Node) -> Option<ImportedSsl> {
    let ssl = child_element(el, "ssl-config")?;
    if child_text(ssl, "enabled").as_deref() != Some("true") {
        return None;
    }
    let cert = |name: &str| child_text(ssl, name).filter(|s| !s.is_empty()).map(|s| expand_macros(&s));
    Some(ImportedSsl {
        mode: child_text(ssl, "mode").unwrap_or_else(|| "prefer".to_string()),
        ca_certificate_path: cert("ca-cert"),
        client_certificate_path: cert("client-cert"),
        client_key_path: cert("client-key"),
    })
}

fn load_ssh_configs(config_dir: &Path) -> HashMap<String, SshConfig> {
    let path = config_dir.join("options/sshConfigs.xml");
    let Ok(text) = std::fs::read_to_string(&path) else { return HashMap::new() };
    let Ok(doc) = Document::parse(&text) else { return HashMap::new() };
    let mut result = HashMap::new();
    for node in doc.descendants().filter(|n| n.has_tag_name("sshConfig")) {
        let Some(id) = node.attribute("id") else { continue };
        result.insert(
            id.to_string(),
            SshConfig {
                host: node.attribute("host").unwrap_or("").to_string(),
                port: node.attribute("port").and_then(|p| p.parse().ok()),
                username: node.attribute("username").unwrap_or("").to_string(),
                auth_type: node.attribute("authType").map(String::from),
                key_path: node.attribute("keyPath").map(expand_macros),
            },
        );
    }
    result
}

fn make_connection(ds: &DataSource, ssh_configs: &HashMap<String, SshConfig>) -> Option<ImportedConnection> {
    let subprotocol = jdbc::subprotocol(&ds.jdbc_url);
    let driver_label = map_driver_ref(&ds.driver_ref, &subprotocol);
    let driver_id = driver_map::canonical_id(&driver_label);
    let endpoint = jdbc::parse(&ds.jdbc_url, &subprotocol);

    let host = endpoint
        .as_ref()
        .map(|e| e.host.clone())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "localhost".to_string());
    let database = endpoint.as_ref().map(|e| e.database.clone()).unwrap_or_default();
    let port = endpoint
        .as_ref()
        .and_then(|e| e.port)
        .unwrap_or_else(|| driver_map::default_port(&driver_id));

    Some(ImportedConnection {
        name: ds.name.clone(),
        host,
        port,
        database,
        username: ds.username.clone(),
        driver_label,
        ssh: make_ssh(ds.ssh.as_ref(), ssh_configs),
        ssl: ds.ssl.clone(),
        group_name: ds.group_name.clone(),
    })
}

fn make_ssh(reference: Option<&SshReference>, ssh_configs: &HashMap<String, SshConfig>) -> Option<ImportedSsh> {
    let reference = reference?;
    let config = reference.config_id.as_ref().and_then(|id| ssh_configs.get(id));
    let host = config
        .map(|c| c.host.clone())
        .or_else(|| reference.inline_host.clone())
        .unwrap_or_default();
    if host.is_empty() {
        return None;
    }
    let key_path = config.and_then(|c| c.key_path.clone()).unwrap_or_default();
    let auth_type = config.and_then(|c| c.auth_type.clone());
    let uses_key = uses_key_auth(auth_type.as_deref(), &key_path);
    Some(ImportedSsh {
        host,
        port: config.and_then(|c| c.port).or(reference.inline_port),
        username: config
            .map(|c| c.username.clone())
            .or_else(|| reference.inline_user.clone())
            .unwrap_or_default(),
        auth_type: if uses_key { "ssh_key" } else { "password" }.to_string(),
        private_key_path: if uses_key && !key_path.is_empty() {
            Some(resolve_key_path(&key_path))
        } else {
            None
        },
    })
}

/// DataGrip omits `authType` when relying on the OpenSSH config, so a present
/// key path is the reliable signal for key auth.
fn uses_key_auth(auth_type: Option<&str>, key_path: &str) -> bool {
    match auth_type.unwrap_or("").to_ascii_uppercase().as_str() {
        "KEY_PAIR" | "PUBLIC_KEY" | "OPEN_SSH" => true,
        "PASSWORD" => false,
        _ => !key_path.is_empty(),
    }
}

fn map_driver_ref(driver_ref: &str, subprotocol: &str) -> String {
    let token = driver_ref
        .to_ascii_lowercase()
        .split('.')
        .next()
        .unwrap_or("")
        .to_string();
    let label = match token.as_str() {
        "mysql" => "MySQL",
        "mariadb" => "MariaDB",
        "postgresql" | "postgres" => "PostgreSQL",
        "sqlite" => "SQLite",
        "sqlserver" | "mssql" | "jtds" => "SQL Server",
        "oracle" => "Oracle",
        "mongo" | "mongodb" => "MongoDB",
        "redis" => "Redis",
        "clickhouse" => "ClickHouse",
        "cassandra" => "Cassandra",
        "duckdb" => "DuckDB",
        "bigquery" => "BigQuery",
        "cockroach" | "cockroachdb" => "CockroachDB",
        "redshift" => "Redshift",
        _ => return map_subprotocol(subprotocol, driver_ref),
    };
    label.to_string()
}

fn map_subprotocol(subprotocol: &str, fallback: &str) -> String {
    let label = match subprotocol.to_ascii_lowercase().as_str() {
        "mysql" => "MySQL",
        "mariadb" => "MariaDB",
        "postgresql" => "PostgreSQL",
        "sqlite" => "SQLite",
        "sqlserver" | "jtds" => "SQL Server",
        "oracle" => "Oracle",
        "mongodb" => "MongoDB",
        "redis" => "Redis",
        "clickhouse" => "ClickHouse",
        "cassandra" => "Cassandra",
        "duckdb" => "DuckDB",
        "bigquery" => "BigQuery",
        _ => return fallback.to_string(),
    };
    label.to_string()
}

fn expand_macros(path: &str) -> String {
    if let Some(home) = super::home_dir() {
        return path.replace("$USER_HOME$", &home.to_string_lossy());
    }
    path.to_string()
}

fn child_element<'a>(el: Node<'a, 'a>, name: &str) -> Option<Node<'a, 'a>> {
    el.children().find(|c| c.is_element() && c.has_tag_name(name))
}

fn child_text(el: Node, name: &str) -> Option<String> {
    child_element(el, name)
        .and_then(|c| c.text())
        .map(|t| t.trim().to_string())
        .filter(|s| !s.is_empty())
}
