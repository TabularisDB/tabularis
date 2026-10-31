use super::*;

#[test]
fn accepts_system_link_protocols_without_selecting_a_browser() {
    for value in [
        "https://console.neon.tech/",
        "http://localhost:3000/",
        "mailto:team@example.com",
        "tel:+123456789",
    ] {
        assert_eq!(validate_url(value).unwrap().as_str(), value);
    }
}

#[test]
fn rejects_script_file_and_application_protocols_without_launching() {
    for value in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hello",
        "tabularis://install/test",
        "not a URL",
    ] {
        assert!(validate_url(value).is_err());
    }
}
