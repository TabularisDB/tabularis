use super::parse_text_connection_id;

#[test]
fn parses_decimal_connection_ids() {
    assert_eq!(parse_text_connection_id("1611").unwrap(), 1611);
    assert_eq!(
        parse_text_connection_id("18446744073709551615").unwrap(),
        u64::MAX
    );
}

#[test]
fn rejects_invalid_or_out_of_range_connection_ids() {
    for value in ["", "-1", "+1", "1 ", "1.5", "abc", "18446744073709551616"] {
        assert!(
            parse_text_connection_id(value).is_err(),
            "accepted {value:?}"
        );
    }
}
