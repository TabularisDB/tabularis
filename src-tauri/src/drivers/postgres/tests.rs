use super::binding::{
    PgValueOptions, bind_pg_boolean_string, bind_pg_number, bind_pg_numeric_string, bind_pg_value,
    build_pk_predicate,
};
use super::helpers::{extract_base_type, is_implicit_cast_compatible};

mod extract_base_type_tests {
    use super::*;

    #[test]
    fn simple_type() {
        assert_eq!(extract_base_type("INTEGER"), "INTEGER");
    }

    #[test]
    fn type_with_length() {
        assert_eq!(extract_base_type("VARCHAR(255)"), "VARCHAR");
    }

    #[test]
    fn type_with_precision() {
        assert_eq!(extract_base_type("NUMERIC(10,2)"), "NUMERIC");
    }

    #[test]
    fn parameterized_geometry() {
        assert_eq!(extract_base_type("GEOMETRY(Point, 4326)"), "GEOMETRY");
    }

    #[test]
    fn type_with_spaces() {
        assert_eq!(extract_base_type("DOUBLE PRECISION"), "DOUBLE PRECISION");
    }

    #[test]
    fn lowercase_input() {
        assert_eq!(extract_base_type("varchar(100)"), "VARCHAR");
    }

    #[test]
    fn type_with_leading_trailing_spaces() {
        assert_eq!(extract_base_type("  integer  "), "INTEGER");
    }

    #[test]
    fn geography_parameterized() {
        assert_eq!(extract_base_type("GEOGRAPHY(Point, 4326)"), "GEOGRAPHY");
    }

    #[test]
    fn serial_type() {
        assert_eq!(extract_base_type("BIGSERIAL"), "BIGSERIAL");
    }
}

mod is_implicit_cast_compatible_tests {
    use super::*;

    #[test]
    fn same_type_is_compatible() {
        assert!(is_implicit_cast_compatible("INTEGER", "INTEGER"));
    }

    #[test]
    fn integer_to_bigint() {
        assert!(is_implicit_cast_compatible("INTEGER", "BIGINT"));
    }

    #[test]
    fn smallint_to_bigint() {
        assert!(is_implicit_cast_compatible("SMALLINT", "BIGINT"));
    }

    #[test]
    fn bigint_to_smallint() {
        assert!(is_implicit_cast_compatible("BIGINT", "SMALLINT"));
    }

    #[test]
    fn serial_to_integer() {
        assert!(is_implicit_cast_compatible("SERIAL", "INTEGER"));
    }

    #[test]
    fn varchar_to_text() {
        assert!(is_implicit_cast_compatible("VARCHAR", "TEXT"));
    }

    #[test]
    fn char_to_text() {
        assert!(is_implicit_cast_compatible("CHAR", "TEXT"));
    }

    #[test]
    fn text_to_citext() {
        assert!(is_implicit_cast_compatible("TEXT", "CITEXT"));
    }

    #[test]
    fn timestamp_to_timestamptz() {
        assert!(is_implicit_cast_compatible("TIMESTAMP", "TIMESTAMPTZ"));
    }

    #[test]
    fn time_to_timetz() {
        assert!(is_implicit_cast_compatible("TIME", "TIMETZ"));
    }

    #[test]
    fn json_to_jsonb() {
        assert!(is_implicit_cast_compatible("JSON", "JSONB"));
    }

    #[test]
    fn real_to_double_precision() {
        assert!(is_implicit_cast_compatible("REAL", "DOUBLE PRECISION"));
    }

    #[test]
    fn numeric_to_decimal() {
        assert!(is_implicit_cast_compatible("NUMERIC", "DECIMAL"));
    }

    #[test]
    fn bit_to_varbit() {
        assert!(is_implicit_cast_compatible("BIT", "VARBIT"));
    }

    #[test]
    fn integer_to_text_not_compatible() {
        assert!(!is_implicit_cast_compatible("INTEGER", "TEXT"));
    }

    #[test]
    fn text_to_boolean_not_compatible() {
        assert!(!is_implicit_cast_compatible("TEXT", "BOOLEAN"));
    }

    #[test]
    fn varchar_to_integer_not_compatible() {
        assert!(!is_implicit_cast_compatible("VARCHAR", "INTEGER"));
    }

    #[test]
    fn timestamp_to_integer_not_compatible() {
        assert!(!is_implicit_cast_compatible("TIMESTAMP", "INTEGER"));
    }

    #[test]
    fn jsonb_to_integer_not_compatible() {
        assert!(!is_implicit_cast_compatible("JSONB", "INTEGER"));
    }

    #[test]
    fn geometry_to_text_not_compatible() {
        assert!(!is_implicit_cast_compatible("GEOMETRY", "TEXT"));
    }

    #[test]
    fn uuid_to_text_not_compatible() {
        assert!(!is_implicit_cast_compatible("UUID", "TEXT"));
    }
}

mod pg_number_binding_tests {
    use super::*;

    #[test]
    fn positive_i64_casts_to_bigint() {
        let n = serde_json::Number::from(42i64);
        let bound = bind_pg_number(&n, 1).unwrap();
        assert_eq!(bound.sql, "CAST($1 AS bigint)");
        assert!(bound.param.is_some());
    }

    #[test]
    fn negative_i64_casts_to_bigint() {
        let n = serde_json::Number::from(-7i64);
        let bound = bind_pg_number(&n, 5).unwrap();
        assert_eq!(bound.sql, "CAST($5 AS bigint)");
    }

    #[test]
    fn zero_casts_to_bigint() {
        let n = serde_json::Number::from(0i64);
        let bound = bind_pg_number(&n, 2).unwrap();
        assert_eq!(bound.sql, "CAST($2 AS bigint)");
    }

    #[test]
    fn f64_casts_to_double_precision() {
        let n = serde_json::Number::from_f64(3.14).unwrap();
        let bound = bind_pg_number(&n, 3).unwrap();
        assert_eq!(bound.sql, "CAST($3 AS double precision)");
    }

    #[test]
    fn large_u64_falls_back_to_double_precision() {
        // u64 above i64::MAX cannot be represented as i64, but as_f64 still returns Some.
        let n = serde_json::Number::from(u64::MAX);
        let bound = bind_pg_number(&n, 1).unwrap();
        assert_eq!(bound.sql, "CAST($1 AS double precision)");
    }

    #[test]
    fn placeholder_index_is_preserved() {
        let n = serde_json::Number::from(1i64);
        let bound = bind_pg_number(&n, 99).unwrap();
        assert_eq!(bound.sql, "CAST($99 AS bigint)");
    }
}

mod pg_numeric_string_binding_tests {
    use super::*;

    #[test]
    fn integer_string_for_integer_column_casts_to_bigint() {
        let bound = bind_pg_numeric_string("22", "integer", 1).unwrap().unwrap();
        assert_eq!(bound.sql, "CAST($1 AS bigint)");
        assert!(bound.param.is_some());
    }

    #[test]
    fn decimal_string_for_numeric_column_casts_to_numeric() {
        let bound = bind_pg_numeric_string("12.34", "numeric(10,2)", 2)
            .unwrap()
            .unwrap();
        assert_eq!(bound.sql, "CAST($2 AS numeric)");
    }

    #[test]
    fn float_string_for_real_column_casts_to_double_precision() {
        let bound = bind_pg_numeric_string("3.14", "real", 3).unwrap().unwrap();
        assert_eq!(bound.sql, "CAST($3 AS double precision)");
    }

    #[test]
    fn text_column_is_not_handled_as_numeric() {
        assert!(bind_pg_numeric_string("22", "text", 1).is_none());
    }

    #[test]
    fn invalid_integer_string_returns_detailed_error() {
        let err = match bind_pg_numeric_string("not-a-number", "integer", 1).unwrap() {
            Ok(_) => panic!("expected invalid integer binding to fail"),
            Err(err) => err,
        };
        assert!(err.contains("Cannot convert value"));
        assert!(err.contains("integer"));
    }
}

mod pg_boolean_string_binding_tests {
    use super::*;

    #[test]
    fn true_string_for_boolean_column_binds_as_bool() {
        let bound = bind_pg_boolean_string("true", "boolean", 1).unwrap().unwrap();
        assert_eq!(bound.sql, "$1");
        assert!(bound.param.is_some());
    }

    #[test]
    fn false_string_for_boolean_column_binds_as_bool() {
        let bound = bind_pg_boolean_string("false", "boolean", 2)
            .unwrap()
            .unwrap();
        assert_eq!(bound.sql, "$2");
        assert!(bound.param.is_some());
    }

    #[test]
    fn pg_literal_aliases_are_accepted() {
        for s in ["t", "T", "yes", "Y", "on", "1"] {
            assert!(
                bind_pg_boolean_string(s, "boolean", 1).unwrap().is_ok(),
                "expected {:?} to parse as TRUE",
                s
            );
        }
        for s in ["f", "F", "no", "N", "off", "0"] {
            assert!(
                bind_pg_boolean_string(s, "boolean", 1).unwrap().is_ok(),
                "expected {:?} to parse as FALSE",
                s
            );
        }
    }

    #[test]
    fn surrounding_whitespace_is_tolerated() {
        assert!(
            bind_pg_boolean_string("  true  ", "boolean", 1)
                .unwrap()
                .is_ok()
        );
    }

    #[test]
    fn bool_alias_for_column_type_is_handled() {
        assert!(bind_pg_boolean_string("true", "bool", 1).unwrap().is_ok());
    }

    #[test]
    fn non_boolean_column_returns_none() {
        assert!(bind_pg_boolean_string("true", "text", 1).is_none());
        assert!(bind_pg_boolean_string("1", "integer", 1).is_none());
    }

    #[test]
    fn invalid_boolean_string_returns_detailed_error() {
        let err = match bind_pg_boolean_string("maybe", "boolean", 1).unwrap() {
            Ok(_) => panic!("expected invalid boolean binding to fail"),
            Err(err) => err,
        };
        assert!(err.contains("Cannot convert value"));
        assert!(err.contains("boolean"));
    }
}

mod bind_pg_value_tests {
    use super::*;

    #[test]
    fn update_string_for_boolean_column_uses_boolean_binding() {
        let bound = bind_pg_value(
            serde_json::json!("true"),
            1,
            PgValueOptions {
                column_type: Some("boolean"),
                max_blob_size: 1024,
                allow_default: true,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "$1");
        assert!(bound.param.is_some());
    }

    #[test]
    fn invalid_boolean_string_for_boolean_column_returns_error() {
        let err = match bind_pg_value(
            serde_json::json!("maybe"),
            1,
            PgValueOptions {
                column_type: Some("boolean"),
                max_blob_size: 1024,
                allow_default: true,
            },
        ) {
            Ok(_) => panic!("expected invalid boolean binding to fail"),
            Err(err) => err,
        };
        assert!(err.contains("boolean"));
    }

    #[test]
    fn update_string_for_numeric_column_uses_numeric_binding() {
        let bound = bind_pg_value(
            serde_json::json!("22"),
            1,
            PgValueOptions {
                column_type: Some("integer"),
                max_blob_size: 1024,
                allow_default: true,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "CAST($1 AS bigint)");
        assert!(bound.param.is_some());
    }

    #[test]
    fn default_sentinel_is_only_used_when_allowed() {
        let bound = bind_pg_value(
            serde_json::json!("__USE_DEFAULT__"),
            1,
            PgValueOptions {
                column_type: None,
                max_blob_size: 1024,
                allow_default: true,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "DEFAULT");
        assert!(bound.param.is_none());
    }

    #[test]
    fn insert_path_treats_default_sentinel_as_regular_string() {
        let bound = bind_pg_value(
            serde_json::json!("__USE_DEFAULT__"),
            1,
            PgValueOptions {
                column_type: None,
                max_blob_size: 1024,
                allow_default: false,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "$1");
        assert!(bound.param.is_some());
    }

    #[test]
    fn json_array_becomes_literal_without_parameter() {
        let bound = bind_pg_value(
            serde_json::json!(["a", "b"]),
            1,
            PgValueOptions {
                column_type: None,
                max_blob_size: 1024,
                allow_default: false,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "ARRAY['a', 'b']");
        assert!(bound.param.is_none());
    }

    #[test]
    fn json_object_into_jsonb_column_bound_as_value() {
        let bound = bind_pg_value(
            serde_json::json!({"key": "value", "n": 42}),
            1,
            PgValueOptions {
                column_type: Some("jsonb"),
                max_blob_size: 1024,
                allow_default: false,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "$1");
        assert!(bound.param.is_some());
    }

    #[test]
    fn json_array_into_json_column_bound_as_value_not_pg_array() {
        let bound = bind_pg_value(
            serde_json::json!([1, 2, 3]),
            1,
            PgValueOptions {
                column_type: Some("json"),
                max_blob_size: 1024,
                allow_default: false,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "$1");
        assert!(bound.param.is_some());
    }

    #[test]
    fn json_null_into_jsonb_column_stays_sql_null() {
        let bound = bind_pg_value(
            serde_json::Value::Null,
            1,
            PgValueOptions {
                column_type: Some("jsonb"),
                max_blob_size: 1024,
                allow_default: false,
            },
        )
        .unwrap();

        assert_eq!(bound.sql, "NULL");
        assert!(bound.param.is_none());
    }

    #[test]
    fn json_object_into_non_json_column_returns_clear_error() {
        let err = match bind_pg_value(
            serde_json::json!({"key": "value"}),
            1,
            PgValueOptions {
                column_type: Some("text"),
                max_blob_size: 1024,
                allow_default: false,
            },
        ) {
            Ok(_) => panic!("expected error binding JSON object to non-JSON column"),
            Err(err) => err,
        };
        assert!(err.contains("JSON object"));
    }
}

mod build_pk_predicate_tests {
    use super::*;

    #[test]
    fn integer_pk_uses_bigint_cast() {
        let (sql, _) = build_pk_predicate("id", serde_json::json!(1), 1).unwrap();
        assert_eq!(sql, "\"id\" = CAST($1 AS bigint)");
    }

    #[test]
    fn float_pk_uses_double_precision_cast() {
        let (sql, _) = build_pk_predicate("id", serde_json::json!(1.5), 2).unwrap();
        assert_eq!(sql, "\"id\" = CAST($2 AS double precision)");
    }

    #[test]
    fn uuid_string_pk_binds_without_cast() {
        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        let (sql, _) = build_pk_predicate("uuid", serde_json::json!(uuid), 1).unwrap();
        assert_eq!(sql, "\"uuid\" = $1");
    }

    #[test]
    fn plain_string_pk_binds_without_cast() {
        let (sql, _) = build_pk_predicate("name", serde_json::json!("alice"), 1).unwrap();
        assert_eq!(sql, "\"name\" = $1");
    }

    #[test]
    fn pk_col_with_quotes_is_escaped() {
        let (sql, _) = build_pk_predicate("a\"b", serde_json::json!(1), 1).unwrap();
        assert_eq!(sql, "\"a\"\"b\" = CAST($1 AS bigint)");
    }

    #[test]
    fn null_pk_is_rejected() {
        assert!(build_pk_predicate("id", serde_json::Value::Null, 1).is_err());
    }

    #[test]
    fn bool_pk_is_rejected() {
        assert!(build_pk_predicate("id", serde_json::json!(true), 1).is_err());
    }
}
