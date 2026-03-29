use serde_json::Value as JsonValue;
use tokio_postgres::types::{Kind, Type};

use crate::drivers::postgres::extract::common::split_at_value_len;

#[inline]
pub fn extract_or_null(ty: &Type, buf: &mut &[u8]) -> JsonValue {
    if buf.len() < 1 {
        return JsonValue::Null;
    };

    let flag = buf[0];
    *buf = &buf[1..];

    if (flag & 1) == 1 {
        return JsonValue::String(String::from("empty"));
    };

    let mut range = String::new();

    range.push(get_lower_bound(flag));

    if flag & (1 << 3) == 0 {
        if let Err(_) = try_extract_bound_into(ty, buf, &mut range) {
            range.push_str("null, null");
            range.push(get_upper_bound(flag));
            return JsonValue::String(range);
        };
    };

    range.push_str(", ");

    if flag & (1 << 4) == 0 {
        if let Err(_) = try_extract_bound_into(ty, buf, &mut range) {
            range.push_str("null");
        };
    }

    range.push(get_upper_bound(flag));

    JsonValue::String(range)
}

#[inline(always)]
fn get_lower_bound(flag: u8) -> char {
    if (flag & (1 << 1)) == 0 {
        '('
    } else {
        '['
    }
}

fn try_extract_bound_into(ty: &Type, buf: &mut &[u8], range: &mut String) -> Result<(), ()> {
    let mut value_buf = match split_at_value_len(buf)? {
        Some(buf) => buf,
        _ => {
            return Err(());
        }
    };

    let val = match ty.kind() {
        Kind::Simple => super::simple::extract_or_null(ty, value_buf),
        Kind::Enum(_variants) => super::r#enum::extract_or_null(value_buf),
        Kind::Array(ty) => super::array::extract_or_null(ty, &mut value_buf),
        Kind::Range(_) => JsonValue::Null,      // impossible
        Kind::Multirange(_) => JsonValue::Null, // not allowed by postgres
        Kind::Domain(ty) => super::simple::extract_or_null(ty, value_buf),
        Kind::Composite(fields) => super::composite::extract_or_null(fields, &mut value_buf),
        _ => JsonValue::Null, // unsupported
    };

    range.push_str(&val.to_string());
    Ok(())
}

#[inline(always)]
fn get_upper_bound(flag: u8) -> char {
    if (flag & (1 << 2)) == 0 {
        ')'
    } else {
        ']'
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // postgres range flags
    const RANGE_EMPTY: u8 = 1 << 0;
    const RANGE_LB_INC: u8 = 1 << 1;
    const RANGE_UB_INC: u8 = 1 << 2;
    const RANGE_LB_INF: u8 = 1 << 3;
    const RANGE_UB_INF: u8 = 1 << 4;

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

    #[test]
    fn test_empty_range() {
        let buf = [RANGE_EMPTY];
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("empty".to_string())
        );
    }

    #[test]
    fn test_inclusive_exclusive() {
        // [1, 5)
        let buf = build_int4_range(RANGE_LB_INC, Some(1), Some(5));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[1, 5)".to_string())
        );
    }

    #[test]
    fn test_inclusive_inclusive() {
        // [1, 5]
        let buf = build_int4_range(RANGE_LB_INC | RANGE_UB_INC, Some(1), Some(5));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[1, 5]".to_string())
        );
    }

    #[test]
    fn test_exclusive_exclusive() {
        // (1, 5)
        let buf = build_int4_range(0x00, Some(1), Some(5));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("(1, 5)".to_string())
        );
    }

    #[test]
    fn test_exclusive_inclusive() {
        // (1, 5]
        let buf = build_int4_range(RANGE_UB_INC, Some(1), Some(5));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("(1, 5]".to_string())
        );
    }

    #[test]
    fn test_unbounded_lower_inclusive_upper() {
        // (, 5]
        let buf = build_int4_range(RANGE_LB_INF | RANGE_UB_INC, None, Some(5));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("(, 5]".to_string())
        );
    }

    #[test]
    fn test_unbounded_lower_exclusive_upper() {
        // (, 5)
        let buf = build_int4_range(RANGE_LB_INF, None, Some(5));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("(, 5)".to_string())
        );
    }

    #[test]
    fn test_inclusive_lower_unbounded_upper() {
        // [5, )
        let buf = build_int4_range(RANGE_LB_INC | RANGE_UB_INF, Some(5), None);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[5, )".to_string())
        );
    }

    #[test]
    fn test_exclusive_lower_unbounded_upper() {
        // (5, )
        let buf = build_int4_range(RANGE_UB_INF, Some(5), None);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("(5, )".to_string())
        );
    }

    #[test]
    fn test_both_unbounded() {
        // (, )
        let buf = build_int4_range(RANGE_LB_INF | RANGE_UB_INF, None, None);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("(, )".to_string())
        );
    }

    #[test]
    fn test_empty_buffer_returns_null() {
        let buf = [];
        let mut slice = &buf[..];
        assert_eq!(extract_or_null(&Type::INT4, &mut slice), JsonValue::Null);
    }

    #[test]
    fn test_negative_values() {
        // [-10, 0)
        let buf = build_int4_range(RANGE_LB_INC, Some(-10), Some(0));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[-10, 0)".to_string())
        );
    }

    #[test]
    fn test_point_range() {
        // [42, 42]
        let buf = build_int4_range(RANGE_LB_INC | RANGE_UB_INC, Some(42), Some(42));
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[42, 42]".to_string())
        );
    }

    #[test]
    fn test_truncated_upper_returns_null_upper() {
        // valid lower but no upper data
        let buf = build_int4_range(RANGE_LB_INC, Some(1), None);
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[1, null)".to_string())
        );
    }

    #[test]
    fn test_truncated_lower_returns_null_both() {
        // flag + lower len says 4 bytes but only 2 available
        let buf = [RANGE_LB_INC, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00];
        let mut slice = &buf[..];
        assert_eq!(
            extract_or_null(&Type::INT4, &mut slice),
            JsonValue::String("[null, null)".to_string())
        );
    }
}
