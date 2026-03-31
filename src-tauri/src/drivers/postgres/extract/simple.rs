use std::{collections::HashMap, net::IpAddr};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use tokio_postgres::types::{FromSql, Type};
use uuid::Uuid;

use crate::drivers::common::encode_blob;

#[inline]
pub fn extract_or_null(ty: &Type, buf: &[u8]) -> JsonValue {
    match *ty {
        Type::BOOL => JsonValue::from(from_sql_or_none::<bool>(ty, buf)),
        Type::BYTEA => {
            JsonValue::from(from_sql_or_none::<Vec<u8>>(ty, buf).map(|b| encode_blob(&b)))
        }

        // numeric
        Type::CHAR => JsonValue::from(from_sql_or_none::<i8>(ty, buf)), // this mapped to `i8`
        Type::INT2 => JsonValue::from(from_sql_or_none::<i16>(ty, buf)),
        Type::INT4 => JsonValue::from(from_sql_or_none::<i32>(ty, buf)),
        Type::INT8 => JsonValue::from(from_sql_or_none::<i64>(ty, buf)),
        Type::FLOAT4 => JsonValue::from(from_sql_or_none::<f32>(ty, buf)),
        Type::FLOAT8 => JsonValue::from(from_sql_or_none::<f64>(ty, buf)),
        Type::NUMERIC => {
            JsonValue::from(from_sql_or_none::<Decimal>(ty, buf).map(|d| d.to_string()))
        }
        Type::OID => JsonValue::from(from_sql_or_none::<u32>(ty, buf)),

        // text
        Type::TEXT => JsonValue::from(from_sql_or_none::<String>(ty, buf)),
        Type::VARCHAR => JsonValue::from(from_sql_or_none::<String>(ty, buf)),
        Type::BPCHAR => JsonValue::from(from_sql_or_none::<String>(ty, buf)),
        Type::UNKNOWN => JsonValue::from(from_sql_or_none::<String>(ty, buf)),
        Type::NAME => JsonValue::from(from_sql_or_none::<String>(ty, buf)),
        ref ty if ["citext", "ltree", "lquery", "ltxtquery"].contains(&ty.name()) => {
            JsonValue::from(from_sql_or_none::<String>(ty, buf))
        }

        // uuid
        Type::UUID => JsonValue::from(from_sql_or_none::<Uuid>(ty, buf).map(|u| u.to_string())),

        // date/time
        Type::DATE => JsonValue::from(
            from_sql_or_none::<NaiveDate>(ty, buf).map(|d| d.format("%Y-%m-%d").to_string()),
        ),
        Type::TIME => JsonValue::from(
            from_sql_or_none::<NaiveTime>(ty, buf).map(|t| t.format("%H:%M:%S").to_string()),
        ),
        Type::TIMESTAMP => JsonValue::from(
            from_sql_or_none::<NaiveDateTime>(ty, buf)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string()),
        ),
        Type::TIMESTAMPTZ => JsonValue::from(
            from_sql_or_none::<DateTime<Utc>>(ty, buf)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string()),
        ),

        // json
        Type::JSON => JsonValue::from(from_sql_or_none::<JsonValue>(ty, buf)),
        Type::JSONB => JsonValue::from(from_sql_or_none::<JsonValue>(ty, buf)),

        // HashMap
        ref ty if ty.name() == "hstore" => {
            serde_json::to_value(from_sql_or_none::<HashMap<String, Option<String>>>(ty, buf))
                .unwrap_or_default()
        }

        // ip address
        Type::INET => JsonValue::from(from_sql_or_none::<IpAddr>(ty, buf).map(|ip| ip.to_string())),

        _ => JsonValue::Null,
    }
}

#[inline]
fn from_sql_or_none<'a, T>(ty: &Type, buf: &'a [u8]) -> Option<T>
where
    T: FromSql<'a>,
{
    match <Option<T> as FromSql>::from_sql(ty, buf) {
        Ok(value) => value,
        Err(e) => {
            log::error!("Failed to read value from sql: {:?}", e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bool_true() {
        let buf = [1u8];
        assert_eq!(extract_or_null(&Type::BOOL, &buf), JsonValue::Bool(true));
    }

    #[test]
    fn test_bool_false() {
        let buf = [0u8];
        assert_eq!(extract_or_null(&Type::BOOL, &buf), JsonValue::Bool(false));
    }

    #[test]
    fn test_int2_positive() {
        let buf = 42i16.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT2, &buf),
            JsonValue::Number(42.into())
        );
    }

    #[test]
    fn test_int2_negative() {
        let buf = (-100i16).to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT2, &buf),
            JsonValue::Number((-100).into())
        );
    }

    #[test]
    fn test_int4_positive() {
        let buf = 123456i32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT4, &buf),
            JsonValue::Number(123456.into())
        );
    }

    #[test]
    fn test_int4_zero() {
        let buf = 0i32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT4, &buf),
            JsonValue::Number(0.into())
        );
    }

    #[test]
    fn test_int4_negative() {
        let buf = (-999i32).to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT4, &buf),
            JsonValue::Number((-999).into())
        );
    }

    #[test]
    fn test_int8_positive() {
        let buf = 9876543210i64.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT8, &buf),
            JsonValue::Number(9876543210i64.into())
        );
    }

    #[test]
    fn test_int8_negative() {
        let buf = (-42i64).to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT8, &buf),
            JsonValue::Number((-42).into())
        );
    }

    #[test]
    fn test_float4() {
        let buf = 3.14f32.to_be_bytes();
        let result = extract_or_null(&Type::FLOAT4, &buf);
        match result {
            JsonValue::Number(n) => {
                let val = n.as_f64().unwrap();
                assert!((val - 3.14).abs() < 0.001);
            }
            _ => panic!("expected number"),
        }
    }

    #[test]
    fn test_float8() {
        let buf = 2.718281828f64.to_be_bytes();
        let result = extract_or_null(&Type::FLOAT8, &buf);
        match result {
            JsonValue::Number(n) => {
                let val = n.as_f64().unwrap();
                assert!((val - 2.718281828).abs() < 1e-9);
            }
            _ => panic!("expected number"),
        }
    }

    #[test]
    fn test_text() {
        let buf = b"hello world";
        assert_eq!(
            extract_or_null(&Type::TEXT, buf),
            JsonValue::String("hello world".to_string())
        );
    }

    #[test]
    fn test_text_empty() {
        let buf = b"";
        assert_eq!(
            extract_or_null(&Type::TEXT, buf),
            JsonValue::String("".to_string())
        );
    }

    #[test]
    fn test_varchar() {
        let buf = b"test varchar";
        assert_eq!(
            extract_or_null(&Type::VARCHAR, buf),
            JsonValue::String("test varchar".to_string())
        );
    }

    #[test]
    fn test_bpchar() {
        let buf = b"padded   ";
        assert_eq!(
            extract_or_null(&Type::BPCHAR, buf),
            JsonValue::String("padded   ".to_string())
        );
    }

    #[test]
    fn test_name() {
        let buf = b"pg_type";
        assert_eq!(
            extract_or_null(&Type::NAME, buf),
            JsonValue::String("pg_type".to_string())
        );
    }

    #[test]
    fn test_unknown_type() {
        let buf = b"unknown_val";
        assert_eq!(
            extract_or_null(&Type::UNKNOWN, buf),
            JsonValue::String("unknown_val".to_string())
        );
    }

    #[test]
    fn test_char_as_i8() {
        let buf = (-5i8).to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::CHAR, &buf),
            JsonValue::Number((-5).into())
        );
    }

    #[test]
    fn test_oid() {
        let buf = 23u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::OID, &buf),
            JsonValue::Number(23.into())
        );
    }

    #[test]
    fn test_uuid() {
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let buf = *uuid.as_bytes();
        assert_eq!(
            extract_or_null(&Type::UUID, &buf),
            JsonValue::String("550e8400-e29b-41d4-a716-446655440000".to_string())
        );
    }

    #[test]
    fn test_date() {
        // 2024-01-15 = 8780 days since 2000-01-01
        let days: i32 = 8780;
        let buf = days.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::DATE, &buf),
            JsonValue::String("2024-01-15".to_string())
        );
    }

    #[test]
    fn test_time() {
        // 14:30:00 = 52200000000 microseconds
        let micros: i64 = 14 * 3_600_000_000 + 30 * 60_000_000;
        let buf = micros.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::TIME, &buf),
            JsonValue::String("14:30:00".to_string())
        );
    }

    #[test]
    fn test_json() {
        let json_bytes = br#"{"key":"value","num":42}"#;
        let result = extract_or_null(&Type::JSON, json_bytes);
        assert_eq!(result["key"], "value");
        assert_eq!(result["num"], 42);
    }

    #[test]
    fn test_jsonb() {
        // JSONB format: 1 byte version (1) + JSON bytes
        let mut buf = vec![1u8]; // version 1
        buf.extend_from_slice(br#"{"a":true}"#);
        let result = extract_or_null(&Type::JSONB, &buf);
        assert_eq!(result["a"], true);
    }

    #[test]
    fn test_bytea() {
        let buf = b"\x00\x01\x02\x03";
        let result = extract_or_null(&Type::BYTEA, buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:4:application/octet-stream:"));
            }
            _ => panic!("expected string for BYTEA"),
        }
    }

    #[test]
    fn test_inet_ipv4() {
        // postgres INET binary for IPv4:
        // 1byte: family(2) = ipv4,
        // 1byte: net mask,
        // 1byte: is_cidr(0),
        // 1byte: addr_len, must be 4
        // 4bytes: addr bytes
        let buf = [2u8, 32, 0, 4, 192, 168, 1, 1];
        assert_eq!(
            extract_or_null(&Type::INET, &buf),
            JsonValue::String("192.168.1.1".to_string())
        );
    }

    #[test]
    fn test_inet_ipv6() {
        // postgres INET binary for IPv6:
        // 1byte: family(3) = ipv6,
        // 1byte: net mask,
        // 1byte: is_cidr(0),
        // 1byte: addr_len, must be 16
        // 16bytes: addr bytes
        let mut buf = vec![3u8, 128, 0, 16];
        buf.extend_from_slice(&[0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
        assert_eq!(
            extract_or_null(&Type::INET, &buf),
            JsonValue::String("2001:db8::1".to_string())
        );
    }

    #[test]
    fn test_int2_zero() {
        let buf = 0i16.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT2, &buf),
            JsonValue::Number(0.into())
        );
    }

    #[test]
    fn test_char_positive() {
        let buf = 65i8.to_be_bytes(); // 'A'
        assert_eq!(
            extract_or_null(&Type::CHAR, &buf),
            JsonValue::Number(65.into())
        );
    }

    #[test]
    fn test_unsupported_type_returns_null() {
        let buf = [0u8; 8];
        assert_eq!(extract_or_null(&Type::TIMETZ, &buf), JsonValue::Null);
    }

    #[test]
    fn test_empty_buffer_returns_null() {
        let buf = [];
        let result = extract_or_null(&Type::INT4, &buf);
        assert_eq!(result, JsonValue::Null);
    }

    #[test]
    fn test_truncated_buffer_returns_null() {
        // INT4 needs 4 bytes, give only 2
        let buf = [0u8; 2];
        assert_eq!(extract_or_null(&Type::INT4, &buf), JsonValue::Null);
    }

    #[test]
    fn test_timestamp() {
        // 2024-01-15 10:30:00 = 8781 days + 10h30m since 2000-01-01 00:00:00
        let days: i64 = 8780;
        let micros: i64 = days * 86_400_000_000 + 10 * 3_600_000_000 + 30 * 60_000_000;
        let buf = micros.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::TIMESTAMP, &buf),
            JsonValue::String("2024-01-15 10:30:00".to_string())
        );
    }

    #[test]
    fn test_timestamptz() {
        // Same value for TIMESTAMPTZ — postgres stores as UTC microseconds since 2000-01-01
        let days: i64 = 8780;
        let micros: i64 = days * 86_400_000_000 + 10 * 3_600_000_000 + 30 * 60_000_000;
        let buf = micros.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::TIMESTAMPTZ, &buf),
            JsonValue::String("2024-01-15 10:30:00".to_string())
        );
    }

    #[test]
    fn test_float4_negative() {
        let buf = (-0.5f32).to_be_bytes();
        let result = extract_or_null(&Type::FLOAT4, &buf);
        match result {
            JsonValue::Number(n) => {
                let val = n.as_f64().unwrap();
                assert!((val - (-0.5)).abs() < 0.001);
            }
            _ => panic!("expected number"),
        }
    }

    #[test]
    fn test_float8_negative() {
        let buf = (-999.999f64).to_be_bytes();
        let result = extract_or_null(&Type::FLOAT8, &buf);
        match result {
            JsonValue::Number(n) => {
                let val = n.as_f64().unwrap();
                assert!((val - (-999.999)).abs() < 1e-6);
            }
            _ => panic!("expected number"),
        }
    }

    #[test]
    fn test_numeric_zero() {
        // postgres numeric for 0: ndigits=0, weight=0, sign=0x0000 (positive), dscale=0
        let buf: [u8; 8] = [
            0x00, 0x00, // ndigits = 0
            0x00, 0x00, // weight = 0
            0x00, 0x00, // sign = NUMERIC_POS (0)
            0x00, 0x00, // dscale = 0
                  // no digit groups
        ];
        assert_eq!(
            extract_or_null(&Type::NUMERIC, &buf),
            JsonValue::String("0".to_string())
        );
    }

    #[test]
    fn test_numeric_integer() {
        // postgres numeric for 12345:
        // ndigits=2, weight=1, sign=0x0000, dscale=0
        // digit groups: 1, 2345 (each is a base-10000 digit)
        let buf: [u8; 12] = [
            0x00, 0x02, // ndigits = 2
            0x00, 0x01, // weight = 1
            0x00, 0x00, // sign = NUMERIC_POS
            0x00, 0x00, // dscale = 0
            0x00, 0x01, // digit 1
            0x09, 0x29, // digit 2345 (0x0929)
        ];
        assert_eq!(
            extract_or_null(&Type::NUMERIC, &buf),
            JsonValue::String("12345".to_string())
        );
    }
}
