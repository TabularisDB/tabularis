use super::target::target_fingerprint;
use crate::models::ConnectionParams;

fn base() -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".to_string(),
        host: Some("db1.example.com".to_string()),
        port: Some(5432),
        username: Some("app".to_string()),
        password: Some("secret".to_string()),
        ..Default::default()
    }
}

#[test]
fn is_stable_for_the_same_target() {
    assert_eq!(target_fingerprint(&base()), target_fingerprint(&base()));
}

#[test]
fn ignores_password_and_host_case() {
    let mut other = base();
    other.password = None;
    other.host = Some(" DB1.example.com ".to_string());
    assert_eq!(target_fingerprint(&base()), target_fingerprint(&other));
}

#[test]
fn changes_when_the_username_changes() {
    let mut other = base();
    other.username = Some("postgres.staging".to_string());
    assert_ne!(target_fingerprint(&base()), target_fingerprint(&other));
}

#[test]
fn changes_when_the_kubeconfig_path_changes() {
    let mut first = base();
    first.k8s_enabled = Some(true);
    first.k8s_context = Some("kubernetes-admin@kubernetes".to_string());
    first.k8s_kubeconfig_path = Some("/home/me/prod.yaml".to_string());
    let mut second = first.clone();
    second.k8s_kubeconfig_path = Some("/home/me/staging.yaml".to_string());
    assert_ne!(target_fingerprint(&first), target_fingerprint(&second));
}

#[test]
fn changes_when_the_host_or_port_changes() {
    let mut host = base();
    host.host = Some("db2.example.com".to_string());
    let mut port = base();
    port.port = Some(5433);
    assert_ne!(target_fingerprint(&base()), target_fingerprint(&host));
    assert_ne!(target_fingerprint(&base()), target_fingerprint(&port));
}

#[test]
fn changes_when_the_socket_or_driver_changes() {
    let mut socket = base();
    socket.unix_socket_path = Some("/var/run/postgresql".to_string());
    let mut driver = base();
    driver.driver = "mysql".to_string();
    assert_ne!(target_fingerprint(&base()), target_fingerprint(&socket));
    assert_ne!(target_fingerprint(&base()), target_fingerprint(&driver));
}

#[test]
fn changes_when_a_tunnel_points_elsewhere() {
    let mut ssh = base();
    ssh.ssh_enabled = Some(true);
    ssh.ssh_host = Some("bastion-a".to_string());
    ssh.ssh_user = Some("prod".to_string());
    let mut relogin = ssh.clone();
    relogin.ssh_user = Some("staging".to_string());
    assert_ne!(target_fingerprint(&ssh), target_fingerprint(&relogin));
    let mut moved = ssh.clone();
    moved.ssh_host = Some("bastion-b".to_string());
    assert_ne!(target_fingerprint(&base()), target_fingerprint(&ssh));
    assert_ne!(target_fingerprint(&ssh), target_fingerprint(&moved));

    let mut k8s = base();
    k8s.k8s_enabled = Some(true);
    k8s.k8s_namespace = Some("prod".to_string());
    let mut other_namespace = k8s.clone();
    other_namespace.k8s_namespace = Some("staging".to_string());
    assert_ne!(
        target_fingerprint(&k8s),
        target_fingerprint(&other_namespace)
    );
}

#[test]
fn keeps_credentials_in_a_connection_uri_out_of_the_fingerprint() {
    let mut first = base();
    first.connection_uri = Some("postgres://app:one@db1/app?sslmode=require".to_string());
    let mut rotated = base();
    rotated.connection_uri = Some("postgres://app:two@db1/app?sslmode=require".to_string());
    let mut moved = base();
    moved.connection_uri = Some("postgres://app:one@db2/app?sslmode=require".to_string());
    assert_eq!(target_fingerprint(&first), target_fingerprint(&rotated));
    assert_ne!(target_fingerprint(&first), target_fingerprint(&moved));
}
