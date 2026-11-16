use crate::keychain_utils::{
    describe_error, optional_secret, stored_password_change, StoredPasswordChange,
    SNAP_KEYCHAIN_HINT,
};
use crate::sandbox::Sandbox;

fn platform_failure() -> keyring::Error {
    keyring::Error::PlatformFailure(Box::new(std::io::Error::other(
        "DBus error: An AppArmor policy prevents this sender from sending this message",
    )))
}

#[test]
fn platform_failure_inside_snap_gets_connect_hint() {
    let message = describe_error(&platform_failure(), Some(Sandbox::Snap));

    assert!(message.starts_with("Platform secure storage failure: DBus error"));
    assert!(message.ends_with(SNAP_KEYCHAIN_HINT));
    assert!(message.contains("snap connect tabularis:password-manager-service"));
}

#[test]
fn platform_failure_outside_snap_keeps_original_message() {
    let err = platform_failure();
    let expected = err.to_string();

    assert_eq!(describe_error(&err, None), expected);
    assert_eq!(describe_error(&err, Some(Sandbox::Flatpak)), expected);
}

#[test]
fn non_platform_errors_never_get_the_hint() {
    let errors = [
        keyring::Error::NoEntry,
        keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("locked"))),
        keyring::Error::Invalid("target".into(), "reason".into()),
    ];

    for err in errors {
        let message = describe_error(&err, Some(Sandbox::Snap));
        assert_eq!(message, err.to_string());
        assert!(!message.contains(SNAP_KEYCHAIN_HINT));
    }
}

#[test]
fn omitted_password_keeps_the_stored_secret() {
    assert_eq!(stored_password_change(None), StoredPasswordChange::Keep);
}

#[test]
fn explicit_empty_password_deletes_the_stored_secret() {
    assert_eq!(
        stored_password_change(Some("")),
        StoredPasswordChange::Delete
    );
}

#[test]
fn non_empty_password_is_stored_verbatim() {
    assert_eq!(
        stored_password_change(Some("s3cret")),
        StoredPasswordChange::Store("s3cret")
    );
    // Whitespace is a legitimate secret, only the empty string means "none".
    assert_eq!(
        stored_password_change(Some(" ")),
        StoredPasswordChange::Store(" ")
    );
}

#[test]
fn optional_secret_returns_a_stored_value() {
    assert_eq!(
        optional_secret(Ok("s3cret".to_string())),
        Ok(Some("s3cret".to_string()))
    );
}

#[test]
fn optional_secret_maps_a_missing_entry_to_none() {
    assert_eq!(optional_secret(Err(keyring::Error::NoEntry)), Ok(None));
}

#[test]
fn optional_secret_reports_genuine_keychain_failures() {
    // What macOS returned when an MCP client started Tabularis (#1144).
    let unreachable = || {
        keyring::Error::PlatformFailure(Box::new(std::io::Error::other(
            "UNIX[No such file or directory]",
        )))
    };
    assert_eq!(
        optional_secret(Err(unreachable())),
        Err(describe_error(&unreachable(), crate::sandbox::current()))
    );

    let locked = || keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("locked")));
    assert_eq!(
        optional_secret(Err(locked())),
        Err(describe_error(&locked(), crate::sandbox::current()))
    );
}
