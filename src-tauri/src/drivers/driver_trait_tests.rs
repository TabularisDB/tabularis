use crate::drivers::driver_trait::deprecation_for_builtin;

#[test]
fn postgres_is_deprecated_in_favour_of_the_postgresql_plugin() {
    let info = deprecation_for_builtin("postgres").expect("postgres is deprecated");
    assert_eq!(info.replacement_id, Some("postgresql".to_string()));
    assert_eq!(info.removal_date, Some("2026-10-05".to_string()));
    assert_eq!(info.removal_version, None);
}

#[test]
fn drivers_without_a_wired_deprecation_return_none() {
    // mysql/sqlite are expected to follow the same path later, but aren't
    // deprecated yet — and an unknown id must not panic or default to some
    // other driver's entry.
    assert!(deprecation_for_builtin("mysql").is_none());
    assert!(deprecation_for_builtin("sqlite").is_none());
    assert!(deprecation_for_builtin("not-a-real-driver").is_none());
}
