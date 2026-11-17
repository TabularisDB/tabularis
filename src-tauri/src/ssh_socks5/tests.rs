use super::*;
use tokio::io::duplex;

/// Runs the server side against `client_bytes` and returns the parse result
/// plus every byte the server wrote back.
async fn handshake(client_bytes: &[u8]) -> (Result<(String, u16), String>, Vec<u8>) {
    let (mut client, mut server) = duplex(1024);
    client.write_all(client_bytes).await.unwrap();
    client.shutdown().await.unwrap();
    let result = read_connect_request(&mut server, &credentials())
        .await
        .map_err(|e| e.to_string());
    drop(server);
    let mut written = Vec::new();
    client.read_to_end(&mut written).await.unwrap();
    (result, written)
}

fn credentials() -> Credentials {
    Credentials {
        username: "user".to_string(),
        password: "secret".to_string(),
    }
}

fn auth(username: &[u8], password: &[u8]) -> Vec<u8> {
    let mut bytes = vec![1, username.len() as u8];
    bytes.extend(username);
    bytes.push(password.len() as u8);
    bytes.extend(password);
    bytes
}

/// Offers username/password and sends the right credentials.
fn greeting() -> Vec<u8> {
    let mut bytes = vec![5, 1, 2];
    bytes.extend(auth(b"user", b"secret"));
    bytes
}

/// Method selection plus a successful authentication reply.
const ACCEPTED: [u8; 4] = [5, 2, 1, 0];

#[tokio::test]
async fn domain_name_is_returned_unresolved() {
    let host = b"pl-0-westeurope-azure.example.mongodb.net";
    let mut bytes = greeting();
    bytes.extend([5, 1, 0, 3, host.len() as u8]);
    bytes.extend(host);
    bytes.extend(1462u16.to_be_bytes());

    let (result, written) = handshake(&bytes).await;

    assert_eq!(
        result.unwrap(),
        (
            "pl-0-westeurope-azure.example.mongodb.net".to_string(),
            1462
        )
    );
    assert_eq!(written, ACCEPTED);
}

#[tokio::test]
async fn ipv4_destination() {
    let mut bytes = greeting();
    bytes.extend([5, 1, 0, 1, 10, 0, 0, 7]);
    bytes.extend(27017u16.to_be_bytes());

    let (result, _) = handshake(&bytes).await;

    assert_eq!(result.unwrap(), ("10.0.0.7".to_string(), 27017));
}

#[tokio::test]
async fn ipv6_destination() {
    let mut bytes = greeting();
    bytes.extend([5, 1, 0, 4]);
    bytes.extend(std::net::Ipv6Addr::LOCALHOST.octets());
    bytes.extend(5432u16.to_be_bytes());

    let (result, _) = handshake(&bytes).await;

    assert_eq!(result.unwrap(), ("::1".to_string(), 5432));
}

#[tokio::test]
async fn username_password_is_picked_among_several_methods() {
    let mut bytes = vec![5, 2, 0, 2];
    bytes.extend(auth(b"user", b"secret"));
    bytes.extend([5, 1, 0, 1, 127, 0, 0, 1, 0, 80]);

    let (result, written) = handshake(&bytes).await;

    assert!(result.is_ok());
    assert_eq!(written, ACCEPTED);
}

#[tokio::test]
async fn rejects_clients_that_offer_no_authentication_only() {
    let (result, written) = handshake(&[5, 1, 0, 5, 1, 0, 1, 127, 0, 0, 1, 0, 80]).await;

    assert!(result.unwrap_err().contains("username/password"));
    assert_eq!(written, [5, 0xFF]);
}

#[tokio::test]
async fn rejects_a_wrong_password() {
    let mut bytes = vec![5, 1, 2];
    bytes.extend(auth(b"user", b"secreT"));
    bytes.extend([5, 1, 0, 1, 127, 0, 0, 1, 0, 80]);

    let (result, written) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("invalid credentials"));
    assert_eq!(written, [5, 2, 1, 1]);
}

#[tokio::test]
async fn rejects_a_wrong_username() {
    let mut bytes = vec![5, 1, 2];
    bytes.extend(auth(b"other", b"secret"));

    let (result, written) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("invalid credentials"));
    assert_eq!(written, [5, 2, 1, 1]);
}

#[tokio::test]
async fn rejects_an_empty_password() {
    let mut bytes = vec![5, 1, 2];
    bytes.extend(auth(b"user", b""));

    let (result, written) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("invalid credentials"));
    assert_eq!(written, [5, 2, 1, 1]);
}

#[tokio::test]
async fn rejects_an_unknown_authentication_version() {
    let (result, written) = handshake(&[5, 1, 2, 9, 4, b'u', b's', b'e', b'r']).await;

    assert!(result
        .unwrap_err()
        .contains("unsupported authentication version 9"));
    assert_eq!(written, [5, 2]);
}

#[test]
fn generated_credentials_are_unique_and_redacted_in_debug() {
    let a = Credentials::generate();
    let b = Credentials::generate();

    assert_ne!(a.username, b.username);
    assert_ne!(a.password, b.password);
    assert_eq!(a.password.len(), 32);
    let debug = format!("{a:?}");
    assert!(!debug.contains(&a.password));
    assert!(debug.contains("<redacted>"));
}

#[tokio::test]
async fn rejects_socks4() {
    let (result, written) = handshake(&[4, 1, 0, 80, 127, 0, 0, 1, 0]).await;

    assert!(result.unwrap_err().contains("unsupported version 4"));
    assert!(written.is_empty());
}

#[tokio::test]
async fn bind_command_gets_command_not_supported() {
    let mut bytes = greeting();
    bytes.extend([5, 2, 0, 1, 127, 0, 0, 1, 0, 80]);

    let (result, written) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("unsupported command 2"));
    assert_eq!(written[..4], ACCEPTED);
    assert_eq!(written[4..6], [5, Reply::CommandNotSupported as u8]);
}

#[tokio::test]
async fn unknown_address_type_gets_address_type_not_supported() {
    let mut bytes = greeting();
    bytes.extend([5, 1, 0, 9]);

    let (result, written) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("address type 9"));
    assert_eq!(written[4..6], [5, Reply::AddressTypeNotSupported as u8]);
}

#[tokio::test]
async fn empty_domain_is_rejected() {
    let mut bytes = greeting();
    bytes.extend([5, 1, 0, 3, 0, 0, 80]);

    let (result, written) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("empty destination"));
    assert_eq!(written[4..6], [5, Reply::GeneralFailure as u8]);
}

#[tokio::test]
async fn truncated_request_is_an_io_error() {
    let mut bytes = greeting();
    bytes.extend([5, 1, 0, 3, 20, b'a']);

    let (result, _) = handshake(&bytes).await;

    assert!(result.unwrap_err().contains("I/O error"));
}

#[tokio::test]
async fn reply_layout() {
    let (mut client, mut server) = duplex(64);
    send_reply(&mut server, Reply::Succeeded).await.unwrap();
    drop(server);
    let mut written = Vec::new();
    client.read_to_end(&mut written).await.unwrap();

    assert_eq!(written, [5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
}
