use super::*;

#[test]
fn splits_ssh_host_and_port() {
    assert_eq!(
        split_host_port("bastion.example.com:2222"),
        ("bastion.example.com".into(), Some(2222))
    );
    assert_eq!(
        split_host_port("bastion.example.com"),
        ("bastion.example.com".into(), None)
    );
    assert_eq!(
        split_host_port("bastion:notaport"),
        ("bastion:notaport".into(), None)
    );
    assert_eq!(split_host_port("fe80::1"), ("fe80::1".into(), None));
}

#[test]
fn keeps_absolute_key_paths() {
    assert_eq!(
        key_path(r"C:\Users\me\.ssh\id_rsa"),
        r"C:\Users\me\.ssh\id_rsa"
    );
    assert_eq!(key_path("d:/keys/id_rsa"), "d:/keys/id_rsa");
    assert_eq!(key_path(r"\\server\share\id_rsa"), r"\\server\share\id_rsa");
    assert_eq!(key_path("/home/me/.ssh/id_rsa"), "/home/me/.ssh/id_rsa");
    assert_eq!(key_path("~/keys/id_rsa"), "~/keys/id_rsa");
    assert_eq!(key_path("id_rsa"), "~/.ssh/id_rsa");
}

#[test]
fn maps_use_ssl_levels() {
    let mode = |level: &str| {
        let params = HashMap::from([("useSSL".to_string(), level.to_string())]);
        parse_ssl(&params).map(|ssl| ssl.mode)
    };
    assert_eq!(mode("0"), None);
    assert_eq!(mode("1").as_deref(), Some("preferred"));
    assert_eq!(mode("2").as_deref(), Some("required"));
    assert_eq!(mode("3").as_deref(), Some("verify_ca"));
    assert_eq!(mode("4").as_deref(), Some("verify_identity"));
    assert_eq!(mode("9"), None);
    assert_eq!(mode(""), None);
}
