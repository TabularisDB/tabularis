use super::extract_or_null;
use serde_json::Value;
use tokio_postgres::types::Type;

#[test]
fn float4_preserves_short_decimal_values() {
    for (value, expected) in [
        (89.9f32, 89.9f64),
        (59.99, 59.99),
        (29.5, 29.5),
        (-89.9, -89.9),
        (0.1, 0.1),
        (1.2345678, 1.2345678),
    ] {
        let result = extract_or_null(&Type::FLOAT4, &value.to_be_bytes());
        assert_eq!(result, Value::from(expected), "input: {value}");
    }
}

#[test]
fn float4_extremes_round_trip_without_losing_precision() {
    for value in [
        f32::MAX,
        f32::MIN,
        f32::MIN_POSITIVE,
        f32::from_bits(1),
        f32::from_bits(0x15ae43fd),
        -f32::from_bits(0x15ae43fd),
        -0.0,
    ] {
        let result = extract_or_null(&Type::FLOAT4, &value.to_be_bytes());
        let decoded = result.as_f64().expect("finite float4 is a JSON number") as f32;
        assert_eq!(decoded.to_bits(), value.to_bits(), "input: {value}");
    }
}

#[test]
fn float4_non_finite_and_invalid_values_remain_null() {
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert_eq!(
            extract_or_null(&Type::FLOAT4, &value.to_be_bytes()),
            Value::Null,
        );
    }
    assert_eq!(extract_or_null(&Type::FLOAT4, &[0, 0, 0]), Value::Null);
}

#[test]
fn float8_retains_double_precision() {
    let value = 89.9000015258789f64;
    assert_eq!(
        extract_or_null(&Type::FLOAT8, &value.to_be_bytes()),
        Value::from(value),
    );
}

#[test]
fn float4_arrays_and_composites_preserve_short_decimals_and_nulls() {
    use super::super::{array, composite};
    use tokio_postgres::types::Field;

    let mut array_bytes = Vec::new();
    for header in [1i32, 1, Type::FLOAT4.oid() as i32, 3, 1] {
        array_bytes.extend_from_slice(&header.to_be_bytes());
    }
    for value in [Some(89.9f32), None, Some(59.99)] {
        match value {
            Some(value) => {
                array_bytes.extend_from_slice(&4i32.to_be_bytes());
                array_bytes.extend_from_slice(&value.to_be_bytes());
            }
            None => array_bytes.extend_from_slice(&(-1i32).to_be_bytes()),
        }
    }
    assert_eq!(
        array::extract_or_null(&Type::FLOAT4, &mut array_bytes.as_slice()),
        serde_json::json!([89.9, null, 59.99]),
    );

    let mut composite_bytes = 2i32.to_be_bytes().to_vec();
    for (ty, bytes) in [
        (Type::FLOAT4, 89.9f32.to_be_bytes().to_vec()),
        (Type::FLOAT4_ARRAY, array_bytes),
    ] {
        composite_bytes.extend_from_slice(&ty.oid().to_be_bytes());
        composite_bytes.extend_from_slice(&(bytes.len() as i32).to_be_bytes());
        composite_bytes.extend_from_slice(&bytes);
    }
    let fields = vec![
        Field::new("price".to_string(), Type::FLOAT4),
        Field::new("prices".to_string(), Type::FLOAT4_ARRAY),
    ];
    assert_eq!(
        composite::extract_or_null(&fields, &mut composite_bytes.as_slice()),
        serde_json::json!({"price": 89.9, "prices": [89.9, null, 59.99]}),
    );
}
