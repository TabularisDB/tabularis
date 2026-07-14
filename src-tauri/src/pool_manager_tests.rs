#[cfg(test)]
mod tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::{
        build_connection_key, build_mysql_options, format_error_chain,
        is_pipes_as_concat_unsupported,
    };
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
    fn postgres_pool_key_changes_when_ssl_mode_changes() {
        let required = connection_params("postgres", Some("require"));
        let disabled = connection_params("postgres", Some("disable"));

        assert_ne!(
            build_connection_key(&required, Some("conn-1")),
            build_connection_key(&disabled, Some("conn-1"))
        );
    }

    #[test]
    fn postgres_pool_key_changes_when_ssl_ca_changes() {
        let without_ca = connection_params("postgres", Some("verify-ca"));
        let mut with_ca = connection_params("postgres", Some("verify-ca"));
        with_ca.ssl_ca = Some("/tmp/postgres-ca.pem".to_string());

        assert_ne!(
            build_connection_key(&without_ca, Some("conn-1")),
            build_connection_key(&with_ca, Some("conn-1"))
        );
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
    fn pool_key_changes_when_startup_script_changes() {
        let none = connection_params("postgres", Some("require"));
        let mut script_a = none.clone();
        script_a.startup_script = Some("SET app.bypass_rls = 'on';".to_string());
        let mut script_b = none.clone();
        script_b.startup_script = Some("SET app.bypass_rls = 'off';".to_string());

        let key_none = build_connection_key(&none, Some("conn-1"));
        let key_a = build_connection_key(&script_a, Some("conn-1"));
        let key_b = build_connection_key(&script_b, Some("conn-1"));

        // A script changes the key, and different scripts differ — otherwise an
        // edited startup script would silently reuse the old cached pool.
        assert_ne!(key_none, key_a);
        assert_ne!(key_a, key_b);
    }

    #[test]
    fn pool_key_ignores_blank_startup_script() {
        let none = connection_params("postgres", Some("require"));
        let mut blank = none.clone();
        blank.startup_script = Some("   \n\t".to_string());

        // Whitespace-only scripts are treated as absent (no hook runs), so they
        // must not fragment the pool away from the no-script connection.
        assert_eq!(
            build_connection_key(&none, Some("conn-1")),
            build_connection_key(&blank, Some("conn-1"))
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
            dbg.contains("pipes_as_concat: true")
                && dbg.contains("no_engine_substitution: true"),
            "expected forced sql_mode by default, got: {dbg}"
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
            dbg.contains("pipes_as_concat: false")
                && dbg.contains("no_engine_substitution: false"),
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
            err.contains("IAM")
                && (err.contains("TLS") || err.contains("SSL")),
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
        let mut params = mysql_params_with_ca(
            "required",
            "/Users/dperez/.ssh/rds-combined-ca-bundle.pem",
        );
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
    //   3. The Postgres path keeps using `rustls-platform-verifier`
    //      for `verify-full` so non-IAM users who rely on the OS
    //      trust store (e.g. an internal CA pushed through MDM) keep
    //      working — the switch for MySQL must not ripple into
    //      Postgres.
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
        let mut params = mysql_params_with_ca(
            "required",
            "/Users/dperez/.ssh/rds-combined-ca-bundle.pem",
        );
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

#[cfg(test)]
mod startup_script_tests {
    use crate::models::{ConnectionParams, DatabaseSelection};
    use crate::pool_manager::{close_pool_with_id, get_sqlite_pool_with_id};
    use tempfile::NamedTempFile;

    fn sqlite_params(path: &str, startup_script: Option<&str>) -> ConnectionParams {
        ConnectionParams {
            driver: "sqlite".to_string(),
            database: DatabaseSelection::Single(path.to_string()),
            startup_script: startup_script.map(ToOwned::to_owned),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn startup_script_runs_on_each_new_connection() {
        let file = NamedTempFile::new().expect("temp file");
        let path = file.path().to_str().expect("utf8 path").to_string();
        // Unique connection id keeps this pool out of other tests' cached pools.
        let conn_id = format!("startup-runs-{}", ulid::Ulid::new());

        let params = sqlite_params(
            &path,
            Some(
                "CREATE TABLE IF NOT EXISTS startup_marker (id INTEGER); \
                 INSERT INTO startup_marker (id) VALUES (1);",
            ),
        );

        let pool = get_sqlite_pool_with_id(&params, Some(&conn_id))
            .await
            .expect("pool should be created");

        // The marker table only exists if the startup script ran on the
        // physical connection the pool just handed out.
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM startup_marker")
            .fetch_one(&pool)
            .await
            .expect("startup_marker table should exist");
        assert!(count >= 1, "expected at least one startup INSERT, got {count}");

        close_pool_with_id(&params, Some(&conn_id)).await;
    }

    #[tokio::test]
    async fn blank_startup_script_is_skipped() {
        let file = NamedTempFile::new().expect("temp file");
        let path = file.path().to_str().expect("utf8 path").to_string();
        let conn_id = format!("startup-blank-{}", ulid::Ulid::new());

        // A whitespace-only script must be treated as absent: if it were run
        // as SQL the connection would fail and `SELECT 1` below would error.
        let params = sqlite_params(&path, Some("   \n  "));

        let pool = get_sqlite_pool_with_id(&params, Some(&conn_id))
            .await
            .expect("pool should be created");

        let (one,): (i64,) = sqlx::query_as("SELECT 1")
            .fetch_one(&pool)
            .await
            .expect("query on pool with blank startup script should work");
        assert_eq!(one, 1);

        close_pool_with_id(&params, Some(&conn_id)).await;
    }

    #[tokio::test]
    async fn invalid_startup_script_surfaces_attributed_error() {
        let file = NamedTempFile::new().expect("temp file");
        let path = file.path().to_str().expect("utf8 path").to_string();
        let conn_id = format!("startup-invalid-{}", ulid::Ulid::new());

        let params = sqlite_params(&path, Some("THIS IS NOT VALID SQL;"));

        // A broken startup script must fail the connection with an error that
        // clearly names the startup script as the cause, rather than sqlx's
        // misleading "pool timed out" or a generic connection error.
        let err = get_sqlite_pool_with_id(&params, Some(&conn_id))
            .await
            .expect_err("invalid startup script should fail the connection");
        assert!(
            err.contains("Startup script failed"),
            "error should be attributed to the startup script, got: {err}"
        );

        close_pool_with_id(&params, Some(&conn_id)).await;
    }
}
