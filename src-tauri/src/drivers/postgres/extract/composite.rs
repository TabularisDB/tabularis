use serde_json::{Map, Value as JsonValue};
use tokio_postgres::types::{Field, Kind};

use super::common::split_at_value_len;

#[inline]
pub fn extract_or_null(fields: &Vec<Field>, buf: &mut &[u8]) -> JsonValue {
    if buf.len() == 0 {
        // receiving an empty buffer is an error but it indicates a null value
        // log::error!("received empty buffer");
        return JsonValue::Null;
    };

    let mut map = serde_json::Map::with_capacity(fields.len());
    // ignore the error and return only the successfully extracted elements
    // and fill the map with nulls for any remaining fields
    extract_or_fill_nulls_into(fields, buf, &mut map);
    JsonValue::Object(map)
}

fn extract_or_fill_nulls_into(
    fields: &Vec<Field>,
    buf: &mut &[u8],
    map: &mut Map<String, JsonValue>,
) {
    // skip the composite length we already have fields
    if let Err(_) = super::common::advance_buf(buf, 4) {
        fill_nulls(fields, map);
        return;
    };

    let mut field;
    for i in 0..fields.len() {
        field = &fields[i];

        // skip the field type OID
        if let Err(_) = super::common::advance_buf(buf, 4) {
            fill_nulls(&fields[i..], map);
            return;
        }

        match try_extract_field(field, buf) {
            Ok(value) => {
                map.insert(field.name().to_string(), value);
            }
            Err(_) => {
                map.insert(field.name().to_string(), JsonValue::Null);

                if i + 1 < fields.len() {
                    // insert the rest of the fields with null values
                    fill_nulls(&fields[i + 1..], map);
                    return;
                }
            }
        }
    }
}

#[inline(always)]
fn fill_nulls(fields: &[Field], map: &mut Map<String, JsonValue>) {
    fields.iter().for_each(|f| {
        map.insert(f.name().to_string(), JsonValue::Null);
    });
}

#[inline]
/// the idea of returning a `Result` is to stop extracting further if error occurs
/// because it is most likely to fail anyway
fn try_extract_field(field: &Field, buf: &mut &[u8]) -> Result<JsonValue, ()> {
    let mut value_buf = match split_at_value_len(buf)? {
        Some(buf) => buf,
        None => return Ok(JsonValue::Null),
    };

    let ty = field.type_();

    Ok(match ty.kind() {
        Kind::Simple => super::simple::extract_or_null(ty, value_buf),
        Kind::Enum(_variants) => super::r#enum::extract_or_null(value_buf),
        Kind::Array(of) => super::array::extract_or_null(of, &mut value_buf),
        Kind::Range(ty) => super::range::extract_or_null(ty, &mut value_buf),
        Kind::Multirange(ty) => super::multi_range::extract_or_null(ty, &mut value_buf),
        Kind::Domain(ty) => super::simple::extract_or_null(ty, value_buf),
        Kind::Composite(fields) => extract_or_null(fields, buf),
        _ => JsonValue::Null,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_postgres::types::Type;

    fn build_composite_buf(field_values: &[(u32, Option<i32>)]) -> Vec<u8> {
        let mut payload = Vec::new();
        for &(oid, val) in field_values {
            payload.extend_from_slice(&oid.to_be_bytes());
            match val {
                Some(v) => {
                    payload.extend_from_slice(&4i32.to_be_bytes());
                    payload.extend_from_slice(&v.to_be_bytes());
                }
                None => {
                    payload.extend_from_slice(&(-1i32).to_be_bytes());
                }
            }
        }
        let composite_len = payload.len() as i32;
        let mut buf = Vec::with_capacity(4 + payload.len());
        buf.extend_from_slice(&composite_len.to_be_bytes());
        buf.extend_from_slice(&payload);
        buf
    }

    #[test]
    fn test_empty_buffer_returns_null() {
        let fields = vec![Field::new("id".to_string(), Type::INT4)];
        let mut buf = &[][..];
        assert_eq!(extract_or_null(&fields, &mut buf), JsonValue::Null);
    }

    #[test]
    fn test_single_int4_field() {
        let fields = vec![Field::new("id".to_string(), Type::INT4)];
        let buf = build_composite_buf(&[(Type::INT4.oid(), Some(42))]);
        let mut slice = &buf[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("id").unwrap(), &JsonValue::Number(42.into()));
    }

    #[test]
    fn test_multiple_int4_fields() {
        let fields = vec![
            Field::new("a".to_string(), Type::INT4),
            Field::new("b".to_string(), Type::INT4),
            Field::new("c".to_string(), Type::INT4),
        ];
        let buf = build_composite_buf(&[
            (Type::INT4.oid(), Some(10)),
            (Type::INT4.oid(), Some(20)),
            (Type::INT4.oid(), Some(30)),
        ]);
        let mut slice = &buf[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("a").unwrap(), &JsonValue::Number(10.into()));
        assert_eq!(obj.get("b").unwrap(), &JsonValue::Number(20.into()));
        assert_eq!(obj.get("c").unwrap(), &JsonValue::Number(30.into()));
    }

    #[test]
    fn test_null_field_value() {
        let fields = vec![
            Field::new("x".to_string(), Type::INT4),
            Field::new("y".to_string(), Type::INT4),
        ];
        let buf = build_composite_buf(&[(Type::INT4.oid(), Some(99)), (Type::INT4.oid(), None)]);
        let mut slice = &buf[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("x").unwrap(), &JsonValue::Number(99.into()));
        assert_eq!(obj.get("y").unwrap(), &JsonValue::Null);
    }

    #[test]
    fn test_all_null_fields() {
        let fields = vec![
            Field::new("a".to_string(), Type::TEXT),
            Field::new("b".to_string(), Type::INT4),
        ];
        let buf = build_composite_buf(&[(Type::TEXT.oid(), None), (Type::INT4.oid(), None)]);
        let mut slice = &buf[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("a").unwrap(), &JsonValue::Null);
        assert_eq!(obj.get("b").unwrap(), &JsonValue::Null);
    }

    #[test]
    fn test_truncated_composite_fills_remaining_with_nulls() {
        let fields = vec![
            Field::new("first".to_string(), Type::INT4),
            Field::new("second".to_string(), Type::INT4),
        ];
        let full_buf =
            build_composite_buf(&[(Type::INT4.oid(), Some(1)), (Type::INT4.oid(), Some(2))]);
        let truncated = &full_buf[..16];
        let mut slice = &truncated[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("first").unwrap(), &JsonValue::Number(1.into()));
        assert_eq!(obj.get("second").unwrap(), &JsonValue::Null);
    }

    #[test]
    fn test_composite_with_text_field() {
        let fields = vec![Field::new("name".to_string(), Type::TEXT)];
        let name_bytes = b"alice";
        let mut payload = Vec::new();
        payload.extend_from_slice(&Type::TEXT.oid().to_be_bytes());
        payload.extend_from_slice(&(name_bytes.len() as i32).to_be_bytes());
        payload.extend_from_slice(name_bytes);
        let composite_len = payload.len() as i32;
        let mut buf = Vec::new();
        buf.extend_from_slice(&composite_len.to_be_bytes());
        buf.extend_from_slice(&payload);
        let mut slice = &buf[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(
            obj.get("name").unwrap(),
            &JsonValue::String("alice".to_string())
        );
    }

    #[test]
    fn test_composite_with_bool_field() {
        let fields = vec![Field::new("active".to_string(), Type::BOOL)];
        let mut payload = Vec::new();
        payload.extend_from_slice(&Type::BOOL.oid().to_be_bytes());
        payload.extend_from_slice(&1i32.to_be_bytes());
        payload.push(1u8);
        let composite_len = payload.len() as i32;
        let mut buf = Vec::new();
        buf.extend_from_slice(&composite_len.to_be_bytes());
        buf.extend_from_slice(&payload);
        let mut slice = &buf[..];
        let result = extract_or_null(&fields, &mut slice);
        let obj = result.as_object().unwrap();
        assert_eq!(obj.get("active").unwrap(), &JsonValue::Bool(true));
    }

    // `serde_json::Map` does not preserve field order, so this test is not applicable
    // #[test]
    // fn test_composite_preserves_field_order() {
    //     let fields = vec![
    //         Field::new("z_last".to_string(), Type::INT4),
    //         Field::new("a_first".to_string(), Type::INT4),
    //         Field::new("m_middle".to_string(), Type::INT4),
    //     ];
    //     let buf = build_composite_buf(&[
    //         (Type::INT4.oid(), Some(1)),
    //         (Type::INT4.oid(), Some(2)),
    //         (Type::INT4.oid(), Some(3)),
    //     ]);
    //     let mut slice = &buf[..];
    //     let result = extract_or_null(&fields, &mut slice);
    //     let obj = result.as_object().unwrap();
    //     let keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
    //     assert_eq!(keys, vec!["z_last", "a_first", "m_middle"]);
    // }
}
