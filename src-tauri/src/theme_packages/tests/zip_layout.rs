use super::super::{validate_theme_archive, zip_layout::preflight_zip};
use super::archive::valid_package;

#[test]
fn deterministic_header_bit_mutations_do_not_panic() {
    let original = valid_package();
    for position in 0..original.len() {
        for mask in [1, 128] {
            let mut bytes = original.clone();
            bytes[position] ^= mask;
            let result = std::panic::catch_unwind(|| {
                validate_theme_archive(&bytes, "fixture-theme", "1.0.0", "0.99.0", &|| Ok(()))
            });
            assert!(
                result.is_ok(),
                "panic at byte {} with mask {}",
                position,
                mask
            );
        }
    }
}

#[test]
fn entry_count_is_bounded_before_zip_metadata_allocation() {
    let mut bytes = valid_package();
    let end = bytes.len() - 22;
    bytes[end + 8..end + 12].copy_from_slice(&[255, 255, 255, 255]);
    assert!(preflight_zip(&bytes, 128)
        .unwrap_err()
        .contains("entry limit"));
}

#[test]
fn zip64_locators_cannot_hide_inside_a_central_comment() {
    let mut bytes = valid_package();
    let headers: Vec<_> = bytes
        .windows(4)
        .enumerate()
        .filter(|(_, magic)| *magic == b"PK\x01\x02")
        .map(|(index, _)| index)
        .collect();
    let last = *headers.last().unwrap();
    let old_end = bytes.len() - 22;
    let old_size = u32::from_le_bytes(bytes[old_end + 12..old_end + 16].try_into().unwrap());
    bytes[last + 32..last + 34].copy_from_slice(&20u16.to_le_bytes());
    let mut locator = [0u8; 20];
    locator[..4].copy_from_slice(b"PK\x06\x07");
    bytes.splice(old_end..old_end, locator);
    bytes[old_end + 20 + 12..old_end + 20 + 16].copy_from_slice(&(old_size + 20).to_le_bytes());
    assert!(preflight_zip(&bytes, 128)
        .unwrap_err()
        .contains("ZIP64 locator"));
}

#[test]
fn rejects_mismatched_local_names_and_hidden_file_prefixes() {
    let mut bytes = valid_package();
    bytes[30] = b'x';
    assert!(preflight_zip(&bytes, 128)
        .unwrap_err()
        .contains("filenames"));
    let mut prefixed = b"#!/bin/sh\n".to_vec();
    prefixed.extend_from_slice(&valid_package());
    assert!(preflight_zip(&prefixed, 128).is_err());
}
