use serde_json::Value as JsonValue;
use tokio_postgres::types::Type;

use crate::drivers::postgres::extract::common::advance_buf;

#[inline]
pub fn extract_or_null(ty: &Type, buf: &mut &[u8]) -> JsonValue {
    if buf.len() < 4 {
        return JsonValue::Null;
    };

    let count = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);

    *buf = &buf[4..];

    if count == 0 {
        return JsonValue::from("{}");
    };

    let mut ranges = String::from('{');

    for _ in 0..count - 1 {
        // skip range length
        if let Err(_) = advance_buf(buf, 4) {
            ranges.push('}');
            return JsonValue::String(ranges);
        };

        match super::range::extract_or_null(ty, buf) {
            JsonValue::String(r) => ranges.push_str(&r),
            r @ _ => {
                log::error!("range::extract_or_null must return a string or null");
                ranges.push_str(&r.to_string())
            }
        }

        ranges.push(',');
    }

    // skip range length
    if let Err(_) = advance_buf(buf, 4) {
        ranges.push('}');
        return JsonValue::String(ranges);
    };

    match super::range::extract_or_null(ty, buf) {
        JsonValue::String(r) => ranges.push_str(&r),
        r @ _ => {
            log::error!("range::extract_or_null must return a string or null");
            ranges.push_str(&r.to_string())
        }
    };

    ranges.push('}');

    JsonValue::String(ranges)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RANGE_LB_INC: u8 = 1 << 1;
    const RANGE_UB_INC: u8 = 1 << 2;

    fn build_int4_range(flag: u8, lower: Option<i32>, upper: Option<i32>) -> Vec<u8> {
        let mut buf = vec![flag];
        if let Some(v) = lower {
            buf.extend_from_slice(&4i32.to_be_bytes());
            buf.extend_from_slice(&v.to_be_bytes());
        }
        if let Some(v) = upper {
            buf.extend_from_slice(&4i32.to_be_bytes());
            buf.extend_from_slice(&v.to_be_bytes());
        }
        buf
    }

    fn build_multirange(count: u32, ranges: &[Vec<u8>]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&count.to_be_bytes());
        for r in ranges {
            buf.extend_from_slice(&(r.len() as i32).to_be_bytes()); // range length prefix
            buf.extend_from_slice(r);
        }
        buf
    }

    #[test]
    fn test_empty_multirange() {
        let buf = build_multirange(0, &[]);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::from("{}")
        );
    }

    #[test]
    fn test_single_range_multirange() {
        let range = build_int4_range(RANGE_LB_INC, Some(1), Some(5));
        let buf = build_multirange(1, &[range]);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::from("{[1, 5)}")
        );
    }

    #[test]
    fn test_two_ranges_multirange() {
        let r1 = build_int4_range(RANGE_LB_INC, Some(1), Some(5));
        let r2 = build_int4_range(RANGE_LB_INC, Some(10), Some(20));
        let buf = build_multirange(2, &[r1, r2]);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::from("{[1, 5),[10, 20)}")
        );
    }

    #[test]
    fn test_three_ranges_multirange() {
        let r1 = build_int4_range(RANGE_LB_INC, Some(1), Some(5));
        let r2 = build_int4_range(RANGE_LB_INC | RANGE_UB_INC, Some(10), Some(20));
        let r3 = build_int4_range(RANGE_LB_INC, Some(100), Some(200));
        let buf = build_multirange(3, &[r1, r2, r3]);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::from("{[1, 5),[10, 20],[100, 200)}")
        );
    }

    #[test]
    fn test_empty_buffer_returns_null() {
        let buf = [];
        let mut slice = &buf[..];
        assert_eq!(extract_or_null(&Type::INT4, &mut slice), JsonValue::Null);
    }

    #[test]
    fn test_truncated_count_returns_null() {
        let buf = [0x00, 0x00]; // only 2 bytes, need 4
        let mut slice = &buf[..];
        assert_eq!(extract_or_null(&Type::INT4, &mut slice), JsonValue::Null);
    }

    #[test]
    fn test_mixed_bounds() {
        let r1 = build_int4_range(RANGE_LB_INC, Some(1), Some(5)); // [1, 5)
        let r2 = build_int4_range(0x00, Some(10), Some(20)); // (10, 20)
        let r3 = build_int4_range(RANGE_UB_INC, Some(100), Some(200)); // (100, 200]
        let buf = build_multirange(3, &[r1, r2, r3]);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::from("{[1, 5),(10, 20),(100, 200]}")
        );
    }
}
