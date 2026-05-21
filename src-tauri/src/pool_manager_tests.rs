#[cfg(test)]
mod tests {
    use crate::pool_manager::format_error_chain;

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
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
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
            ssl_mode: None,
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
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
            ssl_ca: None,
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
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
            ssl_cert: None,
            ssl_key: None,
            ssh_enabled: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_file: None,
            ssh_key_passphrase: None,
            save_in_keychain: None,
            connection_id: None,
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
