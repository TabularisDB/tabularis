use crate::path_vars::{expand, expand_with};

const HOME: &str = "/home/matteo";
const WIN_HOME: &str = "C:\\Users\\Matteo";

fn env(name: &str) -> Option<String> {
    match name {
        "HOME" => Some(HOME.to_string()),
        "USERPROFILE" => Some(WIN_HOME.to_string()),
        "SSH_DIR" => Some("/etc/keys".to_string()),
        "EMPTY" => Some(String::new()),
        _ => None,
    }
}

fn expanded(raw: &str) -> String {
    expand_with(raw, env, Some(HOME))
}

#[test]
fn windows_percent_syntax_resolves() {
    assert_eq!(
        expand_with("%USERPROFILE%\\ssh_keys\\id_ed25519.ppk", env, Some(WIN_HOME)),
        "C:\\Users\\Matteo\\ssh_keys\\id_ed25519.ppk"
    );
}

#[test]
fn unix_dollar_syntax_resolves() {
    assert_eq!(expanded("$HOME/.ssh/id_rsa"), "/home/matteo/.ssh/id_rsa");
}

#[test]
fn braced_syntax_resolves() {
    assert_eq!(expanded("${HOME}/.ssh/id_rsa"), "/home/matteo/.ssh/id_rsa");
}

#[test]
fn a_leading_tilde_resolves() {
    assert_eq!(expanded("~/.ssh/id_rsa"), "/home/matteo/.ssh/id_rsa");
    assert_eq!(expanded("~\\.ssh\\id_rsa"), "/home/matteo\\.ssh\\id_rsa");
    assert_eq!(expanded("~"), "/home/matteo");
}

#[test]
fn a_tilde_that_is_not_the_first_segment_is_left_alone() {
    // Another account's home is not something we can resolve, and a file may
    // legitimately start with a tilde.
    assert_eq!(expanded("~other/.ssh/id_rsa"), "~other/.ssh/id_rsa");
    assert_eq!(expanded("/keys/~backup.pem"), "/keys/~backup.pem");
}

#[test]
fn several_variables_in_one_path_resolve() {
    assert_eq!(expanded("$SSH_DIR/${HOME}/key"), "/etc/keys//home/matteo/key");
}

#[test]
fn an_unknown_variable_is_left_verbatim() {
    // Better a visibly unresolved path in the error than a silently wrong one.
    assert_eq!(expanded("%NOPE%\\key"), "%NOPE%\\key");
    assert_eq!(expanded("$NOPE/key"), "$NOPE/key");
    assert_eq!(expanded("${NOPE}/key"), "${NOPE}/key");
}

#[test]
fn a_variable_resolving_to_empty_is_honoured() {
    assert_eq!(expanded("$EMPTY/key"), "/key");
}

#[test]
fn a_path_without_variables_is_untouched() {
    assert_eq!(expanded("/absolute/path/id_rsa"), "/absolute/path/id_rsa");
    assert_eq!(
        expanded("C:\\Users\\Matteo\\key.ppk"),
        "C:\\Users\\Matteo\\key.ppk"
    );
    assert_eq!(expanded(""), "");
}

#[test]
fn stray_markers_are_not_mistaken_for_variables() {
    assert_eq!(expanded("100%/keys"), "100%/keys");
    assert_eq!(expanded("%%"), "%%");
    assert_eq!(expanded("cost$/key"), "cost$/key");
    assert_eq!(expanded("$"), "$");
    assert_eq!(expanded("${unclosed/key"), "${unclosed/key");
}

#[test]
fn a_name_may_not_start_with_a_digit() {
    assert_eq!(expanded("$1HOME/key"), "$1HOME/key");
}

#[test]
fn no_home_leaves_a_tilde_alone() {
    assert_eq!(expand_with("~/.ssh/id_rsa", env, None), "~/.ssh/id_rsa");
}

#[test]
fn both_home_spellings_resolve_on_this_platform() {
    // The point of the aliasing: a profile written on Windows must still
    // resolve on macOS and Linux, and the other way round.
    let from_windows = expand("%USERPROFILE%/keys/id_rsa");
    let from_unix = expand("$HOME/keys/id_rsa");
    assert_eq!(from_windows, from_unix);
    assert!(!from_windows.contains("USERPROFILE"));
}
