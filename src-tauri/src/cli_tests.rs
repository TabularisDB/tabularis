use super::*;
use log::LevelFilter;

#[test]
fn debug_flag_raises_the_log_level_to_debug() {
    let args = Args::try_parse_from(["tabularis", "--debug"]).unwrap();
    assert_eq!(args.log_level(), LevelFilter::Debug);
}

#[test]
fn log_level_stays_info_without_the_debug_flag() {
    let args = Args::try_parse_from(["tabularis"]).unwrap();
    assert_eq!(args.log_level(), LevelFilter::Info);
}
