use super::*;

#[test]
fn types_list_is_non_empty() {
    let types = get_data_types();
    assert!(!types.is_empty());
}

#[test]
fn int_supports_auto_increment() {
    let types = get_data_types();
    let int_type = types
        .iter()
        .find(|t| t.name == "INT")
        .expect("INT must be present");
    assert!(int_type.supports_auto_increment);
}

#[test]
fn varchar_requires_length() {
    let types = get_data_types();
    let t = types
        .iter()
        .find(|t| t.name == "VARCHAR")
        .expect("VARCHAR must be present");
    assert!(t.requires_length);
}

#[test]
fn decimal_requires_precision() {
    let types = get_data_types();
    let t = types
        .iter()
        .find(|t| t.name == "DECIMAL")
        .expect("DECIMAL must be present");
    assert!(t.requires_precision);
}
