use tabularis_lib::plugins::registry::platform_key_for;

#[test]
fn maps_every_supported_os_architecture_pair() {
    assert_eq!(platform_key_for("linux", "x86_64"), "linux-x64");
    assert_eq!(platform_key_for("linux", "aarch64"), "linux-arm64");
    assert_eq!(platform_key_for("macos", "x86_64"), "darwin-x64");
    assert_eq!(platform_key_for("macos", "aarch64"), "darwin-arm64");
    assert_eq!(platform_key_for("windows", "x86_64"), "win-x64");
    assert_eq!(platform_key_for("windows", "aarch64"), "win-arm64");
}

#[test]
fn leaves_unknown_pairs_available_for_diagnostics() {
    assert_eq!(platform_key_for("freebsd", "x86_64"), "freebsd-x86_64");
}
