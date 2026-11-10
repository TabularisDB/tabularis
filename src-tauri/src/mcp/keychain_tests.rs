//! Keychain reads while MCP resolves a connection: a missing entry stays
//! silent, a failure of a secret the connection needs is reported (#1144).

use super::keychain::{keychain_read_error, read_stored_secret, StoredSecret};

const OWNER: &str = "connection \"prod\"";
/// What the macOS keychain returned when Cursor started the MCP server.
const KEYCHAIN_FAILURE: &str = "Platform secure storage failure: UNIX[No such file or directory]";

#[test]
fn a_stored_secret_is_returned() {
    for required in [true, false] {
        let read = read_stored_secret(
            Ok(Some("s3cret".to_string())),
            StoredSecret::Password,
            OWNER,
            required,
        );
        assert_eq!(read.unwrap(), Some("s3cret".to_string()));
    }
}

#[test]
fn a_missing_entry_leaves_the_secret_unset() {
    for required in [true, false] {
        let read = read_stored_secret(Ok(None), StoredSecret::Password, OWNER, required);
        assert_eq!(read.unwrap(), None);
    }
}

#[test]
fn a_failed_read_of_a_required_secret_is_reported() {
    let err = read_stored_secret(
        Err(KEYCHAIN_FAILURE.to_string()),
        StoredSecret::Password,
        OWNER,
        true,
    )
    .unwrap_err();

    assert_eq!(err.code, -32000);
    assert!(err.message.starts_with(
        "Could not read the password of connection \"prod\" from the OS keychain: \
Platform secure storage failure: UNIX[No such file or directory]. "
    ));
    assert!(err.message.contains(
        "Turning off \"Save passwords in Keychain\" for connection \"prod\" avoids the lookup."
    ));
    assert!(!err.message.contains("invalid configuration"));
}

#[test]
fn a_failed_read_of_an_optional_secret_is_skipped() {
    let read = read_stored_secret(
        Err(KEYCHAIN_FAILURE.to_string()),
        StoredSecret::SshKeyPassphrase,
        "SSH connection \"bastion\"",
        false,
    );
    assert_eq!(read.unwrap(), None);
}

#[test]
fn the_error_names_the_secret_and_its_owner() {
    let cases = [
        (
            StoredSecret::Password,
            "the password of connection \"prod\"",
        ),
        (
            StoredSecret::ConnectionUri,
            "the connection URI of connection \"prod\"",
        ),
        (
            StoredSecret::SshPassword,
            "the SSH password of connection \"prod\"",
        ),
        (
            StoredSecret::SshKeyPassphrase,
            "the SSH key passphrase of connection \"prod\"",
        ),
    ];
    for (secret, named) in cases {
        let err = keychain_read_error(secret, OWNER, KEYCHAIN_FAILURE);
        assert!(
            err.message
                .starts_with(&format!("Could not read {named} from the OS keychain: ")),
            "{}",
            err.message
        );
        assert!(err.message.contains(KEYCHAIN_FAILURE));
    }
}

#[test]
fn a_connection_uri_error_does_not_suggest_turning_off_the_keychain() {
    // Connection URIs can only be saved in the keychain.
    let err = keychain_read_error(StoredSecret::ConnectionUri, OWNER, KEYCHAIN_FAILURE);
    assert!(!err.message.contains("Save passwords in Keychain"));
}

#[test]
fn a_keychain_message_ending_in_a_period_is_not_doubled() {
    let err = keychain_read_error(StoredSecret::Password, OWNER, "Access denied.");
    assert!(err
        .message
        .contains("from the OS keychain: Access denied. The desktop"));
    assert!(!err.message.contains(".."));
}
