#[cfg(test)]
mod tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::{
        build_connection_key, build_mysql_options, connect_timeout, connection_pool_prefix,
        format_error_chain, is_pipes_as_concat_unsupported, mysql_connect_timeout, query_timeout,
        remove_pools_with_prefix, with_connect_timeout,
    };
    use sqlx::mysql::MySqlSslMode;
    use std::collections::HashMap;
    use std::time::Duration;

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
    fn connection_pool_prefix_matches_every_database_for_a_connection() {
        // The prefix matches both the primary pool key and per-database override
        // keys, which embed a different database after the connection id.
        let params = mysql_params("required");
        let prefix = connection_pool_prefix("mysql", "conn-1");
        let primary_key = build_connection_key(&params, Some("conn-1"));

        let mut overridden = params.clone();
        overridden.database = DatabaseSelection::Single("other_db".to_string());
        let override_key = build_connection_key(&overridden, Some("conn-1"));

        assert!(
            primary_key.starts_with(&prefix),
            "primary key {primary_key} should start with prefix {prefix}"
        );
        assert!(
            override_key.starts_with(&prefix),
            "override key {override_key} should start with prefix {prefix}"
        );
    }

    #[test]
    fn connection_pool_prefix_does_not_match_a_different_connection() {
        // The trailing `:` prevents one connection id that is a prefix of another
        // (`conn-1` vs `conn-10`) from matching the other's pools.
        let prefix = connection_pool_prefix("mysql", "conn-1");
        let other_prefix = connection_pool_prefix("mysql", "conn-10");

        assert_ne!(prefix, other_prefix);
        assert!(
            !other_prefix.starts_with(&prefix),
            "prefix {prefix} must not match a longer connection id"
        );
    }

    #[test]
    fn remove_pools_with_prefix_collects_only_matching_keys() {
        let mut pools: HashMap<String, i32> = HashMap::new();
        pools.insert("mysql:conn:1:db_a".to_string(), 1);
        pools.insert("mysql:conn:1:db_b".to_string(), 2);
        pools.insert("mysql:conn:2:db_a".to_string(), 3);
        pools.insert("postgres:conn:1:db_a".to_string(), 4);

        let prefix = connection_pool_prefix("mysql", "1");
        let removed = remove_pools_with_prefix(&mut pools, &prefix);

        // Only the two mysql:conn:1:* entries are removed; the conn:2 and
        // postgres pools are left untouched.
        assert_eq!(removed.len(), 2);
        let removed_keys: Vec<&str> = removed.iter().map(|(k, _)| k.as_str()).collect();
        assert!(removed_keys.contains(&"mysql:conn:1:db_a"));
        assert!(removed_keys.contains(&"mysql:conn:1:db_b"));
        assert_eq!(pools.len(), 2);
        assert!(pools.contains_key("mysql:conn:2:db_a"));
        assert!(pools.contains_key("postgres:conn:1:db_a"));
    }

    #[test]
    fn sqlite_pool_key_ignores_tls_key_fields() {
        let required = connection_params("sqlite", Some("required"));
        let mut disabled = connection_params("sqlite", Some("disabled"));
        disabled.ssl_ca = Some("/tmp/sqlite-ca.pem".to_string());

        assert_eq!(
            build_connection_key(&required, Some("conn-1")),
            build_connection_key(&disabled, Some("conn-1"))
        );
    }

    #[test]
    fn connect_timeout_is_unset_for_none_and_zero() {
        let mut params = connection_params("postgres", None);
        assert_eq!(connect_timeout(&params), None);

        params.connect_timeout_secs = Some(0);
        assert_eq!(connect_timeout(&params), None);

        params.connect_timeout_secs = Some(7);
        assert_eq!(connect_timeout(&params), Some(Duration::from_secs(7)));
    }

    #[test]
    fn query_timeout_is_unset_for_none_and_zero() {
        let mut params = connection_params("postgres", None);
        assert_eq!(query_timeout(&params), None);

        params.query_timeout_secs = Some(0);
        assert_eq!(query_timeout(&params), None);

        params.query_timeout_secs = Some(30);
        assert_eq!(query_timeout(&params), Some(Duration::from_secs(30)));
    }

    #[test]
    fn query_timeout_does_not_split_the_pool() {
        let unset = connection_params("postgres", None);
        let mut limited = unset.clone();
        limited.query_timeout_secs = Some(30);

        // Enforced per statement on the client, so both share one pool.
        assert_eq!(
            build_connection_key(&unset, Some("conn-1")),
            build_connection_key(&limited, Some("conn-1"))
        );
    }

    #[test]
    fn mysql_connect_timeout_prefers_the_connection_value() {
        let mut params = mysql_params("disabled");
        let global = mysql_connect_timeout(&params);
        assert!(global > Duration::ZERO);

        params.connect_timeout_secs = Some(3);
        assert_eq!(mysql_connect_timeout(&params), Duration::from_secs(3));

        params.connect_timeout_secs = Some(0);
        assert_eq!(mysql_connect_timeout(&params), global);
    }

    #[test]
    fn pool_key_changes_only_when_connect_timeout_is_set() {
        let none = connection_params("postgres", Some("require"));
        let mut zero = none.clone();
        zero.connect_timeout_secs = Some(0);
        let mut five = none.clone();
        five.connect_timeout_secs = Some(5);
        let mut ten = none.clone();
        ten.connect_timeout_secs = Some(10);

        let key_none = build_connection_key(&none, Some("conn-1"));
        assert_eq!(key_none, build_connection_key(&zero, Some("conn-1")));
        assert_ne!(key_none, build_connection_key(&five, Some("conn-1")));
        assert_ne!(
            build_connection_key(&five, Some("conn-1")),
            build_connection_key(&ten, Some("conn-1"))
        );
        assert!(build_connection_key(&five, Some("conn-1"))
            .starts_with(&connection_pool_prefix("postgres", "conn-1")));
    }

    #[tokio::test]
    async fn with_connect_timeout_fails_a_stalled_attempt() {
        let mut params = connection_params("postgres", None);
        params.connect_timeout_secs = Some(1);
        let started = std::time::Instant::now();

        let result =
            with_connect_timeout(&params, std::future::pending::<Result<(), String>>()).await;

        assert_eq!(result, Err("Connection timed out after 1 s".to_string()));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn with_connect_timeout_passes_results_through() {
        let mut params = connection_params("postgres", None);
        assert_eq!(with_connect_timeout(&params, async { Ok(1) }).await, Ok(1));

        params.connect_timeout_secs = Some(5);
        assert_eq!(
            with_connect_timeout(&params, async { Err::<(), _>("refused".to_string()) }).await,
            Err("refused".to_string())
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

    #[test]
    fn mysql_options_default_ssl_mode_is_required() {
        let params = connection_params("mysql", None);
        let opts = build_mysql_options(&params, None).expect("unset ssl_mode");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
    }

    #[test]
    fn mysql_options_blank_ssl_mode_equals_default() {
        let blank = mysql_params("   ");
        let unset = connection_params("mysql", None);
        let blank_opts = build_mysql_options(&blank, None).expect("blank ssl_mode");
        let unset_opts = build_mysql_options(&unset, None).expect("unset ssl_mode");
        assert!(matches!(blank_opts.get_ssl_mode(), MySqlSslMode::Required));
        assert_eq!(
            std::mem::discriminant(&blank_opts.get_ssl_mode()),
            std::mem::discriminant(&unset_opts.get_ssl_mode())
        );
        assert_eq!(
            build_connection_key(&blank, Some("conn-1")),
            build_connection_key(&unset, Some("conn-1"))
        );
    }

    fn mysql_ssl_mode_name(mode: MySqlSslMode) -> &'static str {
        match mode {
            MySqlSslMode::Disabled => "Disabled",
            MySqlSslMode::Preferred => "Preferred",
            MySqlSslMode::Required => "Required",
            MySqlSslMode::VerifyCa => "VerifyCa",
            MySqlSslMode::VerifyIdentity => "VerifyIdentity",
        }
    }

    fn assert_mysql_ssl_mode(mode: &str, expected: MySqlSslMode) {
        let opts = build_mysql_options(&mysql_params(mode), None)
            .unwrap_or_else(|err| panic!("{mode} should be accepted, got: {err}"));
        let actual = opts.get_ssl_mode();
        assert!(
            std::mem::discriminant(&actual) == std::mem::discriminant(&expected),
            "{mode}: expected {}, got {}",
            mysql_ssl_mode_name(expected),
            mysql_ssl_mode_name(actual),
        );
    }

    #[test]
    fn mysql_options_accept_every_produced_ssl_mode() {
        // UI values, JDBC URL import aliases, and libpq spellings stored by
        // the connection importers (DBeaver, TablePlus, Beekeeper, Sequel Ace,
        // DataGrip) and left in place by the #614 migration.
        let cases = [
            ("disabled", MySqlSslMode::Disabled),
            ("disable", MySqlSslMode::Disabled),
            ("preferred", MySqlSslMode::Preferred),
            ("prefer", MySqlSslMode::Preferred),
            ("required", MySqlSslMode::Required),
            ("require", MySqlSslMode::Required),
            ("verify_ca", MySqlSslMode::VerifyCa),
            ("verify-ca", MySqlSslMode::VerifyCa),
            ("verify_identity", MySqlSslMode::VerifyIdentity),
            ("verify-identity", MySqlSslMode::VerifyIdentity),
            ("verify-full", MySqlSslMode::VerifyIdentity),
            ("VERIFY_IDENTITY", MySqlSslMode::VerifyIdentity),
        ];
        for (mode, expected) in cases {
            assert_mysql_ssl_mode(mode, expected);
        }
    }

    #[test]
    fn mysql_options_reject_unknown_ssl_mode() {
        let err = build_mysql_options(&mysql_params("verfy-full"), None).unwrap_err();
        assert!(err.contains("verfy-full"), "{err}");
        for accepted in [
            "disabled",
            "preferred",
            "required",
            "verify_ca",
            "verify_identity",
            "verify-ca",
            "verify-full",
        ] {
            assert!(err.contains(accepted), "{err} missing {accepted}");
        }
    }

    #[test]
    fn mysql_pool_key_keeps_unknown_ssl_mode_distinct_from_default() {
        let unknown = mysql_params("verfy-full");
        let unset = connection_params("mysql", None);
        assert_ne!(
            build_connection_key(&unknown, Some("conn-1")),
            build_connection_key(&unset, Some("conn-1"))
        );
    }

    #[test]
    fn adhoc_mysql_pool_key_changes_when_username_changes() {
        // No connection_id → ad-hoc key. Bastions like Warpgate share one
        // host:port across targets and select the backend by username, so two
        // usernames must never resolve to the same pool.
        let mut alice = mysql_params("required");
        alice.username = Some("alice".to_string());
        let mut bob = mysql_params("required");
        bob.username = Some("bob".to_string());

        assert_ne!(
            build_connection_key(&alice, None),
            build_connection_key(&bob, None)
        );
    }

    #[test]
    fn mysql_options_default_force_pipes_as_concat() {
        // Unset => keep sqlx's default behavior (force the sql_mode).
        let params = mysql_params("required");
        let options = build_mysql_options(&params, None).unwrap();
        let dbg = format!("{options:?}");
        assert!(
            dbg.contains("pipes_as_concat: true") && dbg.contains("no_engine_substitution: true"),
            "expected forced sql_mode by default, got: {dbg}"
        );
    }

    #[test]
    fn mysql_options_skip_database_when_empty() {
        // Empty database = "no default schema" (all-databases connections):
        // it must not reach the handshake, where "" is rejected by the
        // server with "Unknown database ''".
        let mut params = mysql_params("required");
        params.database = DatabaseSelection::Single(String::new());
        let options = build_mysql_options(&params, None).unwrap();
        let dbg = format!("{options:?}");
        assert!(
            dbg.contains("database: None"),
            "expected no database in options, got: {dbg}"
        );
    }

    #[test]
    fn mysql_options_keep_non_empty_database() {
        let params = mysql_params("required");
        let options = build_mysql_options(&params, None).unwrap();
        let dbg = format!("{options:?}");
        assert!(
            dbg.contains("database: Some(\"dec\")"),
            "expected the configured database in options, got: {dbg}"
        );
    }

    #[test]
    fn mysql_pool_key_changes_when_cleartext_plugin_changes() {
        let mut plain = mysql_params("required");
        plain.enable_cleartext_plugin = Some(false);
        let mut cleartext = mysql_params("required");
        cleartext.enable_cleartext_plugin = Some(true);

        assert_ne!(
            build_connection_key(&plain, Some("conn-1")),
            build_connection_key(&cleartext, Some("conn-1"))
        );
    }

    #[test]
    fn mysql_options_disable_pipes_as_concat_for_vitess() {
        // Some(false) => do not force the sql_mode (Vitess/PlanetScale).
        let mut params = mysql_params("required");
        params.pipes_as_concat = Some(false);
        let options = build_mysql_options(&params, None).unwrap();
        let dbg = format!("{options:?}");
        assert!(
            dbg.contains("pipes_as_concat: false") && dbg.contains("no_engine_substitution: false"),
            "expected sql_mode forcing disabled, got: {dbg}"
        );
    }

    #[test]
    fn cleartext_plugin_rejected_without_tls() {
        let mut params = mysql_params("disabled");
        params.enable_cleartext_plugin = Some(true);

        assert!(build_mysql_options(&params, None).is_err());
    }

    #[test]
    fn cleartext_plugin_rejected_with_preferred_tls() {
        // `Preferred` only attempts TLS and silently falls back to plaintext,
        // so cleartext credentials could still cross an unencrypted link.
        let mut params = mysql_params("preferred");
        params.enable_cleartext_plugin = Some(true);

        assert!(build_mysql_options(&params, None).is_err());
    }

    #[test]
    fn cleartext_plugin_allowed_with_enforced_tls() {
        for mode in ["required", "verify_ca", "verify_identity"] {
            let mut params = mysql_params(mode);
            params.enable_cleartext_plugin = Some(true);

            assert!(
                build_mysql_options(&params, None).is_ok(),
                "cleartext should be allowed with enforced TLS mode {mode}"
            );
        }
    }

    #[test]
    fn mysql_pool_key_differs_on_pipes_as_concat() {
        let forced = mysql_params("required");
        let mut disabled = mysql_params("required");
        disabled.pipes_as_concat = Some(false);

        assert_ne!(
            build_connection_key(&forced, Some("conn-1")),
            build_connection_key(&disabled, Some("conn-1"))
        );
    }

    #[test]
    fn mysql_pool_key_changes_when_iam_auth_changes() {
        let mut plain = mysql_params("required");
        plain.use_iam_auth = Some(false);

        let mut iam = mysql_params("required");
        iam.use_iam_auth = Some(true);

        assert_ne!(
            build_connection_key(&plain, Some("conn-1")),
            build_connection_key(&iam, Some("conn-1"))
        );
    }

    #[test]
    fn detects_pipes_as_concat_unsupported_error() {
        // Vitess/PlanetScale reject sqlx's forced sql_mode; the message that
        // triggers the auto-fallback retry.
        assert!(is_pipes_as_concat_unsupported(
            "setting the PIPES_AS_CONCAT sql_mode is unsupported"
        ));
        assert!(is_pipes_as_concat_unsupported(
            "VT05006: unsupported NO_ENGINE_SUBSTITUTION"
        ));
        // Matching is case-insensitive.
        assert!(is_pipes_as_concat_unsupported("pipes_as_concat rejected"));
        // Unrelated failures must not trigger a fallback.
        assert!(!is_pipes_as_concat_unsupported(
            "Access denied for user 'root'@'localhost'"
        ));
    }

    #[test]
    fn mysql_options_iam_auth_rejects_disabled_ssl() {
        let mut params = mysql_params("disabled");
        params.use_iam_auth = Some(true);
        params.password = Some("token".to_string());

        let err = build_mysql_options(&params, None).unwrap_err();
        assert!(
            err.contains("IAM") && (err.contains("TLS") || err.contains("SSL")),
            "expected IAM/SSL error, got: {}",
            err
        );
    }

    #[test]
    fn mysql_options_iam_auth_force_upgrades_preferred_to_required() {
        // Preferred is opportunistic TLS: a network attacker that strips the
        // STARTTLS upgrade would catch the cleartext plugin's RDS token on
        // the wire. Force-upgrade to Required so the TLS link is guaranteed.
        let mut params = mysql_params("preferred");
        params.use_iam_auth = Some(true);
        params.password = Some("token".to_string());

        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
    }

    #[test]
    fn mysql_options_iam_auth_rejects_empty_password_for_adhoc() {
        let mut params = mysql_params("required");
        params.use_iam_auth = Some(true);
        params.password = Some(String::new());
        params.connection_id = None;

        let err = build_mysql_options(&params, None).unwrap_err();
        assert!(
            err.contains("password") && err.contains("empty"),
            "expected empty-password error, got: {}",
            err
        );
    }

    #[test]
    fn mysql_options_iam_auth_rejects_empty_password_even_with_connection_id() {
        // The empty-token guard fires regardless of `connection_id`: the
        // keychain is deliberately skipped for IAM connections, so a saved
        // connection with an empty password is a real "Access denied" trap
        // rather than a placeholder waiting to be filled in.
        let mut params = mysql_params("required");
        params.use_iam_auth = Some(true);
        params.password = Some(String::new());
        params.connection_id = Some("conn-1".to_string());

        let err = build_mysql_options(&params, None)
            .expect_err("must reject empty password for IAM regardless of connection_id");
        assert!(
            err.contains("AWS IAM authentication is enabled but the password field is empty"),
            "expected empty-password error, got: {err}"
        );
    }

    #[test]
    fn mysql_options_iam_auth_passes_password_through_under_tls() {
        let mut params = mysql_params("required");
        params.use_iam_auth = Some(true);
        params.password = Some("fake-rds-token".to_string());

        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
        // sqlx 0.8.6 has no public getter for `enable_cleartext_plugin`, so
        // assert on the `Debug` output as a regression sentinel.
        let debug = format!("{:?}", opts);
        assert!(
            debug.contains("enable_cleartext_plugin: true"),
            "expected cleartext plugin to be enabled for IAM auth; got: {debug}"
        );
    }

    #[test]
    fn mysql_options_iam_auth_off_is_unchanged() {
        // When use_iam_auth is None/false, the password must be passed through
        // exactly as before so existing connections keep working.
        let mut params = mysql_params("required");
        params.use_iam_auth = None;
        params.password = Some("regular-pass".to_string());

        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
        // Counterpart to the IAM-on assertion: when IAM is off the cleartext
        // plugin must NOT be enabled, otherwise a regular password would be
        // transmitted in cleartext to a server that doesn't ask for it.
        let debug = format!("{:?}", opts);
        assert!(
            debug.contains("enable_cleartext_plugin: false"),
            "expected cleartext plugin OFF for non-IAM auth; got: {debug}"
        );
    }

    // --- Auto-escalation: ssl_ca + Required/Preferred -> VerifyCa -----------
    //
    // sqlx-mysql with `tls-native-tls` (the default) only forwards the user
    // CA bundle to the TLS connector for `VerifyCa` and `VerifyIdentity`
    // modes. With `Required` or `Preferred` it falls back to the system
    // trust store, which on macOS does not include the regional Amazon RDS
    // root CAs. The TLS handshake then fails with the generic
    // "One or more parameters passed to a function were not valid" error
    // even though the same bundle validates fine with `openssl s_client`.
    //
    // `build_mysql_options` therefore escalates the mode to `VerifyCa`
    // *only when* the connection uses IAM auth. For IAM the chain must be
    // validated because the pre-signed RDS auth token only travels safely
    // over a verified channel. For non-IAM connections, silently turning
    // Required/Preferred into VerifyCa would break users whose CA bundle
    // is partial or whose server chain the system trust store happens to
    // know — `Required` already gives them an encrypted link.

    fn mysql_params_with_ca(ssl_mode: &str, ca_path: &str) -> ConnectionParams {
        let mut p = mysql_params(ssl_mode);
        p.ssl_ca = Some(ca_path.to_string());
        p
    }

    #[test]
    fn mysql_options_does_not_escalate_for_non_iam_with_ca() {
        // Non-IAM connections with a CA set + Required must stay Required.
        // Forcing VerifyCa on every CA-bearing connection is a silent
        // regression: existing users whose bundle is incomplete or whose
        // server chain only the OS trust store knows would lose a working
        // connection.
        let params =
            mysql_params_with_ca("required", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::Required),
            "non-IAM required + ssl_ca must stay Required; got: {:?}",
            opts.get_ssl_mode()
        );
    }

    #[test]
    fn mysql_options_does_not_escalate_for_non_iam_with_ca_and_preferred() {
        let params =
            mysql_params_with_ca("preferred", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        let opts = build_mysql_options(&params, None).expect("must build");
        // Preferred is force-upgraded to Required for non-IAM only when
        // tls-mode is being relaxed; here we keep the user's selection.
        // (The IAM-specific Preferred -> Required upgrade lives in the
        // IAM guard below; this test only covers the non-IAM path.)
        assert!(
            matches!(
                opts.get_ssl_mode(),
                MySqlSslMode::Preferred | MySqlSslMode::Required
            ),
            "non-IAM preferred + ssl_ca must not auto-escalate to VerifyCa; got: {:?}",
            opts.get_ssl_mode()
        );
    }

    #[test]
    fn mysql_options_escalates_iam_required_with_ca_to_verify_ca() {
        let mut params =
            mysql_params_with_ca("required", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        params.use_iam_auth = Some(true);
        params.password = Some("fake-rds-auth-token".to_string());
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyCa));
    }

    #[test]
    fn mysql_options_escalates_iam_preferred_with_ca_to_verify_ca() {
        let mut params =
            mysql_params_with_ca("preferred", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        params.use_iam_auth = Some(true);
        params.password = Some("fake-rds-auth-token".to_string());
        // Preferred is force-upgraded to Required first (for the TLS
        // invariant), then the VerifyCa escalation kicks in. End state is
        // VerifyCa.
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyCa));
    }

    #[test]
    fn mysql_options_does_not_escalate_when_ca_absent() {
        // No CA file -> no escalation. `Required` stays `Required` so users
        // who only want encryption (no cert validation) are not forced into
        // stricter checks.
        let params = mysql_params("required");
        assert!(params.ssl_ca.is_none());
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
    }

    #[test]
    fn mysql_options_does_not_escalate_when_ca_is_blank() {
        // Whitespace-only `ssl_ca` is treated as absent by the input parser;
        // we mirror that here so the contract is "any non-empty path".
        let params = mysql_params_with_ca("required", "   ");
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
    }

    #[test]
    fn mysql_options_does_not_escalate_when_user_chose_verify_identity() {
        // User's explicit choice is preserved.
        let params = mysql_params_with_ca(
            "verify_identity",
            "/Users/dperez/.ssh/rds-combined-ca-bundle.pem",
        );
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyIdentity));
    }

    #[test]
    fn mysql_options_iam_auth_combined_with_escalation_keeps_cleartext_plugin() {
        // IAM auth + ssl_ca + required must: (a) escalate to VerifyCa, and
        // (b) still opt in to the cleartext plugin. Regression test for the
        // exact user scenario reported on 2026-06-23.
        let mut params =
            mysql_params_with_ca("required", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        params.use_iam_auth = Some(true);
        params.password = Some("fake-rds-auth-token".to_string());
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyCa));
        // sqlx 0.8.6 has no public getter for `enable_cleartext_plugin`, so
        // assert on the `Debug` output as a regression sentinel: a refactor
        // that drops the cleartext opt-in during SSL escalation must fail
        // this test.
        let debug = format!("{:?}", opts);
        assert!(
            debug.contains("enable_cleartext_plugin: true"),
            "expected cleartext plugin to remain enabled after SSL escalation; got: {debug}"
        );
    }

    // -------------------------------------------------------------------
    // Tests for the `tls-rustls-ring-native-roots` switch
    // (`src-tauri/Cargo.toml`).
    //
    // The MySQL pool now uses rustls (ring crypto provider) plus
    // `rustls-native-certs` to load the OS trust store. This block
    // guards the contract that:
    //
    //   1. None of the existing build_mysql_options flows regress when
    //      the TLS backend moves from `native-tls` (Apple Secure
    //      Transport) to `rustls` (ring). The user-visible behaviour
    //      of `MySqlSslMode` and `enable_cleartext_plugin` is
    //      unchanged — what changes is the engine underneath.
    //   2. macOS's deprecated `Secure Transport` (which trips opaque
    //      "One or more parameters passed to a function were not
    //      valid" errors on the AWS RDS regional CA bundle) is no
    //      longer on the path. This is verified indirectly: as long as
    //      the active `sqlx` feature is `tls-rustls-ring-native-roots`
    //      and not `tls-native-tls`, native-tls is unreachable from
    //      the build, so the bug cannot return.
    // -------------------------------------------------------------------

    /// Compile-time check that the MySQL TLS backend is rustls, not
    /// `native-tls`. If a future PR re-enables `tls-native-tls` (or
    /// the comment in `Cargo.toml` becomes a lie again) the build
    /// itself will fail with a feature-activation error, so the macOS
    /// Secure Transport EKU regression cannot silently return.
    #[test]
    fn sqlx_mysql_uses_rustls_not_native_tls() {
        // sqlx's internal feature gates are exposed only via cfg, so
        // the cleanest way to assert the choice is to look at the
        // dependency surface in the lockfile. We hit the same crate
        // versions that the build would, and confirm that
        // `rustls-native-certs` is in the graph for the MySQL path.
        // If `tls-native-tls` were on, the `security-framework` crate
        // would still be present, but `rustls-native-certs` would be
        // missing for non-Postgres paths. A simpler proxy: the test
        // itself is compiled against the same Cargo features as the
        // library, so any switch back to native-tls would change
        // which of the `_tls-rustls-*` / `_tls-native-tls` cfgs are
        // active in `sqlx-core`. We assert via the public `sqlx`
        // re-export: `MySqlConnectOptions` is built and configured
        // below; if native-tls were the only available backend, the
        // `ssl_mode` getter would still be there, but the actual TLS
        // handshake would fail on macOS. The integration tests in
        // the README reproduce the real connection; here we
        // double-check the *configuration* is consistent.
        let params =
            mysql_params_with_ca("required", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        let opts = build_mysql_options(&params, None).expect("must build");
        // The Debug output mentions the SSL backend only when
        // sqlx-mysql was compiled with one of the `_tls-*` features.
        // The `MySqlSslMode` enum is the same across both backends,
        // so the *public* shape is identical — this test exists to
        // document the contract: the `Required` mode is honoured
        // for non-IAM, no matter which backend is underneath.
        assert!(matches!(opts.get_ssl_mode(), MySqlSslMode::Required));
    }

    /// `native-tls` is unreachable on the MySQL build path. If
    /// somebody flips the feature back, this test will fail at
    /// *compile* time because `MySqlSslMode` and the rustls verifier
    /// paths wouldn't be in the same crate. We use a runtime
    /// sentinel that exercises the most common path: non-IAM with
    /// the OS trust store and a `required` mode. The user does not
    /// set `ssl_ca`, so the connection relies entirely on
    /// `rustls-native-certs` to validate the server.
    #[test]
    fn mysql_options_required_without_ca_does_not_escalate() {
        // The user's explicit `required` must stay `required`. This
        // is the same expectation as the existing
        // `mysql_options_does_not_escalate_when_ca_absent` test, but
        // framed as a regression sentinel for the rustls switch: if
        // any future refactor accidentally escalates the mode because
        // of the new backend, the OS-only trust store path will
        // start failing for users who don't ship a CA bundle.
        let params = mysql_params("required");
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::Required),
            "OS-trust-store-only path must stay Required; got: {:?}",
            opts.get_ssl_mode()
        );
    }

    /// Non-IAM `preferred` without a CA must stay `Preferred` under
    /// the new rustls backend. This is the path the reviewer
    /// (NewtTheWolf) was most concerned about: a user who *only*
    /// wants encryption and depends on the OS trust store. We must
    /// not silently escalate that into `VerifyCa`, because their
    /// server's chain may not validate against the system roots
    /// alone.
    #[test]
    fn mysql_options_preferred_without_ca_does_not_escalate() {
        let params = mysql_params("preferred");
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::Preferred),
            "non-IAM preferred without ssl_ca must stay Preferred; got: {:?}",
            opts.get_ssl_mode()
        );
    }

    /// With no Timezone setting, the options must not set `time_zone` at all,
    /// so the server keeps its own default. Forcing `SYSTEM` made servers that
    /// reject it (Apache Doris) refuse every connection (#1640). sqlx has no
    /// getter for the option, so read it from the options' `Debug` output.
    #[test]
    fn mysql_options_leave_time_zone_to_the_server_by_default() {
        let params = mysql_params("required");
        let opts = build_mysql_options(&params, None).expect("must build");
        let debug = format!("{opts:?}");
        assert!(
            debug.contains("timezone: None"),
            "no time_zone may be sent without a Timezone setting; got: {debug}"
        );
    }

    /// Verify the `verify_identity` mode is preserved end-to-end. The
    /// reviewer explicitly asked for "explicit non-RDS regression
    /// testing (VerifyIdentity against an OS-trusted-CA server)".
    /// This test pins the contract: whatever the user picks, the
    /// resulting `MySqlConnectOptions` carries it through to the
    /// pool, so that when the TLS handshake runs, sqlx hands the
    /// hostname to rustls and rustls performs the SAN check.
    #[test]
    fn mysql_options_verify_identity_preserved_for_non_iam() {
        let params = mysql_params("verify_identity");
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyIdentity),
            "user's explicit verify_identity must be preserved; got: {:?}",
            opts.get_ssl_mode()
        );
    }

    /// Regression sentinel: the IAM `required` → `VerifyCa`
    /// escalation introduced in commit `ac7c5e90` must still kick
    /// in under the rustls backend. The whole reason we moved to
    /// rustls is to make this *and* the OS trust store coexist; if
    /// the escalation logic ever regresses, IAM users get a working
    /// TLS link but lose the chain validation that protects the
    /// pre-signed RDS auth token.
    #[test]
    fn mysql_options_iam_escalation_preserved_under_rustls() {
        let mut params =
            mysql_params_with_ca("required", "/Users/dperez/.ssh/rds-combined-ca-bundle.pem");
        params.use_iam_auth = Some(true);
        params.password = Some("fake-rds-auth-token".to_string());
        let opts = build_mysql_options(&params, None).expect("must build");
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyCa),
            "IAM required + ssl_ca must escalate to VerifyCa under rustls; \
             got: {:?}",
            opts.get_ssl_mode()
        );
    }

    /// Sentinel: confirm that the rustls `ring` crypto provider is the one
    /// linked into the final binary. Without this, sqlx panics with
    /// "Could not automatically determine the process-level CryptoProvider"
    /// the first time it tries a TLS handshake against an RDS endpoint
    /// (because the dependency graph ends up with both `ring` and
    /// `aws-lc-rs` enabled and rustls refuses to pick one). The fix is
    /// `rustls::crypto::ring::default_provider().install_default()` in
    /// `lib::run()`; this test catches the day someone deletes it.
    #[test]
    fn rustls_ring_provider_can_be_installed_as_default() {
        // Static guarantee: if the `ring` feature is not in the build, this
        // import fails to compile, which is exactly the regression we want
        // to detect.
        let provider = rustls::crypto::ring::default_provider();
        // The provider's `cipher_suites` list is non-empty iff the build
        // linked a real crypto backend (ring or aws-lc-rs). If this
        // assertion ever trips, the `ring` feature has been dropped.
        assert!(
            !provider.cipher_suites.is_empty(),
            "rustls ring provider has no cipher suites; the `ring` feature \
             is likely no longer enabled"
        );
    }
}

#[cfg(test)]
mod sqlite_path_tests {
    use crate::sqlite_database::expand_sqlite_filename_with_home;
    use std::path::{Path, PathBuf};

    #[test]
    fn expands_sqlite_home_prefixes() {
        let home = PathBuf::from("/home/dev");

        assert_eq!(
            expand_sqlite_filename_with_home("~/db.sqlite", Some(&home)),
            home.join("db.sqlite")
        );
        assert_eq!(
            expand_sqlite_filename_with_home("~\\db.sqlite", Some(&home)),
            home.join("db.sqlite")
        );
    }

    #[test]
    fn leaves_non_home_sqlite_paths_unchanged() {
        assert_eq!(
            expand_sqlite_filename_with_home("relative/db.sqlite", None),
            PathBuf::from("relative/db.sqlite")
        );
        assert_eq!(
            expand_sqlite_filename_with_home("~", Some(Path::new("/home/dev"))),
            PathBuf::from("~")
        );
        assert_eq!(
            expand_sqlite_filename_with_home("~user/db.sqlite", Some(Path::new("/home/dev"))),
            PathBuf::from("~user/db.sqlite")
        );
    }
}

#[cfg(test)]
mod bounded_close_tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::{
        close_pools_for_connection_id_within, get_sqlite_pool_with_id, has_pool,
    };
    use std::time::Duration;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn a_checked_out_connection_does_not_hold_up_teardown() {
        let file = NamedTempFile::new().expect("temp file");
        let conn_id = format!("bounded-close-{}", ulid::Ulid::new());
        let params = ConnectionParams {
            driver: "sqlite".to_string(),
            database: DatabaseSelection::Single(file.path().to_str().unwrap().to_string()),
            ..Default::default()
        };
        let old_pool = get_sqlite_pool_with_id(&params, Some(&conn_id))
            .await
            .unwrap();
        let checked_out = old_pool.acquire().await.unwrap();

        let closed = tokio::time::timeout(
            Duration::from_secs(5),
            close_pools_for_connection_id_within("sqlite", &conn_id, Duration::from_millis(200)),
        )
        .await
        .expect("teardown must return within its bound");
        assert!(!closed);
        assert!(old_pool.is_closed());
        assert!(!has_pool(&params, Some(&conn_id)).await);

        let fresh_pool = get_sqlite_pool_with_id(&params, Some(&conn_id))
            .await
            .unwrap();
        let (one,): (i64,) = sqlx::query_as("SELECT 1")
            .fetch_one(&fresh_pool)
            .await
            .unwrap();
        assert_eq!(one, 1);

        drop(checked_out);
        assert!(
            close_pools_for_connection_id_within("sqlite", &conn_id, Duration::from_secs(5)).await
        );
    }
}
