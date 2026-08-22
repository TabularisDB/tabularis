use super::*;
use std::fs;
use tempfile::tempdir;

fn plugin_fixture() -> tempfile::TempDir {
    let root = tempdir().expect("temp dir");
    let plugin = root.path().join("example-plugin");
    fs::create_dir_all(plugin.join("ui/dist")).expect("ui dir");
    fs::create_dir_all(plugin.join("locales")).expect("locales dir");
    fs::write(
        plugin.join(".tabularium"),
        r#"{
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "Fixture",
  "ui_extensions": [{
    "slot": "data-grid.toolbar.actions",
    "module": "./ui/dist/index.js",
    "api_version": "0.1.1"
  }]
}"#,
    )
    .expect("manifest");
    fs::write(plugin.join("ui/dist/index.js"), "window.loaded = true;").expect("bundle");
    fs::write(plugin.join("ui/dist/private.txt"), "private").expect("private file");
    fs::write(plugin.join("locales/en.json"), r#"{"label":"Run"}"#).expect("locale");
    root
}

#[test]
fn reads_only_declared_ui_bundles_and_locales() {
    let root = plugin_fixture();
    let bundle = read_plugin_asset(root.path(), "example-plugin", "ui/dist/index.js")
        .expect("declared bundle");
    assert_eq!(bundle.content_type, "text/javascript; charset=utf-8");
    assert_eq!(bundle.bytes, b"window.loaded = true;");

    let locale =
        read_plugin_asset_text(root.path(), "example-plugin", "locales/en.json").expect("locale");
    assert_eq!(locale, r#"{"label":"Run"}"#);

    assert!(read_plugin_asset(root.path(), "example-plugin", "ui/dist/private.txt").is_err());
}

#[test]
fn rejects_traversal_and_invalid_identifiers() {
    let root = plugin_fixture();
    assert!(read_plugin_asset(root.path(), "../example-plugin", "ui/dist/index.js").is_err());
    assert!(read_plugin_asset(root.path(), "example-plugin", "../.tabularium").is_err());
    assert!(read_plugin_asset(root.path(), "example-plugin", "/etc/passwd").is_err());
    assert!(read_plugin_asset(root.path(), "example-plugin", "locales/nested/en.json").is_err());
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_that_escape_the_plugin_directory() {
    use std::os::unix::fs::symlink;

    let root = plugin_fixture();
    let plugin = root.path().join("example-plugin");
    let outside = root.path().join("outside.js");
    fs::write(&outside, "window.outside = true;").expect("outside file");
    fs::remove_file(plugin.join("ui/dist/index.js")).expect("remove bundle");
    symlink(outside, plugin.join("ui/dist/index.js")).expect("symlink");

    assert!(read_plugin_asset(root.path(), "example-plugin", "ui/dist/index.js").is_err());
}
