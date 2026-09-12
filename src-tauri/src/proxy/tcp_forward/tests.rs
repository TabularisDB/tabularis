use super::*;

#[test]
fn base64_encode_known_vectors() {
    assert_eq!(base64_encode(""), "");
    assert_eq!(base64_encode("f"), "Zg==");
    assert_eq!(base64_encode("fo"), "Zm8=");
    assert_eq!(base64_encode("foo"), "Zm9v");
    assert_eq!(base64_encode("user:p@ss"), "dXNlcjpwQHNz");
}

#[test]
fn find_header_end_locates_crlf_crlf() {
    let buf = b"HTTP/1.1 200 Connection Established\r\n\r\nSSH-2.0";
    let end = find_header_end(buf).expect("header end");
    assert_eq!(&buf[end..end + 4], b"\r\n\r\n");
    assert_eq!(&buf[end + 4..], b"SSH-2.0");
}

#[test]
fn connect_authority_brackets_ipv6() {
    assert_eq!(
        format_connect_authority("2001:db8::1", 22),
        "[2001:db8::1]:22"
    );
    assert_eq!(format_connect_authority("example.com", 443), "example.com:443");
}

#[test]
fn socks5_address_uses_ip_atypes() {
    let mut v4 = Vec::new();
    append_socks5_address(&mut v4, "127.0.0.1").unwrap();
    assert_eq!(v4[0], 0x01);
    assert_eq!(&v4[1..], &[127, 0, 0, 1]);

    let mut v6 = Vec::new();
    append_socks5_address(&mut v6, "::1").unwrap();
    assert_eq!(v6[0], 0x04);
    assert_eq!(v6.len(), 17);

    let mut domain = Vec::new();
    append_socks5_address(&mut domain, "db.example").unwrap();
    assert_eq!(domain[0], 0x03);
    assert_eq!(domain[1], 10);
}

#[test]
fn forward_key_includes_protocol_and_username() {
    let mut proxy = ProxyEndpoint {
        protocol: ProxyProtocol::Http,
        host: "127.0.0.1".into(),
        port: 7890,
        username: Some("alice".into()),
        password: Some("secret".into()),
    };
    let a = build_forward_key(&proxy, "db.example", 5432);
    proxy.protocol = ProxyProtocol::Socks5;
    let b = build_forward_key(&proxy, "db.example", 5432);
    assert_ne!(a, b);
    proxy.protocol = ProxyProtocol::Http;
    proxy.username = Some("bob".into());
    let c = build_forward_key(&proxy, "db.example", 5432);
    assert_ne!(a, c);
}
