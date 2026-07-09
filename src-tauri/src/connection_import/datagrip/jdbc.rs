//! Minimal JDBC connection-string parser, extracting host/port/database from
//! the URL forms DataGrip writes. Ported from TablePro's `JDBCConnectionString`.

pub struct Endpoint {
    pub host: String,
    pub port: Option<u16>,
    pub database: String,
}

/// The subprotocol token in `jdbc:<subprotocol>:...` (lowercased by the caller
/// where needed). Empty when the URL isn't a JDBC URL.
pub fn subprotocol(url: &str) -> String {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("jdbc:") {
        return String::new();
    }
    url["jdbc:".len()..]
        .chars()
        .take_while(|c| *c != ':' && *c != '/')
        .collect()
}

pub fn parse(url: &str, subprotocol: &str) -> Option<Endpoint> {
    let trimmed = url.trim();
    if !trimmed.to_ascii_lowercase().starts_with("jdbc:") {
        return None;
    }
    let body = &trimmed["jdbc:".len()..];
    match subprotocol.to_ascii_lowercase().as_str() {
        "sqlserver" | "jtds" => parse_sql_server(body),
        "oracle" => parse_oracle(body),
        "sqlite" | "duckdb" | "h2" => parse_file(body, subprotocol),
        _ => parse_authority(body),
    }
}

/// jdbc:<sub>://[user[:pass]@]host[:port][/database][?params]
fn parse_authority(body: &str) -> Option<Endpoint> {
    let idx = body.find("://")?;
    let mut remainder = &body[idx + 3..];
    remainder = strip_query(remainder);
    let (authority, database) = split_once(remainder, '/');
    let authority = strip_userinfo(authority);
    let first_host = authority.split(',').next().unwrap_or(authority);
    let (host, port) = parse_host_port(first_host);
    if host.is_empty() {
        return None;
    }
    Some(Endpoint {
        host,
        port,
        database: database.unwrap_or_default().to_string(),
    })
}

/// jdbc:sqlserver://host[\instance][:port][;prop=value;...]
/// jdbc:jtds:sqlserver://host:port/database
fn parse_sql_server(body: &str) -> Option<Endpoint> {
    let mut remainder = body;
    if remainder.to_ascii_lowercase().starts_with("jtds:") {
        remainder = &remainder["jtds:".len()..];
    }
    if remainder.to_ascii_lowercase().starts_with("sqlserver:") {
        remainder = &remainder["sqlserver:".len()..];
    }
    let remainder = remainder.strip_prefix("//")?;
    let (before_props, props_str) = split_once(remainder, ';');
    let props = parse_semicolon_props(props_str.unwrap_or(""));
    let (mut authority, database) = split_once(before_props, '/');
    if let Some(bs) = authority.find('\\') {
        authority = &authority[..bs];
    }
    let (host, port) = parse_host_port(authority);
    if host.is_empty() {
        return None;
    }
    let database = database
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| props.get("databasename").or_else(|| props.get("database")).cloned())
        .unwrap_or_default();
    Some(Endpoint { host, port, database })
}

/// jdbc:oracle:thin:@host:port:SID or @//host:port/SERVICE_NAME
fn parse_oracle(body: &str) -> Option<Endpoint> {
    let at = body.find('@')?;
    let mut descriptor = strip_query(&body[at + 1..]).to_string();

    if let Some(rest) = descriptor.strip_prefix("//") {
        let (authority, database) = split_once(rest, '/');
        let (host, port) = parse_host_port(authority);
        if host.is_empty() {
            return None;
        }
        return Some(Endpoint {
            host,
            port,
            database: database.unwrap_or_default().to_string(),
        });
    }

    let parts: Vec<&str> = descriptor.split(':').collect();
    if parts.len() < 2 || parts[0].is_empty() {
        let (authority, database) = split_once(&descriptor, '/');
        let (host, port) = parse_host_port(authority);
        if host.is_empty() {
            return None;
        }
        return Some(Endpoint {
            host,
            port,
            database: database.unwrap_or_default().to_string(),
        });
    }
    let host = parts[0].to_string();
    let (port_str, service) = split_once(parts[1], '/');
    let port = port_str.parse().ok();
    let database = service
        .map(|s| s.to_string())
        .unwrap_or_else(|| parts.get(2).map(|s| s.to_string()).unwrap_or_default());
    descriptor.clear();
    Some(Endpoint { host, port, database })
}

/// jdbc:sqlite:/path/to/file.db
fn parse_file(body: &str, subprotocol: &str) -> Option<Endpoint> {
    let prefix = format!("{}:", subprotocol.to_ascii_lowercase());
    let path = if body.to_ascii_lowercase().starts_with(&prefix) {
        &body[prefix.len()..]
    } else {
        body
    };
    Some(Endpoint {
        host: String::new(),
        port: None,
        database: strip_query(path).to_string(),
    })
}

// MARK: - Helpers

fn parse_host_port(authority: &str) -> (String, Option<u16>) {
    if let Some(rest) = authority.strip_prefix('[') {
        // IPv6 literal: [host]:port
        if let Some(close) = rest.find(']') {
            let host = rest[..close].to_string();
            let after = &rest[close + 1..];
            let port = after.strip_prefix(':').and_then(|p| p.parse().ok());
            return (host, port);
        }
        return (authority.to_string(), None);
    }
    match authority.rfind(':') {
        Some(colon) => {
            let host = authority[..colon].to_string();
            let port = authority[colon + 1..].parse().ok();
            (host, port)
        }
        None => (authority.to_string(), None),
    }
}

fn strip_userinfo(authority: &str) -> &str {
    match authority.rfind('@') {
        Some(at) => &authority[at + 1..],
        None => authority,
    }
}

fn strip_query(value: &str) -> &str {
    match value.find('?') {
        Some(q) => &value[..q],
        None => value,
    }
}

fn split_once(value: &str, sep: char) -> (&str, Option<&str>) {
    match value.find(sep) {
        Some(i) => (&value[..i], Some(&value[i + 1..])),
        None => (value, None),
    }
}

fn parse_semicolon_props(value: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for pair in value.split(';').filter(|p| !p.is_empty()) {
        if let (k, Some(v)) = split_once(pair, '=') {
            map.insert(k.trim().to_ascii_lowercase(), v.to_string());
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_postgres_authority() {
        let e = parse("jdbc:postgresql://db.example.com:6543/mydb", "postgresql").unwrap();
        assert_eq!(e.host, "db.example.com");
        assert_eq!(e.port, Some(6543));
        assert_eq!(e.database, "mydb");
    }

    #[test]
    fn parses_mysql_without_port() {
        let e = parse("jdbc:mysql://localhost/app", "mysql").unwrap();
        assert_eq!(e.host, "localhost");
        assert_eq!(e.port, None);
        assert_eq!(e.database, "app");
    }

    #[test]
    fn strips_userinfo_and_query() {
        let e = parse("jdbc:mysql://user:pw@host:3306/db?useSSL=true", "mysql").unwrap();
        assert_eq!(e.host, "host");
        assert_eq!(e.port, Some(3306));
        assert_eq!(e.database, "db");
    }

    #[test]
    fn parses_sqlserver_with_props() {
        let e = parse("jdbc:sqlserver://host:1433;databaseName=sales", "sqlserver").unwrap();
        assert_eq!(e.host, "host");
        assert_eq!(e.port, Some(1433));
        assert_eq!(e.database, "sales");
    }

    #[test]
    fn parses_sqlite_file() {
        let e = parse("jdbc:sqlite:/data/app.db", "sqlite").unwrap();
        assert_eq!(e.host, "");
        assert_eq!(e.database, "/data/app.db");
    }

    #[test]
    fn subprotocol_extraction() {
        assert_eq!(subprotocol("jdbc:postgresql://x"), "postgresql");
        assert_eq!(subprotocol("not-jdbc"), "");
    }
}
