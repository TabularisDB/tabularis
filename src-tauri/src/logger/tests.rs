//! Tests for [`super::resolve_log_level_from_env`] and its pure parsing helper.
//!
//! `RUST_LOG` is process-wide, so the env-reading cases run under `ENV_LOCK` to
//! stop Rust's threaded test runner racing on it, and they restore the previous
//! value afterwards.

use super::{level_from_str, parse_rust_log_level, resolve_log_level_from_env};
use log::LevelFilter;
use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Run `body` with `RUST_LOG` set to `value` (or removed when `None`).
fn with_rust_log<T>(value: Option<&str>, body: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let previous = std::env::var("RUST_LOG").ok();
    match value {
        Some(v) => std::env::set_var("RUST_LOG", v),
        None => std::env::remove_var("RUST_LOG"),
    }
    let result = body();
    match previous {
        Some(v) => std::env::set_var("RUST_LOG", v),
        None => std::env::remove_var("RUST_LOG"),
    }
    result
}

#[test]
fn without_debug_and_without_rust_log_the_level_stays_info() {
    // `--debug` is handled by `Args::log_level`; with nothing set the default
    // must not change.
    with_rust_log(None, || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Info);
    });
}

#[test]
fn rust_log_is_honoured_when_no_flag_is_given() {
    for (value, expected) in [
        ("trace", LevelFilter::Trace),
        ("debug", LevelFilter::Debug),
        ("info", LevelFilter::Info),
        ("warn", LevelFilter::Warn),
        ("error", LevelFilter::Error),
        ("off", LevelFilter::Off),
    ] {
        with_rust_log(Some(value), || {
            assert_eq!(
                resolve_log_level_from_env(),
                expected,
                "RUST_LOG={value} should resolve to {expected:?}"
            );
        });
    }
}

#[test]
fn rust_log_levels_are_case_insensitive() {
    for value in ["INFO", "Info", "iNfO"] {
        with_rust_log(Some(value), || {
            assert_eq!(resolve_log_level_from_env(), LevelFilter::Info);
        });
    }
}

#[test]
fn target_scoped_directives_use_the_level_they_name() {
    // `sqlx=debug` should get sqlx's query logging visible, which the `log`
    // crate can only do by raising the whole level.
    with_rust_log(Some("sqlx=debug"), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Debug);
    });
    with_rust_log(Some("sqlx=info"), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Info);
    });
}

#[test]
fn a_directive_list_uses_the_most_verbose_level() {
    with_rust_log(Some("warn,sqlx=debug"), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Debug);
    });
    with_rust_log(Some("error,trace"), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Trace);
    });
}

#[test]
fn blank_directives_are_skipped() {
    with_rust_log(Some("warn,,sqlx=debug,"), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Debug);
    });
}

#[test]
fn an_unparseable_rust_log_falls_back_to_info_instead_of_failing() {
    // A typo must not stop the app from booting.
    with_rust_log(Some("this-is-not-a-level"), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Info);
    });
}

#[test]
fn an_empty_rust_log_falls_back_to_info() {
    with_rust_log(Some(""), || {
        assert_eq!(resolve_log_level_from_env(), LevelFilter::Info);
    });
}

#[test]
fn parse_rust_log_level_handles_nominal_and_edge_inputs() {
    assert_eq!(parse_rust_log_level("debug"), Some(LevelFilter::Debug));
    assert_eq!(parse_rust_log_level("  debug  "), Some(LevelFilter::Debug));
    assert_eq!(parse_rust_log_level("sqlx=info"), Some(LevelFilter::Info));
    assert_eq!(
        parse_rust_log_level("error,trace"),
        Some(LevelFilter::Trace)
    );
    assert_eq!(parse_rust_log_level("warn,off"), Some(LevelFilter::Warn));
    // No directive names a level at all.
    assert_eq!(parse_rust_log_level(""), None);
    assert_eq!(parse_rust_log_level("nonsense"), None);
    assert_eq!(parse_rust_log_level("target=,other=x"), None);
}

#[test]
fn level_from_str_covers_every_documented_level() {
    assert_eq!(level_from_str("off"), Some(LevelFilter::Off));
    assert_eq!(level_from_str("error"), Some(LevelFilter::Error));
    assert_eq!(level_from_str("warn"), Some(LevelFilter::Warn));
    assert_eq!(level_from_str("info"), Some(LevelFilter::Info));
    assert_eq!(level_from_str("debug"), Some(LevelFilter::Debug));
    assert_eq!(level_from_str("trace"), Some(LevelFilter::Trace));
    assert_eq!(level_from_str("DEBUG"), Some(LevelFilter::Debug));
    // Unsupported / malformed inputs.
    assert_eq!(level_from_str("verbose"), None);
    assert_eq!(level_from_str(""), None);
    assert_eq!(level_from_str("1"), None);
}

#[test]
fn cli_log_level_prefers_the_flag_over_the_environment() {
    // Guards the seam: `--debug` wins and `RUST_LOG` is only consulted without
    // it, so the two cannot fight.
    let args = crate::cli::Args {
        mcp: false,
        debug: true,
        explain: None,
    };
    with_rust_log(Some("error"), || {
        assert_eq!(args.log_level(), LevelFilter::Debug);
    });
}

#[test]
fn cli_log_level_falls_back_to_the_environment_without_the_flag() {
    let args = crate::cli::Args {
        mcp: false,
        debug: false,
        explain: None,
    };
    with_rust_log(Some("warn"), || {
        assert_eq!(args.log_level(), LevelFilter::Warn);
    });
    with_rust_log(None, || {
        assert_eq!(args.log_level(), LevelFilter::Info);
    });
}
