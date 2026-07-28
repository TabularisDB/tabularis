use super::*;

#[test]
fn parse_major_accepts_bare_integer() {
    assert_eq!(parse_major_version("11"), 11);
    assert_eq!(parse_major_version("14"), 14);
    assert_eq!(parse_major_version("16"), 16);
}

#[test]
fn parse_major_accepts_dotted_version() {
    assert_eq!(parse_major_version("11.0"), 11);
    assert_eq!(parse_major_version("14.0.3465.1"), 14);
    assert_eq!(parse_major_version("16.0.1000.6"), 16);
}

#[test]
fn parse_major_trims_whitespace() {
    assert_eq!(parse_major_version("  14 "), 14);
    assert_eq!(parse_major_version("\t\n15\r\n"), 15);
}

#[test]
fn parse_major_falls_back_on_empty() {
    assert_eq!(parse_major_version(""), DEFAULT_MAJOR);
    assert_eq!(parse_major_version("   "), DEFAULT_MAJOR);
}

#[test]
fn parse_major_falls_back_on_garbage() {
    assert_eq!(parse_major_version("NULL"), DEFAULT_MAJOR);
    assert_eq!(parse_major_version("abc.def"), DEFAULT_MAJOR);
}

#[test]
fn parse_major_falls_back_when_first_segment_overflows_u8() {
    // Can't happen in reality, but the parser must be defensive.
    assert_eq!(parse_major_version("9999"), DEFAULT_MAJOR);
}

#[test]
fn parse_version_banner_maps_release_years() {
    assert_eq!(
        parse_version_banner("Microsoft SQL Server 2017 (RTM-CU31) - 14.0.3465.1"),
        14
    );
    assert_eq!(parse_version_banner("SQL Server 2022 Enterprise"), 16);
    assert_eq!(parse_version_banner("SQL Server 2019 (RTM)"), 15);
    assert_eq!(parse_version_banner("SQL Server 2012 RTM"), 11);
    assert_eq!(parse_version_banner("SQL Server 2008 R2"), 10);
}

#[test]
fn parse_version_banner_falls_back_on_missing_needle() {
    assert_eq!(parse_version_banner(""), DEFAULT_MAJOR);
    assert_eq!(parse_version_banner("Azure SQL Edge"), DEFAULT_MAJOR);
    assert_eq!(parse_version_banner("totally unrelated"), DEFAULT_MAJOR);
}

#[test]
fn parse_version_banner_falls_back_on_unknown_year() {
    assert_eq!(parse_version_banner("SQL Server 1999"), DEFAULT_MAJOR);
    assert_eq!(parse_version_banner("SQL Server 2099"), DEFAULT_MAJOR);
}

#[test]
fn supports_offset_fetch_gates_on_2012() {
    let v2008 = ServerVersion {
        major: 10,
        full: "10".into(),
    };
    let v2012 = ServerVersion {
        major: 11,
        full: "11".into(),
    };
    let v2017 = ServerVersion {
        major: 14,
        full: "14".into(),
    };
    assert!(!v2008.supports_offset_fetch());
    assert!(v2012.supports_offset_fetch());
    assert!(v2017.supports_offset_fetch());
}

#[test]
fn supports_string_agg_gates_on_2017() {
    let v2016 = ServerVersion {
        major: 13,
        full: "13".into(),
    };
    let v2017 = ServerVersion {
        major: 14,
        full: "14".into(),
    };
    let v2022 = ServerVersion {
        major: 16,
        full: "16".into(),
    };
    assert!(!v2016.supports_string_agg());
    assert!(v2017.supports_string_agg());
    assert!(v2022.supports_string_agg());
}

#[test]
fn supports_drop_if_exists_gates_on_2016() {
    let v2014 = ServerVersion {
        major: 12,
        full: "12".into(),
    };
    let v2016 = ServerVersion {
        major: 13,
        full: "13".into(),
    };
    assert!(!v2014.supports_drop_if_exists());
    assert!(v2016.supports_drop_if_exists());
}

#[test]
fn label_maps_known_majors() {
    let cases: &[(u8, &str)] = &[
        (10, "SQL Server 2008"),
        (11, "SQL Server 2012"),
        (12, "SQL Server 2014"),
        (13, "SQL Server 2016"),
        (14, "SQL Server 2017"),
        (15, "SQL Server 2019"),
        (16, "SQL Server 2022"),
    ];
    for (major, expected) in cases {
        let v = ServerVersion {
            major: *major,
            full: "x".into(),
        };
        assert_eq!(v.label(), *expected, "major={}", major);
    }
}

#[test]
fn label_falls_back_for_unknown_major() {
    let v = ServerVersion {
        major: 99,
        full: "99".into(),
    };
    assert_eq!(v.label(), "SQL Server (major=99)");
}

#[test]
fn default_major_is_2017() {
    // Anchor the Beekeeper-parity choice so a future change is intentional.
    assert_eq!(DEFAULT_MAJOR, 14);
    let v = ServerVersion {
        major: DEFAULT_MAJOR,
        full: "fallback".into(),
    };
    assert_eq!(v.label(), "SQL Server 2017");
}
