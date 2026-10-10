use super::*;
use crate::logger::test_env::with_rust_log;
use log::LevelFilter;

#[test]
fn debug_flag_raises_the_log_level_to_debug() {
    let args = Args::try_parse_from(["tabularis", "--debug"]).unwrap();
    assert_eq!(args.log_level(), LevelFilter::Debug);
}

#[test]
fn log_level_stays_info_without_the_debug_flag() {
    // `Args::log_level` consults `RUST_LOG` whenever `--debug` is absent, so this
    // test has to own the variable: clear it under the same shared lock the
    // logger tests use. Without that it races with them, and it fails outright
    // whenever `RUST_LOG` is set in the environment (`RUST_LOG=warn cargo test`
    // reports `left: Warn, right: Info`).
    with_rust_log(None, || {
        let args = Args::try_parse_from(["tabularis"]).unwrap();
        assert_eq!(args.log_level(), LevelFilter::Info);
    });
}
