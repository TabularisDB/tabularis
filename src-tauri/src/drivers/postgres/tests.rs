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
