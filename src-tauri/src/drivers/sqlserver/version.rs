//! SQL Server version detection and feature gating.
//!
//! The release-year-to-major-version mapping is stable:
//!
//! | Release year | Product name         | Major version |
//! |--------------|----------------------|---------------|
//! | 2008         | SQL Server 2008      | 10            |
//! | 2008 R2      | SQL Server 2008 R2   | 10 (10.50)    |
//! | 2012         | SQL Server 2012      | 11            |
//! | 2014         | SQL Server 2014      | 12            |
//! | 2016         | SQL Server 2016      | 13            |
//! | 2017         | SQL Server 2017      | 14            |
//! | 2019         | SQL Server 2019      | 15            |
//! | 2022         | SQL Server 2022      | 16            |
//!
//! When detection fails at runtime the default must be conservative: we fall
//! back to **2017** (major = 14), the same default Beekeeper Studio picks, so
//! that most modern features light up without assuming 2022+.

/// Default fallback when `SERVERPROPERTY('ProductMajorVersion')` can't be
/// parsed — SQL Server 2017. Matches Beekeeper Studio's behaviour.
pub const DEFAULT_MAJOR: u8 = 14;

/// A parsed SQL Server version. `major` is the only field feature-gating keys
/// off in Phase 1; `full` keeps the raw string for diagnostics and UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerVersion {
    pub major: u8,
    pub full: String,
}

impl ServerVersion {
    /// SQL Server 2012 (major 11) introduced `OFFSET N ROWS FETCH NEXT M ROWS ONLY`.
    /// Older versions need the `ROW_NUMBER() OVER (ORDER BY ...)` CTE pattern.
    pub fn supports_offset_fetch(&self) -> bool {
        self.major >= 11
    }

    /// SQL Server 2017 (major 14) introduced `STRING_AGG(...) WITHIN GROUP (ORDER BY ...)`
    /// for aggregating composite FK columns in a single row. Older versions
    /// need the `FOR XML PATH('')` workaround.
    pub fn supports_string_agg(&self) -> bool {
        self.major >= 14
    }

    /// SQL Server 2016 (major 13) introduced `DROP TABLE IF EXISTS`, drop
    /// column IF EXISTS, etc. Useful for DDL emission in Phase 3.
    pub fn supports_drop_if_exists(&self) -> bool {
        self.major >= 13
    }

    /// Human-readable label used in logs and the connection panel.
    pub fn label(&self) -> String {
        match self.major {
            10 => "SQL Server 2008".into(),
            11 => "SQL Server 2012".into(),
            12 => "SQL Server 2014".into(),
            13 => "SQL Server 2016".into(),
            14 => "SQL Server 2017".into(),
            15 => "SQL Server 2019".into(),
            16 => "SQL Server 2022".into(),
            other => format!("SQL Server (major={})", other),
        }
    }
}

/// Parse the output of `SELECT SERVERPROPERTY('ProductMajorVersion')`. The
/// value can arrive as an integer string (`"14"`), the full product version
/// (`"14.0.3465.1"`), or — on unsupported instances — an empty/NULL-ish string
/// that we log and fall back to [`DEFAULT_MAJOR`].
///
/// The parser accepts:
/// - a bare integer: `"11"`, `"14"`, `"16"`
/// - dotted version: `"11.0"`, `"14.0.3465.1"`
/// - @@VERSION fallback with a `"SQL Server 2017"` fragment — see
///   [`parse_version_banner`] for that path.
pub fn parse_major_version(raw: &str) -> u8 {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_MAJOR;
    }
    let first_segment = trimmed.split('.').next().unwrap_or("").trim();
    first_segment.parse::<u8>().unwrap_or(DEFAULT_MAJOR)
}

/// Fallback parser for `@@VERSION` banner text. Accepts any variant that
/// contains the substring `"SQL Server <YEAR>"`. Returns [`DEFAULT_MAJOR`] on
/// failure so the caller never has to branch on `Option`.
///
/// Mirrors Beekeeper's regex `/SQL Server (\d+)/` but as a small state machine
/// because we want a clean-room implementation.
pub fn parse_version_banner(banner: &str) -> u8 {
    const NEEDLE: &str = "SQL Server ";
    let Some(start) = banner.find(NEEDLE) else {
        return DEFAULT_MAJOR;
    };
    let tail = &banner[start + NEEDLE.len()..];
    let year: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
    match year.parse::<u16>().ok() {
        Some(2008) => 10,
        Some(2012) => 11,
        Some(2014) => 12,
        Some(2016) => 13,
        Some(2017) => 14,
        Some(2019) => 15,
        Some(2022) => 16,
        Some(2025) => 17,
        _ => DEFAULT_MAJOR,
    }
}

#[cfg(test)]
mod tests {
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
        let v2008 = ServerVersion { major: 10, full: "10".into() };
        let v2012 = ServerVersion { major: 11, full: "11".into() };
        let v2017 = ServerVersion { major: 14, full: "14".into() };
        assert!(!v2008.supports_offset_fetch());
        assert!(v2012.supports_offset_fetch());
        assert!(v2017.supports_offset_fetch());
    }

    #[test]
    fn supports_string_agg_gates_on_2017() {
        let v2016 = ServerVersion { major: 13, full: "13".into() };
        let v2017 = ServerVersion { major: 14, full: "14".into() };
        let v2022 = ServerVersion { major: 16, full: "16".into() };
        assert!(!v2016.supports_string_agg());
        assert!(v2017.supports_string_agg());
        assert!(v2022.supports_string_agg());
    }

    #[test]
    fn supports_drop_if_exists_gates_on_2016() {
        let v2014 = ServerVersion { major: 12, full: "12".into() };
        let v2016 = ServerVersion { major: 13, full: "13".into() };
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
            let v = ServerVersion { major: *major, full: "x".into() };
            assert_eq!(v.label(), *expected, "major={}", major);
        }
    }

    #[test]
    fn label_falls_back_for_unknown_major() {
        let v = ServerVersion { major: 99, full: "99".into() };
        assert_eq!(v.label(), "SQL Server (major=99)");
    }

    #[test]
    fn default_major_is_2017() {
        // Anchor the Beekeeper-parity choice so a future change is intentional.
        assert_eq!(DEFAULT_MAJOR, 14);
        let v = ServerVersion { major: DEFAULT_MAJOR, full: "fallback".into() };
        assert_eq!(v.label(), "SQL Server 2017");
    }
}
