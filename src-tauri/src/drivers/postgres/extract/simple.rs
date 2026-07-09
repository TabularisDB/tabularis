use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use tokio_postgres::types::{FromSql, Type};
use uuid::Uuid;

use crate::drivers::common::{encode_blob, i64_to_json};

use super::advanced_types;

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
        Type::INT8 => from_sql_or_none::<i64>(ty, buf)
            .map(i64_to_json)
            .unwrap_or(JsonValue::Null),
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
        Type::INTERVAL => JsonValue::from(from_sql_or_none::<advanced_types::Interval>(ty, buf)),
        Type::TIMETZ => JsonValue::from(from_sql_or_none::<advanced_types::TimeTz>(ty, buf)),

        // json
        Type::JSON => JsonValue::from(from_sql_or_none::<JsonValue>(ty, buf)),
        Type::JSONB => JsonValue::from(from_sql_or_none::<JsonValue>(ty, buf)),

        // HashMap
        ref ty if ty.name() == "hstore" => {
            serde_json::to_value(from_sql_or_none::<HashMap<String, Option<String>>>(ty, buf))
                .unwrap_or_default()
        }

        // Network types
        Type::MACADDR => JsonValue::from(from_sql_or_none::<advanced_types::MacAddr>(ty, buf)),
        Type::MACADDR8 => JsonValue::from(from_sql_or_none::<advanced_types::MacAddr8>(ty, buf)),
        Type::INET => JsonValue::from(from_sql_or_none::<advanced_types::CidrOrInet>(ty, buf)),
        Type::CIDR => JsonValue::from(from_sql_or_none::<advanced_types::CidrOrInet>(ty, buf)),
        Type::BIT => JsonValue::from(from_sql_or_none::<advanced_types::BitOrVarBit>(ty, buf)),
        Type::VARBIT => JsonValue::from(from_sql_or_none::<advanced_types::BitOrVarBit>(ty, buf)),

        // System Identifiers
        Type::XID => JsonValue::from(from_sql_or_none::<advanced_types::Xid>(ty, buf)),
        Type::CID => JsonValue::from(from_sql_or_none::<advanced_types::Cid>(ty, buf)),
        Type::TID => JsonValue::from(from_sql_or_none::<advanced_types::Tid>(ty, buf)),
        Type::XID8 => JsonValue::from(from_sql_or_none::<advanced_types::Xid8>(ty, buf)),

        // Object References (The "Reg" Types)
        Type::REGPROC => JsonValue::from(from_sql_or_none::<advanced_types::RegProc>(ty, buf)),
        Type::REGPROCEDURE => {
            JsonValue::from(from_sql_or_none::<advanced_types::RegProcedure>(ty, buf))
        }
        Type::REGOPER => JsonValue::from(from_sql_or_none::<advanced_types::RegOper>(ty, buf)),
        Type::REGOPERATOR => {
            JsonValue::from(from_sql_or_none::<advanced_types::RegOperator>(ty, buf))
        }
        Type::REGCLASS => JsonValue::from(from_sql_or_none::<advanced_types::RegClass>(ty, buf)),
        Type::REGTYPE => JsonValue::from(from_sql_or_none::<advanced_types::RegType>(ty, buf)),
        Type::REGCONFIG => JsonValue::from(from_sql_or_none::<advanced_types::RegConfig>(ty, buf)),
        Type::REGDICTIONARY => {
            JsonValue::from(from_sql_or_none::<advanced_types::RegDictionary>(ty, buf))
        }
        Type::REGNAMESPACE => {
            JsonValue::from(from_sql_or_none::<advanced_types::RegNamespace>(ty, buf))
        }
        Type::REGROLE => JsonValue::from(from_sql_or_none::<advanced_types::RegRole>(ty, buf)),
        Type::REGCOLLATION => {
            JsonValue::from(from_sql_or_none::<advanced_types::RegCollation>(ty, buf))
        }

        // Geometric Types
        Type::POINT => JsonValue::from(from_sql_or_none::<advanced_types::Point>(ty, buf)),
        Type::LSEG => JsonValue::from(from_sql_or_none::<advanced_types::Lseg>(ty, buf)),
        Type::BOX => JsonValue::from(from_sql_or_none::<advanced_types::PgBox>(ty, buf)),
        Type::POLYGON => JsonValue::from(from_sql_or_none::<advanced_types::Polygon>(ty, buf)),
        Type::PATH => JsonValue::from(from_sql_or_none::<advanced_types::Path>(ty, buf)),
        Type::LINE => JsonValue::from(from_sql_or_none::<advanced_types::Line>(ty, buf)),
        Type::CIRCLE => JsonValue::from(from_sql_or_none::<advanced_types::Circle>(ty, buf)),

        // uft8 text
        Type::JSONPATH => JsonValue::from(from_sql_or_none::<advanced_types::JsonPath>(ty, buf)),
        Type::XML => JsonValue::from(from_sql_or_none::<advanced_types::Xml>(ty, buf)),
        Type::REFCURSOR => JsonValue::from(from_sql_or_none::<advanced_types::RefCursor>(ty, buf)),
        Type::ACLITEM => JsonValue::from(from_sql_or_none::<advanced_types::AclItem>(ty, buf)),
        Type::PG_NODE_TREE => {
            JsonValue::from(from_sql_or_none::<advanced_types::PgNodeTree>(ty, buf))
        }

        Type::MONEY => JsonValue::from(from_sql_or_none::<advanced_types::Money>(ty, buf)),

        // Full Text Search types
        Type::TS_VECTOR => JsonValue::from(from_sql_or_none::<advanced_types::TsVector>(ty, buf)),
        Type::TSQUERY => JsonValue::from(from_sql_or_none::<advanced_types::TsQuery>(ty, buf)),
        Type::GTS_VECTOR => JsonValue::from(from_sql_or_none::<advanced_types::GtsVector>(ty, buf)),

        // Internal System, Snapshots & Statistics postgres types
        Type::PG_LSN => JsonValue::from(from_sql_or_none::<advanced_types::PgLsn>(ty, buf)),
        Type::PG_SNAPSHOT => {
            JsonValue::from(from_sql_or_none::<advanced_types::TxidSnapshotOrPgSnapshot>(ty, buf))
        }
        Type::TXID_SNAPSHOT => {
            JsonValue::from(from_sql_or_none::<advanced_types::TxidSnapshotOrPgSnapshot>(ty, buf))
        }
        Type::PG_NDISTINCT => {
            JsonValue::from(from_sql_or_none::<advanced_types::PgNdistinct>(ty, buf))
        }
        Type::PG_DEPENDENCIES => {
            JsonValue::from(from_sql_or_none::<advanced_types::PgDependencies>(ty, buf))
        }
        Type::PG_BRIN_BLOOM_SUMMARY => JsonValue::from(from_sql_or_none::<
            advanced_types::PgBrinBloomSummary,
        >(ty, buf)),
        Type::PG_BRIN_MINMAX_MULTI_SUMMARY => {
            JsonValue::from(from_sql_or_none::<advanced_types::PgBrinMinmaxMultiSummary>(ty, buf))
        }
        Type::PG_MCV_LIST => {
            JsonValue::from(from_sql_or_none::<advanced_types::PgMcvList>(ty, buf))
        }

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
    use tokio_postgres::types::Kind;

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
    fn test_int8_above_js_safe_becomes_string() {
        // Snowflake id from issue #210 — must survive without precision loss.
        let buf = 844_197_938_335_842_304i64.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT8, &buf),
            JsonValue::String("844197938335842304".to_string())
        );
    }

    #[test]
    fn test_int8_below_js_safe_becomes_string() {
        let buf = (-9_007_199_254_740_992i64).to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::INT8, &buf),
            JsonValue::String("-9007199254740992".to_string())
        );
    }

    #[test]
    #[allow(clippy::approx_constant)]
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
    #[allow(clippy::approx_constant)]
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
            JsonValue::String("192.168.1.1/32".to_string())
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
            JsonValue::String("2001:db8::1/128".to_string())
        );
    }

    #[test]
    fn test_cidr_ipv4() {
        // postgres CIDR binary for IPv4 with /24 netmask
        let buf = [2u8, 24, 1, 4, 10, 0, 0, 0];
        assert_eq!(
            extract_or_null(&Type::CIDR, &buf),
            JsonValue::String("10.0.0.0/24".to_string())
        );
    }

    #[test]
    fn test_macaddr() {
        // MACADDR is 6 bytes
        let buf = [0x08u8, 0x00, 0x2b, 0x01, 0x02, 0x03];
        assert_eq!(
            extract_or_null(&Type::MACADDR, &buf),
            JsonValue::String("08:00:2b:01:02:03".to_string())
        );
    }

    #[test]
    fn test_macaddr8() {
        // MACADDR8 is 8 bytes
        let buf = [0x08u8, 0x00, 0x2b, 0x01, 0x02, 0x03, 0x04, 0x05];
        assert_eq!(
            extract_or_null(&Type::MACADDR8, &buf),
            JsonValue::String("08:00:2b:01:02:03:04:05".to_string())
        );
    }

    #[test]
    fn test_bit_varbit() {
        // BIT/VARBIT: 4 bytes for bit count + bit bytes
        // 8 bits = 1 byte, value 0b10101010
        let mut buf = Vec::new();
        buf.extend_from_slice(&8i32.to_be_bytes()); // 8 bits
        buf.push(0b10101010);
        assert_eq!(
            extract_or_null(&Type::BIT, &buf),
            JsonValue::String("10101010".to_string())
        );
    }

    #[test]
    fn test_varbit_partial_byte() {
        // VARBIT with 13 bits = 2 bytes
        let mut buf = Vec::new();
        buf.extend_from_slice(&13i32.to_be_bytes()); // 13 bits
        buf.push(0b11110000); // first 8 bits
        buf.push(0b10100000); // remaining 5 bits (13-8=5)
        assert_eq!(
            extract_or_null(&Type::VARBIT, &buf),
            JsonValue::String("1111000010100".to_string())
        );
    }

    #[test]
    fn test_xid() {
        let buf = 12345u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::XID, &buf),
            JsonValue::Number(12345.into())
        );
    }

    #[test]
    fn test_cid() {
        let buf = 67890u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::CID, &buf),
            JsonValue::Number(67890.into())
        );
    }

    #[test]
    fn test_tid() {
        // TID: 4 bytes block_num + 2 bytes offset
        let buf = [0x00, 0x01, 0x00, 0x00, 0x00, 0x05]; // block=65536, offset=5
        assert_eq!(
            extract_or_null(&Type::TID, &buf),
            JsonValue::String("(65536, 5)".to_string())
        );
    }

    #[test]
    fn test_xid8() {
        let buf = 9876543210i64.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::XID8, &buf),
            JsonValue::Number(9876543210i64.into())
        );
    }

    #[test]
    fn test_xid8_above_js_safe_becomes_string() {
        // Large u64 transaction id beyond JS_MAX_SAFE_INTEGER.
        let large: u64 = u64::MAX;
        let buf = (large as i64).to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::XID8, &buf),
            JsonValue::String(large.to_string())
        );
    }

    #[test]
    fn test_regclass() {
        let buf = 12345u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGCLASS, &buf),
            JsonValue::Number(12345.into())
        );
    }

    #[test]
    fn test_regtype() {
        let buf = 23u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGTYPE, &buf),
            JsonValue::Number(23.into())
        );
    }

    #[test]
    fn test_point() {
        // Point: 16 bytes (2 x f64)
        let mut buf = Vec::new();
        buf.extend_from_slice(&1.5f64.to_be_bytes());
        buf.extend_from_slice(&(-2.5f64).to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::POINT, &buf),
            JsonValue::String("(1.5, -2.5)".to_string())
        );
    }

    #[test]
    fn test_lseg() {
        // Lseg: 32 bytes (2 x Point)
        let mut buf = Vec::new();
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&3.0f64.to_be_bytes());
        buf.extend_from_slice(&4.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::LSEG, &buf),
            JsonValue::String("[(0, 0), (3, 4)]".to_string())
        );
    }

    #[test]
    fn test_box() {
        // Box: 32 bytes (2 x Point: upper_right, lower_left)
        let mut buf = Vec::new();
        buf.extend_from_slice(&5.0f64.to_be_bytes());
        buf.extend_from_slice(&5.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::BOX, &buf),
            JsonValue::String("((5, 5), (1, 1))".to_string())
        );
    }

    #[test]
    fn test_line() {
        // Line: 24 bytes (3 x f64: a, b, c)
        let mut buf = Vec::new();
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        buf.extend_from_slice(&2.0f64.to_be_bytes());
        buf.extend_from_slice(&3.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::LINE, &buf),
            JsonValue::String("{1, 2, 3}".to_string())
        );
    }

    #[test]
    fn test_circle() {
        // Circle: 24 bytes (Point + radius)
        let mut buf = Vec::new();
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&5.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::CIRCLE, &buf),
            JsonValue::String("<(0, 0), 5>".to_string())
        );
    }

    #[test]
    fn test_polygon() {
        // Polygon: 4 bytes num_points + points
        let mut buf = Vec::new();
        buf.extend_from_slice(&2i32.to_be_bytes()); // 2 points
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::POLYGON, &buf),
            JsonValue::String("((0, 0), (1, 1))".to_string())
        );
    }

    #[test]
    fn test_path_closed() {
        // Path: 1 byte flag + 4 bytes num_points + points
        // flag=0 means closed path
        let mut buf = Vec::new();
        buf.push(0u8); // closed
        buf.extend_from_slice(&2i32.to_be_bytes()); // 2 points
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::PATH, &buf),
            JsonValue::String("[(0, 0), (1, 1)]".to_string())
        );
    }

    #[test]
    fn test_path_open() {
        // Path: 1 byte flag + 4 bytes num_points + points
        // flag=1 means open path
        let mut buf = Vec::new();
        buf.push(1u8); // open
        buf.extend_from_slice(&2i32.to_be_bytes()); // 2 points
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&0.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        buf.extend_from_slice(&1.0f64.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::PATH, &buf),
            JsonValue::String("((0, 0), (1, 1))".to_string())
        );
    }

    #[test]
    fn test_money() {
        let buf = 12345i64.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::MONEY, &buf),
            JsonValue::Number(12345.into())
        );
    }

    #[test]
    fn test_money_above_js_safe_becomes_string() {
        // Money is stored as an i64 of fractional units — a real value, but a
        // valid postgres value still has to round-trip without precision loss.
        let buf = 9_007_199_254_740_993i64.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::MONEY, &buf),
            JsonValue::String("9007199254740993".to_string())
        );
    }

    #[test]
    fn test_xml() {
        let buf = b"<root>test</root>";
        assert_eq!(
            extract_or_null(&Type::XML, buf),
            JsonValue::String("<root>test</root>".to_string())
        );
    }

    #[test]
    fn test_refcursor() {
        let buf = b"my_cursor";
        assert_eq!(
            extract_or_null(&Type::REFCURSOR, buf),
            JsonValue::String("my_cursor".to_string())
        );
    }

    #[test]
    fn test_pg_lsn() {
        // PgLsn: 8 bytes (upper u32 + lower u32)
        let buf = [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x2A];
        assert_eq!(
            extract_or_null(&Type::PG_LSN, &buf),
            JsonValue::String("1/2A".to_string())
        );
    }

    #[test]
    fn test_txid_snapshot() {
        // TxidSnapshot: 4 bytes count + 8 bytes xmin + 8 bytes xmax + count*8 bytes active_xids
        let mut buf = Vec::new();
        buf.extend_from_slice(&0i32.to_be_bytes()); // 0 active xids
        buf.extend_from_slice(&100i64.to_be_bytes()); // xmin
        buf.extend_from_slice(&200i64.to_be_bytes()); // xmax
        assert_eq!(
            extract_or_null(&Type::TXID_SNAPSHOT, &buf),
            JsonValue::String("100:200:".to_string())
        );
    }

    #[test]
    fn test_pg_snapshot_with_active_xids() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&2i32.to_be_bytes()); // 2 active xids
        buf.extend_from_slice(&100i64.to_be_bytes()); // xmin
        buf.extend_from_slice(&200i64.to_be_bytes()); // xmax
        buf.extend_from_slice(&150i64.to_be_bytes()); // active xid 1
        buf.extend_from_slice(&175i64.to_be_bytes()); // active xid 2
        assert_eq!(
            extract_or_null(&Type::PG_SNAPSHOT, &buf),
            JsonValue::String("100:200:150,175".to_string())
        );
    }

    #[test]
    fn test_aclitem() {
        let buf = b"postgres=arwdDxt/postgres";
        assert_eq!(
            extract_or_null(&Type::ACLITEM, buf),
            JsonValue::String("postgres=arwdDxt/postgres".to_string())
        );
    }

    #[test]
    fn test_pg_node_tree() {
        let buf = b"12345 12346 12347";
        assert_eq!(
            extract_or_null(&Type::PG_NODE_TREE, buf),
            JsonValue::String("12345 12346 12347".to_string())
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

    #[test]
    fn test_regproc() {
        let buf = 12345u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGPROC, &buf),
            JsonValue::Number(12345.into())
        );
    }

    #[test]
    fn test_regprocedure() {
        let buf = 67890u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGPROCEDURE, &buf),
            JsonValue::Number(67890.into())
        );
    }

    #[test]
    fn test_regoper() {
        let buf = 11111u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGOPER, &buf),
            JsonValue::Number(11111.into())
        );
    }

    #[test]
    fn test_regoperator() {
        let buf = 22222u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGOPERATOR, &buf),
            JsonValue::Number(22222.into())
        );
    }

    #[test]
    fn test_regconfig() {
        let buf = 3748u32.to_be_bytes(); // default OID for 'english'
        assert_eq!(
            extract_or_null(&Type::REGCONFIG, &buf),
            JsonValue::Number(3748.into())
        );
    }

    #[test]
    fn test_regdictionary() {
        let buf = 3380u32.to_be_bytes(); // default OID for 'simple'
        assert_eq!(
            extract_or_null(&Type::REGDICTIONARY, &buf),
            JsonValue::Number(3380.into())
        );
    }

    #[test]
    fn test_regnamespace() {
        let buf = 11u32.to_be_bytes(); // default OID for 'pg_catalog'
        assert_eq!(
            extract_or_null(&Type::REGNAMESPACE, &buf),
            JsonValue::Number(11.into())
        );
    }

    #[test]
    fn test_regrole() {
        let buf = 10u32.to_be_bytes(); // default OID for 'pg_role'
        assert_eq!(
            extract_or_null(&Type::REGROLE, &buf),
            JsonValue::Number(10.into())
        );
    }

    #[test]
    fn test_regcollation() {
        let buf = 100u32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::REGCOLLATION, &buf),
            JsonValue::Number(100.into())
        );
    }

    #[test]
    fn test_timetz() {
        // TIMETZ: 8 bytes microseconds + 4 bytes timezone offset (seconds)
        // 14:30:05.37 = 52205370000 microseconds
        let mut buf = Vec::new();
        buf.extend_from_slice(&52205370000i64.to_be_bytes());
        buf.extend_from_slice(&(-18347i32).to_be_bytes()); // +5:05:47 (EST)
        assert_eq!(
            extract_or_null(&Type::TIMETZ, &buf),
            JsonValue::String("14:30:05.37+05:05:47".to_string())
        );
    }

    #[test]
    fn test_interval() {
        // INTERVAL: 8 bytes microseconds + 4 bytes days + 4 bytes months
        // 1 year 2 months 3 days 04:05:06.007
        let mut buf = Vec::new();
        // microseconds: 4*3600*1000000 + 5*60*1000000 + 6*1000000 + 7000 = 14706007000
        buf.extend_from_slice(&14706007000i64.to_be_bytes());
        buf.extend_from_slice(&3i32.to_be_bytes()); // 3 days
        buf.extend_from_slice(&14i32.to_be_bytes()); // 14 months (1 year + 2 months)
        assert_eq!(
            extract_or_null(&Type::INTERVAL, &buf),
            JsonValue::String("1 year 2 months 3 days 04:05:06.7".to_string())
        );
    }

    #[test]
    fn test_citext() {
        let buf = b"CaseInsensitiveText";
        // Create a custom Type for citext
        let citext_type = Type::new(
            "citext".to_string(),
            10000,
            Kind::Simple,
            "public".to_string(),
        );
        assert_eq!(
            extract_or_null(&citext_type, buf),
            JsonValue::String("CaseInsensitiveText".to_string())
        );
    }

    #[test]
    fn test_ltree() {
        let buf = b"\x01Top.Science.Astronomy";
        let ltree_type = Type::new(
            "ltree".to_string(),
            10001,
            Kind::Simple,
            "public".to_string(),
        );
        assert_eq!(
            extract_or_null(&ltree_type, buf),
            JsonValue::String("Top.Science.Astronomy".to_string())
        );
    }

    #[test]
    fn test_lquery() {
        let buf = b"\x01Top.*{1,2}";
        let lquery_type = Type::new(
            "lquery".to_string(),
            10002,
            Kind::Simple,
            "public".to_string(),
        );
        assert_eq!(
            extract_or_null(&lquery_type, buf),
            JsonValue::String("Top.*{1,2}".to_string())
        );
    }

    #[test]
    fn test_ltxtquery() {
        let buf = b"\x01Top & Science";
        let ltxtquery_type = Type::new(
            "ltxtquery".to_string(),
            10003,
            Kind::Simple,
            "public".to_string(),
        );
        assert_eq!(
            extract_or_null(&ltxtquery_type, buf),
            JsonValue::String("Top & Science".to_string())
        );
    }

    #[test]
    fn test_tsvector() {
        // TsVector: 4 bytes count + lexemes
        // Each lexeme: null-terminated text + 2 bytes position count + positions
        let mut buf = Vec::new();
        buf.extend_from_slice(&1i32.to_be_bytes()); // 1 lexeme
        buf.extend_from_slice(b"hello\0"); // lexeme text
        buf.extend_from_slice(&1i16.to_be_bytes()); // 1 position
        buf.extend_from_slice(&1u16.to_be_bytes()); // position 1, weight D (0)
        assert_eq!(
            extract_or_null(&Type::TS_VECTOR, &buf),
            JsonValue::String("'hello':1".to_string())
        );
    }

    #[test]
    fn test_tsvector_empty() {
        let buf = 0i32.to_be_bytes();
        assert_eq!(
            extract_or_null(&Type::TS_VECTOR, &buf),
            JsonValue::String("".to_string())
        );
    }

    #[test]
    fn test_tsvector_with_weights() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&1i32.to_be_bytes()); // 1 lexeme
        buf.extend_from_slice(b"world\0"); // lexeme text
        buf.extend_from_slice(&2i16.to_be_bytes()); // 2 positions
                                                    // position 5, weight A (3 << 14 = 0xC000 | 5 = 0xC005)
        buf.extend_from_slice(&0xC005u16.to_be_bytes());
        // position 10, weight B (2 << 14 = 0x8000 | 10 = 0x800A)
        buf.extend_from_slice(&0x800Au16.to_be_bytes());
        assert_eq!(
            extract_or_null(&Type::TS_VECTOR, &buf),
            JsonValue::String("'world':5A,10B".to_string())
        );
    }

    #[test]
    fn test_tsquery() {
        // TsQuery binary: type byte + data
        // length, type=1 (operand): weight(0) + prefixed(1) + null-terminated text
        let buf = [0u8, 0, 0, 1, 1, 0, 0, b'f', b'o', b'o', 0]; // operand 'foo', weight D, not prefixed
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'foo'".to_string())
        );
    }

    #[test]
    fn test_tsquery_and() {
        // AND query: type=2, operator=2 (&), then two operands
        let buf = [
            0u8, 0, 0, 3, // length prefix
            2u8, 2, // type=2, operator=AND
            1u8, 0, 0, b'f', b'o', b'o', 0, // operand 'foo'
            1u8, 0, 0, b'b', b'a', b'r', 0, // operand 'bar'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'bar' & 'foo'".to_string())
        );
    }

    #[test]
    fn test_tsquery_simple_operand() {
        // Simple operand: 'hello' (weight D, not prefixed)
        let buf = [
            0u8, 0, 0, 1, // length prefix
            1u8, 0, 0, b'h', b'e', b'l', b'l', b'o', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'hello'".to_string())
        );
    }

    #[test]
    fn test_tsquery_all_weights() {
        // Weight A
        let buf_a = [
            0u8, 0, 0, 1, // length prefix
            1u8, 8, 0, b'a', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf_a),
            JsonValue::String("'a':A".to_string())
        );

        // Weight B
        let buf_b = [
            0u8, 0, 0, 1, // length prefix
            1u8, 4, 0, b'b', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf_b),
            JsonValue::String("'b':B".to_string())
        );

        // Weight C
        let buf_c = [
            0u8, 0, 0, 1, // length prefix
            1u8, 2, 0, b'c', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf_c),
            JsonValue::String("'c':C".to_string())
        );

        // Weight D
        let buf_d = [
            0u8, 0, 0, 1, // length prefix
            1u8, 1, 0, b'd', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf_d),
            JsonValue::String("'d':D".to_string())
        );

        // no Weight (default)
        let buf_d = [
            0u8, 0, 0, 1, // length prefix
            1u8, 0, 0, b'd', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf_d),
            JsonValue::String("'d'".to_string())
        );
    }

    #[test]
    fn test_tsquery_prefixed() {
        // 'foo':* (weight D, prefixed)
        let buf = [
            0u8, 0, 0, 1, // length prefix
            1u8, 0, 1, b'f', b'o', b'o', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'foo':*".to_string())
        );
    }

    #[test]
    fn test_tsquery_prefixed_with_weight() {
        // 'bar':*A (weight A, prefixed) — code outputs weight after :*
        let buf = [
            0u8, 0, 0, 1, // length prefix
            1u8, 8, 1, b'b', b'a', b'r', 0,
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'bar':*A".to_string())
        );
    }

    #[test]
    fn test_tsquery_not() {
        // !'foo':*
        // Tree:
        //   NOT(1)
        //     |
        //  'foo':*
        let buf = [
            0u8, 0, 0, 2, // length prefix
            2, 1, // NOT operator
            1, 0, 1, b'f', b'o', b'o', 0, // operand: weight D, prefixed, "foo"
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("!'foo':*".to_string())
        );
    }

    #[test]
    fn test_tsquery_or() {
        // 'cat' | 'dog'
        let buf = [
            0u8, 0, 0, 3, // length prefix
            2, 3, // OR operator
            1, 0, 0, b'd', b'o', b'g', 0, // right: 'dog'
            1, 0, 0, b'c', b'a', b't', 0, // left: 'cat'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'cat' | 'dog'".to_string())
        );
    }

    #[test]
    fn test_tsquery_phrase_default_distance() {
        // 'hello' <-> 'world' (distance=1)
        let buf = [
            0u8, 0, 0, 3, // length prefix
            2, 4, 0x00, 0x01, // PHRASE operator, distance=1
            1, 0, 0, b'w', b'o', b'r', b'l', b'd', 0, // right: 'world'
            1, 0, 0, b'h', b'e', b'l', b'l', b'o', 0, // left: 'hello'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'hello' <-> 'world'".to_string())
        );
    }

    #[test]
    fn test_tsquery_phrase_custom_distance() {
        // 'hello' <5> 'world'
        let buf = [
            0u8, 0, 0, 3, // length prefix
            2, 4, 0x00, 0x05, // PHRASE operator, distance=5
            1, 0, 0, b'w', b'o', b'r', b'l', b'd', 0, // right: 'world'
            1, 0, 0, b'h', b'e', b'l', b'l', b'o', 0, // left: 'hello'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'hello' <5> 'world'".to_string())
        );
    }

    #[test]
    fn test_tsquery_and_or_nesting() {
        // 'fat':A & 'rat':B | ('cat':C <-> 'mat':A)
        // Tree:
        //              OR(3)
        //            /      \
        //        AND(2)    PHRASE(4,d=1)
        //        /   \      /         \
        //   'fat':A 'rat':B 'cat':C  'mat':A
        let buf = [
            0u8, 0, 0, 7, // length prefix
            2, 3, // OR
            2, 4, 0x00, 0x01, //   PHRASE d=1
            1, 8, 0, b'm', b'a', b't', 0, //     right: 'mat':A
            1, 2, 0, b'c', b'a', b't', 0, //     left: 'cat':C
            2, 2, //   AND
            1, 4, 0, b'r', b'a', b't', 0, //     right: 'rat':B
            1, 8, 0, b'f', b'a', b't', 0, //     left: 'fat':A
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'fat':A & 'rat':B | 'cat':C <-> 'mat':A".to_string())
        );
    }

    #[test]
    fn test_tsquery_deeply_nested() {
        // 'a':A & 'b':B & ('c':C | ('d':A <-> 'e':B))
        // Tree:
        //                  AND(2)
        //               /         \
        //           AND(2)        OR(3)
        //          /    \        /    \
        //      'a':A  'b':B  'c':C  PHRASE(4,d=1)
        //                           /        \
        //                        'd':A      'e':B
        let buf = [
            0u8, 0, 0, 9, // length prefix
            2, 2, // top AND
            2, 3, //   right: OR
            2, 4, 0x00, 0x01, //     right of OR: PHRASE d=1
            1, 4, 0, b'e', 0, //       right: 'e':B
            1, 8, 0, b'd', 0, //       left: 'd':A
            1, 2, 0, b'c', 0, //     left of OR: 'c':C
            2, 2, //   left: AND
            1, 4, 0, b'b', 0, //     right: 'b':B
            1, 8, 0, b'a', 0, //     left: 'a':A
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'a':A & 'b':B & ('c':C | 'd':A <-> 'e':B)".to_string())
        );
    }

    #[test]
    fn test_tsquery_not_with_or() {
        // !'foo' | 'bar'
        // Tree:
        //       OR(3)
        //      /    \
        //   'bar'  NOT(1)
        //            |
        //          'foo'
        let buf = [
            0u8, 0, 0, 4, // length prefix
            2, 3, // OR
            1, 0, 0, b'b', b'a', b'r', 0, // right: 'bar'
            2, 1, // left: NOT
            1, 0, 0, b'f', b'o', b'o', 0, //   operand: 'foo'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("!'foo' | 'bar'".to_string())
        );
    }

    #[test]
    fn test_tsquery_complex_search_query() {
        // Represents a realistic full-text search:
        // 'quick':A & 'brown':B & ('fox':C | 'dog') & !'cat':*
        // Tree:
        //                      AND(2)
        //                   /         \
        //               AND(2)       AND(2)
        //              /    \        /    \
        //         'quick':A 'brown':B OR(3) NOT(1)
        //                              / \    |
        //                          'fox':C 'dog' 'cat':*
        let buf = [
            0u8, 0, 0, 10, // length prefix
            2, 2, // top AND
            2, 2, //   right: AND
            2, 3, //     right: OR
            1, 0, 0, b'd', b'o', b'g', 0, //       right: 'dog'
            1, 2, 0, b'f', b'o', b'x', 0, //       left: 'fox':C
            2, 1, //     left: NOT
            1, 0, 1, b'c', b'a', b't', 0, //       operand: 'cat':*
            2, 2, //   left: AND
            1, 4, 0, b'b', b'r', b'o', b'w', b'n', 0, //     right: 'brown':B
            1, 8, 0, b'q', b'u', b'i', b'c', b'k', 0, //     left: 'quick':A
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'quick':A & 'brown':B & !'cat':* & ('fox':C | 'dog')".to_string())
        );
    }

    #[test]
    fn test_tsquery_multiple_phrases() {
        // 'the' <-> 'quick' & 'brown' <-> 'fox'
        // Tree:
        //           AND(2)
        //          /      \
        //     PHRASE(4)  PHRASE(4)
        //     /    \      /    \
        //  'the' 'quick' 'brown' 'fox'

        let buf = [
            0, 0, 0, 7, // length prefix
            2, 2, // AND
            2, 4, 0x00, 0x01, //   right: PHRASE
            1, 0, 0, b'f', b'o', b'x', 0, //     right: 'fox'
            1, 0, 0, b'b', b'r', b'o', b'w', b'n', 0, //     left: 'brown'
            2, 4, 0x00, 0x01, //   left: PHRASE
            1, 0, 0, b'q', b'u', b'i', b'c', b'k', 0, //     right: 'quick'
            1, 0, 0, b't', b'h', b'e', 0, //     left: 'the'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'the' <-> 'quick' & 'brown' <-> 'fox'".to_string())
        );
    }

    #[test]
    fn test_tsquery_not_not() {
        // !!'foo' (double negation)
        let buf = [
            0u8, 0, 0, 3, // length prefix
            2, 1, // outer NOT
            2, 1, // inner NOT
            1, 0, 0, b'f', b'o', b'o', 0, // operand: 'foo'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("!!'foo'".to_string())
        );
    }

    #[test]
    fn test_tsquery_large_phrase_distance() {
        // 'start' <100> 'end'
        let buf = [
            0u8, 0, 0, 3, // length prefix
            2, 4, 0x00, 0x64, // PHRASE distance=100 (0x64)
            1, 0, 0, b'e', b'n', b'd', 0, // right: 'end'
            1, 0, 0, b's', b't', b'a', b'r', b't', 0, // left: 'start'
        ];
        assert_eq!(
            extract_or_null(&Type::TSQUERY, &buf),
            JsonValue::String("'start' <100> 'end'".to_string())
        );
    }

    #[test]
    fn test_gts_vector() {
        // GtsVector: 4 bytes header + 1 byte signature
        let buf = [0x01, 0x02, 0x03, 0x04, 0xAB];
        let result = extract_or_null(&Type::GTS_VECTOR, &buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:5:"));
            }
            _ => panic!("expected blob string for GTS_VECTOR"),
        }
    }

    #[test]
    fn test_pg_ndistinct() {
        let buf = [0xDE, 0xAD, 0xBE, 0xEF];
        let result = extract_or_null(&Type::PG_NDISTINCT, &buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:4:"));
            }
            _ => panic!("expected blob string for PG_NDISTINCT"),
        }
    }

    #[test]
    fn test_pg_dependencies() {
        let buf = [0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x01];
        let result = extract_or_null(&Type::PG_DEPENDENCIES, &buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:6:"));
            }
            _ => panic!("expected blob string for PG_DEPENDENCIES"),
        }
    }

    #[test]
    fn test_pg_brin_bloom_summary() {
        let buf = [0x01, 0x02, 0x03];
        let result = extract_or_null(&Type::PG_BRIN_BLOOM_SUMMARY, &buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:3:"));
            }
            _ => panic!("expected blob string for PG_BRIN_BLOOM_SUMMARY"),
        }
    }

    #[test]
    fn test_pg_brin_minmax_multi_summary() {
        let buf = [0xAA, 0xBB];
        let result = extract_or_null(&Type::PG_BRIN_MINMAX_MULTI_SUMMARY, &buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:2:"));
            }
            _ => panic!("expected blob string for PG_BRIN_MINMAX_MULTI_SUMMARY"),
        }
    }

    #[test]
    fn test_pg_mcv_list() {
        let buf = [0x01, 0x02, 0x03, 0x04, 0x05];
        let result = extract_or_null(&Type::PG_MCV_LIST, &buf);
        match result {
            JsonValue::String(s) => {
                assert!(s.starts_with("BLOB:5:"));
            }
            _ => panic!("expected blob string for PG_MCV_LIST"),
        }
    }

    #[test]
    fn test_jsonpath() {
        // JSONPATH: 1 byte version + path string
        let mut buf = vec![1u8]; // version 1
        buf.extend_from_slice(b"$.store.book[*].author");
        assert_eq!(
            extract_or_null(&Type::JSONPATH, &buf),
            JsonValue::String("$.store.book[*].author".to_string())
        );
    }

    #[test]
    fn test_hstore() {
        // HSTORE uses HashMap<String, Option<String>> via tokio_postgres
        // Binary format is complex; this test verifies the type mapping exists
        // In practice, hstore binary parsing is handled by tokio_postgres
        let hstore_type = Type::new(
            "hstore".to_string(),
            10004,
            Kind::Simple,
            "public".to_string(),
        );
        // Empty hstore would be handled by tokio_postgres internally
        // We just verify the type match works
        let result = extract_or_null(&hstore_type, &[]);
        // Empty buffer should fail gracefully
        assert_eq!(result, JsonValue::Null);
    }
}
