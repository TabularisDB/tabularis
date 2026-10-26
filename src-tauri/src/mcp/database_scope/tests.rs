use super::*;

fn params(driver: &str, database: DatabaseSelection) -> ConnectionParams {
    ConnectionParams {
        driver: driver.to_string(),
        database,
        ..Default::default()
    }
}

#[test]
fn network_drivers_only_allow_configured_database_names() {
    for driver in ["postgres", "mysql", "custom-network-plugin"] {
        for selection in [
            DatabaseSelection::Single("sandbox".to_string()),
            DatabaseSelection::Multiple(vec!["sandbox".to_string(), "analytics".to_string()]),
        ] {
            for requested in [
                "production",
                "Sandbox",
                "sandbox ",
                " sandbox",
                "../private",
                "",
            ] {
                let mut connection = params(driver, selection.clone());
                let error = apply_database_override(
                    &mut connection,
                    Some(requested),
                    &DriverCapabilities::default(),
                )
                .expect_err("unconfigured databases must be rejected");
                assert_eq!(error.code, -32602);
                assert_eq!(
                    connection.database, selection,
                    "rejection must not mutate params"
                );
            }
        }
    }
}

#[test]
fn configured_single_and_multiple_databases_remain_selectable() {
    let capabilities = DriverCapabilities::default();
    for driver in ["postgres", "mysql", "custom-network-plugin"] {
        for selection in [
            DatabaseSelection::Single("sandbox".to_string()),
            DatabaseSelection::Multiple(vec!["sandbox".to_string(), "analytics".to_string()]),
        ] {
            for requested in selection.as_vec() {
                let mut connection = params(driver, selection.clone());
                apply_database_override(&mut connection, Some(&requested), &capabilities).unwrap();
                assert_eq!(connection.database, DatabaseSelection::Single(requested));
            }
        }
    }
}

#[test]
fn empty_selections_do_not_authorize_database_overrides() {
    for selection in [
        DatabaseSelection::default(),
        DatabaseSelection::Multiple(vec![]),
    ] {
        let mut connection = params("custom-network-plugin", selection.clone());
        assert!(apply_database_override(
            &mut connection,
            Some("production"),
            &DriverCapabilities::default(),
        )
        .is_err());
        assert_eq!(connection.database, selection);
    }
}

#[test]
fn local_and_implicit_database_capabilities_reject_overrides() {
    // Plugin IDs need not identify the storage model; capabilities do.
    for capabilities in [
        DriverCapabilities {
            file_based: true,
            ..Default::default()
        },
        DriverCapabilities {
            folder_based: true,
            ..Default::default()
        },
        DriverCapabilities {
            single_database: true,
            ..Default::default()
        },
    ] {
        for requested in [
            "/tmp/sandbox.sqlite",
            "/tmp/private.sqlite",
            "~/private.sqlite",
            "../private.sqlite",
            "file:/tmp/private.sqlite?mode=ro",
            ":memory:",
        ] {
            let saved = DatabaseSelection::Single("/tmp/sandbox.sqlite".to_string());
            let mut connection = params("custom-storage-plugin", saved.clone());
            let error = apply_database_override(&mut connection, Some(requested), &capabilities)
                .expect_err("MCP must not replace a local path or implicit database");
            assert_eq!(error.code, -32602);
            assert_eq!(connection.database, saved);
        }
    }
}

#[test]
fn omitted_database_preserves_every_connection_type() {
    for capabilities in [
        DriverCapabilities::default(),
        DriverCapabilities {
            file_based: true,
            ..Default::default()
        },
        DriverCapabilities {
            folder_based: true,
            ..Default::default()
        },
        DriverCapabilities {
            single_database: true,
            ..Default::default()
        },
    ] {
        let saved =
            DatabaseSelection::Multiple(vec!["sandbox".to_string(), "analytics".to_string()]);
        let mut connection = params("custom-plugin", saved.clone());
        apply_database_override(&mut connection, None, &capabilities).unwrap();
        assert_eq!(connection.database, saved);
    }
}
