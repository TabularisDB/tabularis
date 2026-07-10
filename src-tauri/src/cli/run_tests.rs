use super::run::{effective_limit, override_database};
use crate::models::{ConnectionParams, DatabaseSelection};

// --- effective_limit ----------------------------------------------------------

#[test]
fn effective_limit_zero_means_unlimited() {
    assert_eq!(effective_limit(0), None);
}

#[test]
fn effective_limit_passes_positive_values_through() {
    assert_eq!(effective_limit(1), Some(1));
    assert_eq!(effective_limit(100), Some(100));
}

// --- override_database ----------------------------------------------------------

fn multi_db_params() -> ConnectionParams {
    ConnectionParams {
        driver: "mysql".to_string(),
        database: DatabaseSelection::Multiple(vec![
            "first_db".to_string(),
            "second_db".to_string(),
        ]),
        ..Default::default()
    }
}

#[test]
fn override_database_scopes_to_single_database() {
    let mut params = multi_db_params();
    override_database(&mut params, Some("second_db".to_string()));
    assert_eq!(params.database.primary(), "second_db");
    assert!(!params.database.is_multi());
}

#[test]
fn override_database_none_keeps_existing_selection() {
    let mut params = multi_db_params();
    override_database(&mut params, None);
    assert_eq!(params.database.primary(), "first_db");
    assert!(params.database.is_multi());
}

#[test]
fn override_database_allows_databases_outside_the_saved_list() {
    // Server permissions decide access, mirroring the GUI's database picker.
    let mut params = multi_db_params();
    override_database(&mut params, Some("information_schema".to_string()));
    assert_eq!(params.database.primary(), "information_schema");
}
