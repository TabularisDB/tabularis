use super::*;

// --- f64_to_json ------------------------------------------------------

#[test]
fn f64_to_json_wraps_finite_numbers() {
    let v = f64_to_json(3.14);
    assert_eq!(
        v,
        Value::Number(serde_json::Number::from_f64(3.14).unwrap())
    );
    let v = f64_to_json(0.0);
    assert_eq!(v, Value::Number(serde_json::Number::from_f64(0.0).unwrap()));
    let v = f64_to_json(-1e10);
    assert_eq!(
        v,
        Value::Number(serde_json::Number::from_f64(-1e10).unwrap())
    );
}

#[test]
fn f64_to_json_stringifies_nan_and_infinity() {
    assert_eq!(f64_to_json(f64::NAN), Value::String("NaN".into()));
    assert_eq!(f64_to_json(f64::INFINITY), Value::String("inf".into()));
    assert_eq!(f64_to_json(f64::NEG_INFINITY), Value::String("-inf".into()));
}

// --- normalize_decimal_string -----------------------------------------

#[test]
fn normalize_decimal_trims_trailing_zeros() {
    assert_eq!(normalize_decimal_string("3.1400"), "3.14");
    assert_eq!(normalize_decimal_string("3.100"), "3.1");
    assert_eq!(normalize_decimal_string("0.50"), "0.5");
}

#[test]
fn normalize_decimal_drops_trailing_dot() {
    assert_eq!(normalize_decimal_string("10.0"), "10");
    assert_eq!(normalize_decimal_string("100.000"), "100");
    assert_eq!(normalize_decimal_string("-42.000"), "-42");
}

#[test]
fn normalize_decimal_leaves_integers_alone() {
    assert_eq!(normalize_decimal_string("10"), "10");
    assert_eq!(normalize_decimal_string("-42"), "-42");
    assert_eq!(normalize_decimal_string("0"), "0");
}

#[test]
fn normalize_decimal_preserves_significant_digits() {
    assert_eq!(normalize_decimal_string("3.14159"), "3.14159");
    assert_eq!(normalize_decimal_string("0.00001"), "0.00001");
    assert_eq!(normalize_decimal_string("1.23"), "1.23");
}

#[test]
fn normalize_decimal_handles_zero_with_fraction() {
    assert_eq!(normalize_decimal_string("0.0"), "0");
    assert_eq!(normalize_decimal_string("0.000"), "0");
}
