use super::classify;

#[test]
fn only_registered_kind_tags_count_regardless_of_position() {
    let kinds = vec!["driver".into(), "theme".into(), "extension".into()];
    assert_eq!(
        classify(&["blue".into(), "theme".into()], &kinds).as_deref(),
        Some("theme")
    );
    assert_eq!(
        classify(&["postgres".into(), "driver".into()], &kinds).as_deref(),
        Some("driver")
    );
    assert_eq!(
        classify(&["extension".into()], &kinds).as_deref(),
        Some("extension")
    );
    assert_eq!(classify(&["postgres".into(), "sql".into()], &kinds), None);
    assert_eq!(classify(&[], &kinds), None);
    assert_eq!(
        classify(&["driver".into(), "theme".into()], &kinds).as_deref(),
        Some("unsupported:ambiguous-kind")
    );
}
