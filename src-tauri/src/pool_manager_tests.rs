#[cfg(test)]
mod tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::{build_connection_key, build_mysql_options, format_error_chain};
    use sqlx::mysql::MySqlSslMode;

    fn connection_params(driver: &str, ssl_mode: Option<&str>) -> ConnectionParams {
        ConnectionParams {
            driver: driver.to_string(),
            host: Some("127.0.0.1".to_string()),
            port: Some(match driver {
                "postgres" => 5432,
                "mysql" => 3306,
                _ => 0,
            }),
            username: Some("dec".to_string()),
            password: Some("secret".to_string()),
            database: DatabaseSelection::Single("dec".to_string()),
            ssl_mode: ssl_mode.map(ToOwned::to_owned),
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: Some(true),
            ssh_connection_id: Some("ssh-1".to_string()),
            ssh_host: Some("149.202.85.42".to_string()),
            ssh_port: Some(2222),
            ssh_user: Some("julien".to_string()),
            ssh_password: None,
            ssh_key_file: Some("/Users/julienbarbe/.ssh/id_rsa".to_string()),
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: Some("conn-1".to_string()),
            ..Default::default()
        }
    }

    fn mysql_params(ssl_mode: &str) -> ConnectionParams {
        connection_params("mysql", Some(ssl_mode))
    }

    #[test]
    fn format_error_chain_walks_sources() {
        use std::error::Error as StdError;
        use std::fmt;

        #[derive(Debug)]
        struct Inner;
        impl fmt::Display for Inner {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("inner cause")
            }
        }
        impl StdError for Inner {}

        #[derive(Debug)]
        struct Outer(Inner);
        impl fmt::Display for Outer {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("outer message")
            }
        }
        impl StdError for Outer {
            fn source(&self) -> Option<&(dyn StdError + 'static)> {
                Some(&self.0)
            }
        }

        assert_eq!(
            format_error_chain(&Outer(Inner)),
            "outer message -> inner cause"
        );
    }

    #[test]
    fn mysql_pool_key_changes_when_ssl_mode_changes() {
        let required = mysql_params("required");
        let disabled = mysql_params("disabled");

        assert_ne!(
            build_connection_key(&required, Some("conn-1")),
            build_connection_key(&disabled, Some("conn-1"))
        );
    }

    #[test]
    fn postgres_pool_key_ignores_mysql_ssl_key_fields() {
        let required = connection_params("postgres", Some("required"));
        let disabled = connection_params("postgres", Some("disabled"));

        assert_eq!(
            build_connection_key(&required, Some("conn-1")),
            build_connection_key(&disabled, Some("conn-1"))
        );
    }

    #[test]
    fn sqlite_pool_key_ignores_mysql_ssl_key_fields() {
        let required = connection_params("sqlite", Some("required"));
        let disabled = connection_params("sqlite", Some("disabled"));

        assert_eq!(
            build_connection_key(&required, Some("conn-1")),
            build_connection_key(&disabled, Some("conn-1"))
        );
    }

    #[test]
    fn mysql_options_accept_snake_case_verify_ssl_modes() {
        let verify_ca = mysql_params("verify_ca");
        let verify_identity = mysql_params("verify_identity");

        assert!(matches!(
            build_mysql_options(&verify_ca, None)
                .unwrap()
                .get_ssl_mode(),
            MySqlSslMode::VerifyCa
        ));
        assert!(matches!(
            build_mysql_options(&verify_identity, None)
                .unwrap()
                .get_ssl_mode(),
            MySqlSslMode::VerifyIdentity
        ));
    }
}

#[cfg(test)]
mod postgres_ssl_config_tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::build_postgres_configurations;
    use tokio_postgres::config::SslMode as PgSslMode;

    fn params_with_ssl(mode: &str) -> ConnectionParams {
        ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("localhost".to_string()),
            port: Some(5432),
            username: Some("test".to_string()),
            password: Some("test".to_string()),
            database: DatabaseSelection::Single("testdb".to_string()),
            ssl_mode: Some(mode.to_string()),
            ..Default::default()
        }
    }

    fn params_no_ssl() -> ConnectionParams {
        ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("localhost".to_string()),
            port: Some(5432),
            username: Some("test".to_string()),
            password: Some("test".to_string()),
            database: DatabaseSelection::Single("testdb".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn test_ssl_mode_disable() {
        let params = params_with_ssl("disable");
        let cfg = build_postgres_configurations(&params);
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Disable);
    }

    #[test]
    fn test_ssl_mode_allow() {
        let params = params_with_ssl("allow");
        let cfg = build_postgres_configurations(&params);
        // tokio_postgres does not have SslMode::Allow.
        // "allow" is mapped to Prefer since the client library doesn't support
        // "try non-SSL first, fallback to SSL" natively.
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Prefer);
    }

    #[test]
    fn test_ssl_mode_prefer() {
        let params = params_with_ssl("prefer");
        let cfg = build_postgres_configurations(&params);
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Prefer);
    }

    #[test]
    fn test_ssl_mode_require() {
        let params = params_with_ssl("require");
        let cfg = build_postgres_configurations(&params);
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Require);
    }

    #[test]
    fn test_ssl_mode_verify_ca() {
        let params = params_with_ssl("verify-ca");
        let cfg = build_postgres_configurations(&params);
        // verify-ca maps to Require at the protocol level (cert validation is in TLS connector)
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Require);
    }

    #[test]
    fn test_ssl_mode_verify_full() {
        let params = params_with_ssl("verify-full");
        let cfg = build_postgres_configurations(&params);
        // verify-full maps to Require at the protocol level
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Require);
    }

    #[test]
    fn test_ssl_mode_default_is_prefer() {
        // No ssl_mode set -> tokio_postgres defaults to Prefer
        let params = params_no_ssl();
        let cfg = build_postgres_configurations(&params);
        assert_eq!(cfg.get_ssl_mode(), PgSslMode::Prefer);
    }

    #[test]
    fn test_ssl_mode_allow_vs_prefer() {
        // Note: tokio_postgres does not have SslMode::Allow.
        // Both "allow" and "prefer" map to PgSslMode::Prefer in the client library.
        // The true libpq distinction (allow=non-SSL first, prefer=SSL first) cannot
        // be implemented at the tokio_postgres level without application-level connection logic.
        let allow_params = params_with_ssl("allow");
        let prefer_params = params_with_ssl("prefer");

        let allow_cfg = build_postgres_configurations(&allow_params);
        let prefer_cfg = build_postgres_configurations(&prefer_params);

        // Both map to Prefer in tokio_postgres
        assert_eq!(allow_cfg.get_ssl_mode(), PgSslMode::Prefer);
        assert_eq!(prefer_cfg.get_ssl_mode(), PgSslMode::Prefer);
    }
}

#[cfg(test)]
mod postgres_tls_connector_tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::build_postgres_tls_connector;

    fn params_with_ssl(mode: &str) -> ConnectionParams {
        ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("localhost".to_string()),
            port: Some(5432),
            username: Some("test".to_string()),
            password: Some("test".to_string()),
            database: DatabaseSelection::Single("testdb".to_string()),
            ssl_mode: Some(mode.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn test_tls_connector_disable() {
        let params = params_with_ssl("disable");
        let result = build_postgres_tls_connector(&params);
        // Should succeed - connector is created even for disable mode
        assert!(result.is_ok());
    }

    #[test]
    fn test_tls_connector_allow() {
        let params = params_with_ssl("allow");
        let result = build_postgres_tls_connector(&params);
        // Should succeed with NoCertVerifier
        assert!(result.is_ok());
    }

    #[test]
    fn test_tls_connector_prefer() {
        let params = params_with_ssl("prefer");
        let result = build_postgres_tls_connector(&params);
        // Should succeed with NoCertVerifier
        assert!(result.is_ok());
    }

    #[test]
    fn test_tls_connector_require() {
        let params = params_with_ssl("require");
        let result = build_postgres_tls_connector(&params);
        // Should succeed with NoCertVerifier
        assert!(result.is_ok());
    }

    #[test]
    fn test_tls_connector_verify_ca_requires_ca_file() {
        let params = params_with_ssl("verify-ca");
        let result = build_postgres_tls_connector(&params);
        // verify-ca requires an explicit CA file — no platform roots fallback
        match result {
            Err(e) => assert!(e.contains("verify-ca mode requires an explicit CA file")),
            Ok(_) => panic!("Expected error for verify-ca without CA file"),
        }
    }

    #[test]
    fn test_tls_connector_verify_ca_with_ca_file() {
        use std::io::Write;

        // Create a minimal test CA certificate
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_verify_ca_ca.pem");
        {
            // Write a minimal valid PEM certificate block for testing
            let cert_pem = include_bytes!("../tests/test_ca.pem");
            let mut file = std::fs::File::create(&file_path).unwrap();
            file.write_all(cert_pem).unwrap();
        }

        let params = ConnectionParams {
            driver: "postgres".to_string(),
            host: Some("localhost".to_string()),
            port: Some(5432),
            username: Some("test".to_string()),
            password: Some("test".to_string()),
            database: DatabaseSelection::Single("testdb".to_string()),
            ssl_mode: Some("verify-ca".to_string()),
            ssl_ca: Some(file_path.to_str().unwrap().to_string()),
            ..Default::default()
        };
        let result = build_postgres_tls_connector(&params);
        assert!(result.is_ok());

        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn test_tls_connector_verify_full() {
        let params = params_with_ssl("verify-full");
        let result = build_postgres_tls_connector(&params);
        // Should succeed with platform verifier
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_roots_from_pem_missing_file() {
        use crate::pool_manager::load_roots_from_pem;
        let result = load_roots_from_pem("/nonexistent/path/to/ca.pem");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Failed to read ssl_ca file"));
    }

    #[test]
    fn test_load_roots_from_pem_invalid_content() {
        use crate::pool_manager::load_roots_from_pem;
        use std::io::Write;

        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_invalid_ca.pem");
        {
            let mut file = std::fs::File::create(&file_path).unwrap();
            writeln!(file, "this is not a valid PEM file").unwrap();
            writeln!(file, "no certificates here").unwrap();
        }

        let result = load_roots_from_pem(file_path.to_str().unwrap());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("contained no PEM CERTIFICATE blocks"));

        // Cleanup
        let _ = std::fs::remove_file(&file_path);
    }
}
