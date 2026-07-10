use super::pager::{pager_command_from, should_page};

fn long_text() -> String {
    vec!["line"; 50].join("\n")
}

// --- should_page ----------------------------------------------------------------

#[test]
fn should_page_requires_a_tty() {
    assert!(!should_page(&long_text(), true, false));
}

#[test]
fn should_page_respects_the_enabled_flag() {
    assert!(!should_page(&long_text(), false, true));
}

#[test]
fn should_page_skips_short_output() {
    assert!(!should_page("one\ntwo\nthree", true, true));
}

#[test]
fn should_page_pages_long_output_on_a_tty() {
    assert!(should_page(&long_text(), true, true));
}

// --- pager_command_from ----------------------------------------------------------

#[test]
fn defaults_to_less_with_safe_flags() {
    assert_eq!(
        pager_command_from(None, None),
        Some(vec!["less".to_string(), "-RSFX".to_string()])
    );
}

#[test]
fn pager_env_is_used_and_split_into_arguments() {
    assert_eq!(
        pager_command_from(None, Some("more -d")),
        Some(vec!["more".to_string(), "-d".to_string()])
    );
}

#[test]
fn tabularis_pager_wins_over_pager() {
    assert_eq!(
        pager_command_from(Some("bat --paging=always"), Some("more")),
        Some(vec!["bat".to_string(), "--paging=always".to_string()])
    );
}

#[test]
fn blank_value_disables_paging() {
    assert_eq!(pager_command_from(Some(""), Some("more")), None);
    assert_eq!(pager_command_from(None, Some("   ")), None);
}
