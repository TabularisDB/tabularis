use super::super::{validate_theme_archive, ValidatedThemePackage};
use serde_json::{json, Value};
use std::cell::Cell;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;

pub(super) fn manifest() -> Value {
    json!({"name":"fixture-theme","version":"1.0.0","kind":"theme","min_runtime_version":"0.99.0",
        "theme_schema_version":1,"theme_variants":[{"id":"dark","name":"Dark","file":"themes/dark.json"}]})
}

pub(super) fn definition() -> Vec<u8> {
    br##"{"schemaVersion":1,"mode":"dark","colors":{"bg":{"base":"#112233"}}}"##.to_vec()
}

pub(super) fn package(files: Vec<(String, Vec<u8>)>, deflated: bool) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let method = if deflated {
        zip::CompressionMethod::Deflated
    } else {
        zip::CompressionMethod::Stored
    };
    let options = SimpleFileOptions::default()
        .compression_method(method)
        .unix_permissions(0o644);
    for (name, content) in files {
        writer.start_file(name, options).unwrap();
        writer.write_all(&content).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

pub(super) fn valid_package() -> Vec<u8> {
    package(
        vec![
            (
                ".tabularium".into(),
                serde_json::to_vec(&manifest()).unwrap(),
            ),
            ("themes/dark.json".into(), definition()),
        ],
        false,
    )
}

fn validate(bytes: &[u8]) -> Result<ValidatedThemePackage, String> {
    validate_theme_archive(bytes, "fixture-theme", "1.0.0", "0.99.0", &|| Ok(()))
}

fn assert_error_contains(bytes: &[u8], text: &str) {
    let error = match validate(bytes) {
        Ok(_) => panic!("Unexpected valid archive"),
        Err(error) => error,
    };
    assert!(error.contains(text), "{}", error);
}

#[test]
fn accepts_universal_stored_and_deflated_packages() {
    for deflated in [false, true] {
        let bytes = package(
            vec![
                (
                    ".tabularium".into(),
                    serde_json::to_vec(&manifest()).unwrap(),
                ),
                ("themes/dark.json".into(), definition()),
                ("LICENSE".into(), b"Fixture only".to_vec()),
            ],
            deflated,
        );
        let validated = validate(&bytes).unwrap();
        assert_eq!(validated.manifest()["name"], "fixture-theme");
        assert_eq!(validated.definitions()["themes/dark.json"]["mode"], "dark");
    }
}

#[test]
fn identity_version_kind_and_runtime_are_verified_before_install() {
    let bytes = valid_package();
    assert!(validate_theme_archive(&bytes, "other-theme", "1.0.0", "0.99.0", &|| Ok(())).is_err());
    assert!(
        validate_theme_archive(&bytes, "fixture-theme", "2.0.0", "0.99.0", &|| Ok(())).is_err()
    );
    assert!(
        validate_theme_archive(&bytes, "fixture-theme", "1.0.0", "0.24.0", &|| Ok(())).is_err()
    );
    for kind in [json!("driver"), Value::Null] {
        let mut value = manifest();
        value["kind"] = kind;
        let bytes = package(
            vec![
                (".tabularium".into(), serde_json::to_vec(&value).unwrap()),
                ("themes/dark.json".into(), definition()),
            ],
            false,
        );
        assert!(validate(&bytes).is_err());
    }
}

#[test]
fn invalid_missing_and_unreferenced_definitions_are_rejected() {
    let root = (
        ".tabularium".to_string(),
        serde_json::to_vec(&manifest()).unwrap(),
    );
    assert!(validate(&package(vec![root.clone()], false)).is_err());
    assert!(validate(&package(
        vec![
            root.clone(),
            (
                "themes/dark.json".into(),
                br#"{"schemaVersion":99,"mode":"dark"}"#.to_vec()
            )
        ],
        false
    ))
    .is_err());
    assert!(validate(&package(
        vec![
            root,
            ("themes/dark.json".into(), definition()),
            ("themes/unused.json".into(), definition())
        ],
        false
    ))
    .is_err());
}

#[test]
fn rejects_unsafe_and_unexpected_payload_paths() {
    for name in [
        "../escape.json",
        "/absolute.json",
        "C:/theme.json",
        "themes\\dark.json",
        "themes/CON.json",
        "themes/x./dark.json",
        "themes/a:stream",
        "themes/%2e%2e/dark.json",
        "run.sh",
        "index.js",
        "driver.exe",
        "ui/bundle.js",
    ] {
        let bytes = package(
            vec![
                (
                    ".tabularium".into(),
                    serde_json::to_vec(&manifest()).unwrap(),
                ),
                ("themes/dark.json".into(), definition()),
                (name.into(), b"payload".to_vec()),
            ],
            false,
        );
        assert!(validate(&bytes).is_err(), "{}", name);
    }
}

#[test]
fn rejects_executable_modes_and_symlinks() {
    for symlink in [false, true] {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let plain = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        writer.start_file(".tabularium", plain).unwrap();
        writer
            .write_all(&serde_json::to_vec(&manifest()).unwrap())
            .unwrap();
        if symlink {
            writer
                .add_symlink("themes/dark.json", "../../outside", plain)
                .unwrap();
        } else {
            writer
                .start_file("themes/dark.json", plain.unix_permissions(0o755))
                .unwrap();
            writer.write_all(&definition()).unwrap();
        }
        assert!(validate(&writer.finish().unwrap().into_inner()).is_err());
    }
}

#[test]
fn detects_duplicate_central_entries_hidden_by_zip_library_coalescing() {
    let mut bytes = package(
        vec![
            (
                ".tabularium".into(),
                serde_json::to_vec(&manifest()).unwrap(),
            ),
            ("themes/dark.json".into(), definition()),
            ("themes/xark.json".into(), definition()),
        ],
        false,
    );
    let headers: Vec<_> = bytes
        .windows(4)
        .enumerate()
        .filter(|(_, magic)| *magic == b"PK\x01\x02")
        .map(|(index, _)| index)
        .collect();
    for header in headers {
        let name_length =
            u16::from_le_bytes(bytes[header + 28..header + 30].try_into().unwrap()) as usize;
        if &bytes[header + 46..header + 46 + name_length] == b"themes/xark.json" {
            let local =
                u32::from_le_bytes(bytes[header + 42..header + 46].try_into().unwrap()) as usize;
            bytes[header + 46..header + 46 + name_length].copy_from_slice(b"themes/dark.json");
            bytes[local + 30..local + 30 + name_length].copy_from_slice(b"themes/dark.json");
        }
    }
    assert_eq!(zip::ZipArchive::new(Cursor::new(&bytes)).unwrap().len(), 2);
    assert_error_contains(&bytes, "Duplicate");
}

#[test]
fn rejects_case_colliding_implicit_parent_directories() {
    let mut value = manifest();
    value["theme_variants"] = json!([
        {"id":"dark","name":"Dark","file":"themes/Sub/dark.json"},
        {"id":"light","name":"Light","file":"themes/sub/light.json"}
    ]);
    let bytes = package(
        vec![
            (".tabularium".into(), serde_json::to_vec(&value).unwrap()),
            ("themes/Sub/dark.json".into(), definition()),
            ("themes/sub/light.json".into(), definition()),
        ],
        false,
    );
    assert_error_contains(&bytes, "colliding");
}

#[test]
fn enforces_download_entry_file_and_expansion_ratio_limits() {
    assert_error_contains(&vec![0; 8 * 1024 * 1024 + 1], "download byte");
    let files = (0..129)
        .map(|index| (format!("themes/file{}.json", index), vec![]))
        .collect();
    assert_error_contains(&package(files, false), "entry limit");
    assert_error_contains(
        &package(vec![("themes/dark.json".into(), vec![b' '; 262145])], false),
        "entry exceeds",
    );
    assert_error_contains(
        &package(vec![("themes/dark.json".into(), vec![b' '; 262144])], true),
        "ratio",
    );
}

#[test]
fn enforces_total_expanded_size_independently_of_compressed_size() {
    let mut state = 7u32;
    let block: Vec<_> = (0..8192)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (state >> 24) as u8
        })
        .collect();
    let files = (0..65)
        .map(|index| (format!("themes/file{}.json", index), block.repeat(32)))
        .collect();
    let bytes = package(files, true);
    assert!(bytes.len() < 8 * 1024 * 1024);
    assert_error_contains(&bytes, "expanded byte");
}

#[test]
fn cancellation_interrupts_validation_without_filesystem_side_effects() {
    let calls = Cell::new(0);
    let result = validate_theme_archive(
        &valid_package(),
        "fixture-theme",
        "1.0.0",
        "0.99.0",
        &|| {
            calls.set(calls.get() + 1);
            if calls.get() > 3 {
                Err("PLUGIN_INSTALL_CANCELLED".into())
            } else {
                Ok(())
            }
        },
    );
    assert!(matches!(result, Err(error) if error == "PLUGIN_INSTALL_CANCELLED"));
}

#[test]
fn malformed_metadata_and_crc_errors_fail_closed_without_panics() {
    let valid = valid_package();
    for length in [0, 4, 21, valid.len() - 1] {
        assert!(validate(&valid[..length]).is_err());
    }
    let mut bytes = valid.clone();
    bytes.extend_from_slice(b"trailing payload");
    assert!(validate(&bytes).is_err());
    let mut bytes = valid;
    let offset = zip::ZipArchive::new(Cursor::new(&bytes))
        .unwrap()
        .by_name("themes/dark.json")
        .unwrap()
        .data_start() as usize;
    bytes[offset] ^= 1;
    assert!(validate(&bytes).is_err());
}
