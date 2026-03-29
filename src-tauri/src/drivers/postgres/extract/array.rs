use serde_json::Value as JsonValue;
use tokio_postgres::types::{Kind, Type};

use super::common::split_at_value_len;

pub fn extract_or_null(ty: &Type, buf: &mut &[u8]) -> JsonValue {
    // array must be at least 12 bytes (header) except if it is `NULL`
    if buf.len() == 0 {
        return JsonValue::Null;
    };

    if buf.len() < 12 {
        log::error!("array buffer too short: {}", buf.len());
        return JsonValue::Null;
    };

    let dimensions = i32::from_be_bytes(buf[..4].try_into().unwrap());

    // this means empty array
    if dimensions < 1 {
        return JsonValue::Array(vec![]);
    };

    // max dimensions is 64 and just for safety
    if dimensions > 64 {
        log::error!("too many dimensions: {}", dimensions);
        return JsonValue::Null;
    }

    // ignore `has nulls` 4 bytes
    // ignore `element type` 4 bytes because we already have it
    *buf = &buf[12..];

    let dimensions = dimensions as usize;

    // each dimension must have at least 8 bytes info
    if buf.len() < 8 * dimensions {
        log::error!("array buffer too short: {}", buf.len());
        return JsonValue::Null;
    };

    let mut total_vecs: usize = 1;
    let mut arr_lengths = Vec::with_capacity(dimensions);

    for i in 0..dimensions {
        let length = i32::from_be_bytes(buf[..4].try_into().unwrap());

        // i don't think this is possible but just in case
        if length < 0 {
            log::error!("invalid length: {}", length);
            return JsonValue::Null;
        };

        let length = length as usize;

        arr_lengths.push(length);

        *buf = &buf[8..]; // skip `lower bound` 4 bytes

        if dimensions - i == 1 {
            continue;
        };

        let all_vecs_in_this_lvl = match total_vecs.checked_mul(length) {
            Some(v) => v,
            None => {
                log::error!("overflow: total_vecs={} length={}", total_vecs, length);
                return JsonValue::Null;
            }
        };

        total_vecs = match total_vecs.checked_add(all_vecs_in_this_lvl) {
            Some(v) => v,
            None => {
                log::error!(
                    "overflow: total_vecs={} all_vecs_in_this_lvl={}",
                    total_vecs,
                    all_vecs_in_this_lvl
                );
                return JsonValue::Null;
            }
        };
    }

    // SAFETY: i think this number should be discussed
    if total_vecs > 1024 {
        log::error!("too many vectors: total_vecs={}", total_vecs);
        return JsonValue::Null;
    };

    let mut vec = Vec::with_capacity(arr_lengths[0]);

    let _ = extract_recursively_or_fill_nulls_into(&mut vec, &arr_lengths, 1, &ty, buf);

    JsonValue::Array(vec)
}

/// the idea of returning a `Result` is to stop extracting further if error occurs
/// because it is most likely to fail anyway
fn extract_recursively_or_fill_nulls_into(
    vec: &mut Vec<JsonValue>,
    arr_lengths: &[usize],
    depth: usize,
    ty: &Type,
    buf: &mut &[u8],
) -> Result<(), ()> {
    match depth == arr_lengths.len() {
        true => {
            let len = arr_lengths[depth - 1];
            for i in 0..len {
                match try_extract_elem(ty, buf) {
                    Ok(value) => vec.push(value),
                    Err(_) => {
                        fill_nulls(vec, len - i);
                        return Err(());
                    }
                }
            }
        }

        false => {
            let len = arr_lengths[depth - 1];
            for i in 0..len {
                let mut sub_vec = Vec::with_capacity(len);
                if let Err(_) = extract_recursively_or_fill_nulls_into(
                    &mut sub_vec,
                    arr_lengths,
                    depth + 1,
                    ty,
                    buf,
                ) {
                    vec.push(JsonValue::Array(sub_vec));
                    fill_nulls(vec, len - 1 - i);
                    return Err(());
                }
                vec.push(JsonValue::Array(sub_vec));
            }
        }
    };

    Ok(())
}

#[inline(always)]
fn fill_nulls(vec: &mut Vec<JsonValue>, count: usize) {
    for _ in 0..count {
        vec.push(JsonValue::Null);
    }
}

#[inline]
fn try_extract_elem(ty: &Type, buf: &mut &[u8]) -> Result<JsonValue, ()> {
    let mut value_buf = match split_at_value_len(buf)? {
        Some(buf) => buf,
        None => return Ok(JsonValue::Null),
    };

    Ok(match ty.kind() {
        Kind::Simple => super::simple::extract_or_null(ty, value_buf),
        Kind::Enum(_variants) => super::r#enum::extract_or_null(value_buf),
        Kind::Array(_) => JsonValue::Null, // impossible case
        Kind::Range(ty) => super::range::extract_or_null(ty, &mut value_buf),
        Kind::Multirange(ty) => super::multi_range::extract_or_null(ty, &mut value_buf),
        Kind::Domain(inner) => super::simple::extract_or_null(inner, value_buf),
        Kind::Composite(fields) => super::composite::extract_or_null(fields, &mut value_buf),
        _ => JsonValue::Null,
    })
}

mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn test_simple_1d_pg_array_extraction() {
        let arr = [
            0, 0, 0, 1, // dimenstions 1
            0, 0, 0, 0, // has nulls 0: false, 1: true
            0, 0, 0, 17, // oid 17 = INT4
            0, 0, 0, 3, // array length
            0, 0, 0, 1, // lower bound
            // the following is a sequance of element length and element bytes
            0, 0, 0, 4, // length 4 bytes
            0, 0, 0, 1, // element
            0, 0, 0, 4, // length
            0, 0, 0, 2, // element
            0, 0, 0, 4, // length
            0, 0, 0, 3, // element
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![
                JsonValue::Number(1.into()),
                JsonValue::Number(2.into()),
                JsonValue::Number(3.into())
            ])
        );
    }

    #[test]
    fn test_simple_2dim_pg_array_extraction() {
        let arr = [
            0, 0, 0, 2, // dimensions 2
            0, 0, 0, 0, // has nulls 0: false, 1: true
            0, 0, 0, 17, // oid 17 = INT4
            0, 0, 0, 2, // outer array length: we have 2 sub arrays
            0, 0, 0, 1, // lower bound
            0, 0, 0, 2, // inner array lengths: each sub array has 2 elements
            0, 0, 0, 1, // lower bound
            // the following is a sequance of element length and element bytes for each array
            // beginning of first array
            0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 2,
            // end of first array
            // beginning of second array
            0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 4,
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![
                JsonValue::Array(vec![
                    JsonValue::Number(1.into()),
                    JsonValue::Number(2.into()),
                ]),
                JsonValue::Array(vec![
                    JsonValue::Number(3.into()),
                    JsonValue::Number(4.into()),
                ]),
            ])
        );
    }

    #[test]
    fn test_simple_3dim_pg_array_extraction() {
        let arr = [
            0, 0, 0, 3, // dimensions: 3 dimensions
            0, 0, 0, 0, // has nulls 0: false, 1: true
            0, 0, 0, 17, // oid 17 = INT4
            0, 0, 0, 2, // main array length: we have 2 sub arrays
            0, 0, 0, 1, // lower bound
            0, 0, 0, 2, // level 1 array lengths: each level 1 array has 2 elements
            0, 0, 0, 1, // lower bound
            0, 0, 0, 2, // level 2 array lengths: each level 2 array has 2 elements
            0, 0, 0, 1, // lower bound
            // beginning of (level 1 first array -> level 2 first array)
            0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 2,
            // end
            // beginning of (level 1 first array -> level 2 second array)
            0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 4,
            // beginning of (level 1 second array -> level 2 first array)
            0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 2,
            // end
            // beginning of (level 1 second array -> level 2 second array)
            0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 4,
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![
                JsonValue::Array(vec![
                    JsonValue::Array(vec![
                        JsonValue::Number(1.into()),
                        JsonValue::Number(2.into()),
                    ]),
                    JsonValue::Array(vec![
                        JsonValue::Number(3.into()),
                        JsonValue::Number(4.into()),
                    ]),
                ]),
                JsonValue::Array(vec![
                    JsonValue::Array(vec![
                        JsonValue::Number(1.into()),
                        JsonValue::Number(2.into()),
                    ]),
                    JsonValue::Array(vec![
                        JsonValue::Number(3.into()),
                        JsonValue::Number(4.into()),
                    ]),
                ])
            ])
        );
    }

    #[test]
    fn test_empty_1d_array() {
        // 1 dimension, INT4, length 0
        let arr = [
            0, 0, 0, 1, // dimensions 1
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 17, // oid INT4
            0, 0, 0, 0, // array length 0
            0, 0, 0, 1, // lower bound
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(json, JsonValue::Array(vec![]));
    }

    #[test]
    fn test_single_element_array() {
        let arr = [
            0, 0, 0, 1, // dimensions 1
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 17, // oid INT4
            0, 0, 0, 1, // array length 1
            0, 0, 0, 1, // lower bound
            0, 0, 0, 4, // value length 4
            0, 0, 0, 99, // element 99
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(json, JsonValue::Array(vec![JsonValue::Number(99.into())]));
    }

    #[test]
    fn test_1d_text_array() {
        // 1D array of TEXT (oid 25) with 2 elements: "hello", "world"
        let arr = [
            0, 0, 0, 1, // dimensions 1
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 25, // oid TEXT
            0, 0, 0, 2, // array length 2
            0, 0, 0, 1, // lower bound
            // element 1: "hello"
            0, 0, 0, 5, // length 5
            b'h', b'e', b'l', b'l', b'o', // element 2: "world"
            0, 0, 0, 5, // length 5
            b'w', b'o', b'r', b'l', b'd',
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::TEXT, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![
                JsonValue::String("hello".to_string()),
                JsonValue::String("world".to_string()),
            ])
        );
    }

    #[test]
    fn test_empty_buffer_returns_null() {
        let mut buf = &[][..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(json, JsonValue::Null);
    }

    #[test]
    fn test_truncated_header_returns_null() {
        // only 4 bytes — not enough for the 12-byte header
        let arr = [0, 0, 0, 1];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(json, JsonValue::Null);
    }

    #[test]
    fn test_zero_dimensions_returns_empty_array() {
        let arr = [
            0, 0, 0, 0, // dimensions 0 — invalid
            0, 0, 0, 0, 0, 0, 0, 17,
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(json, JsonValue::Array(vec![]));
    }

    #[test]
    fn test_negative_length_returns_null_with_partial_fill() {
        // 1D array with 2 elements where first has invalid (negative) length
        let arr = [
            0, 0, 0, 1, // dimensions 1
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 17, // oid INT4
            0, 0, 0, 2, // array length 2
            0, 0, 0, 1, // lower bound
            // element 1: negative length = NULL
            0xff, 0xff, 0xff, 0xff, // length -1 (NULL marker)
            // element 2: normal
            0, 0, 0, 4, 0, 0, 0, 42,
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![JsonValue::Null, JsonValue::Number(42.into()),])
        );
    }

    #[test]
    fn test_2d_empty_inner_arrays() {
        // 2 dimensions, outer length 2, each inner length 0
        let arr = [
            0, 0, 0, 2, // dimensions 2
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 17, // oid INT4
            0, 0, 0, 2, // outer length 2
            0, 0, 0, 1, // lower bound
            0, 0, 0, 0, // inner length 0 (each sub-array has 0 elements)
            0, 0, 0, 1, // lower bound
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![JsonValue::Array(vec![]), JsonValue::Array(vec![]),])
        );
    }

    #[test]
    fn test_truncated_elements_fill_with_nulls() {
        // 1D array length 3, but only 1 complete element provided
        let arr = [
            0, 0, 0, 1, // dimensions 1
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 17, // oid INT4
            0, 0, 0, 3, // array length 3
            0, 0, 0, 1, // lower bound
            // element 1: valid
            0, 0, 0, 4, 0, 0, 0, 10,
            // element 2: truncated — only 2 bytes of value instead of 4
            0, 0, 0, 4, // length says 4...
            0, 0, // ...but only 2 bytes available
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::INT4, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![
                JsonValue::Number(10.into()),
                JsonValue::Null,
                JsonValue::Null,
            ])
        );
    }

    #[test]
    fn test_bool_array() {
        // 1D array of BOOL (oid 16) with 3 elements: true, false, true
        let arr = [
            0, 0, 0, 1, // dimensions 1
            0, 0, 0, 0, // has nulls false
            0, 0, 0, 16, // oid BOOL
            0, 0, 0, 3, // array length 3
            0, 0, 0, 1, // lower bound
            0, 0, 0, 1, 1, // length 1, value true
            0, 0, 0, 1, 0, // length 1, value false
            0, 0, 0, 1, 1, // length 1, value true
        ];
        let mut buf = &arr[..];
        let json = extract_or_null(&Type::BOOL, &mut buf);
        assert_eq!(
            json,
            JsonValue::Array(vec![
                JsonValue::Bool(true),
                JsonValue::Bool(false),
                JsonValue::Bool(true),
            ])
        );
    }
}
