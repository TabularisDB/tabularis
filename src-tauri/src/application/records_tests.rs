use super::{
    cleanup_session_transfers, consume_download, detect_blob_mime, detect_mime_type,
    parse_upload_reference, read_upload, resolve_upload_value, store_blob_upload, store_download,
};
use base64::Engine;
use uuid::Uuid;

#[test]
fn blob_uploads_are_session_scoped_and_opaque() {
    let temp = tempfile::tempdir().unwrap();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    let reference = store_blob_upload(temp.path(), owner, &bytes).unwrap();
    let (size, mime, token) = parse_upload_reference(&reference).unwrap();

    assert_eq!(size, bytes.len() as u64);
    assert_eq!(mime, "image/png");
    assert_eq!(read_upload(temp.path(), owner, token).unwrap(), bytes);
    assert!(read_upload(temp.path(), other, token).is_err());
    assert!(!reference.contains(temp.path().to_string_lossy().as_ref()));
}

#[test]
fn download_tokens_are_single_use_and_session_scoped() {
    let temp = tempfile::tempdir().unwrap();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let token = store_download(temp.path(), owner, &bytes).unwrap();

    assert!(consume_download(temp.path(), other, &token).is_err());
    let (downloaded, mime) = consume_download(temp.path(), owner, &token).unwrap();
    assert_eq!(downloaded, bytes);
    assert_eq!(mime, "image/png");
    assert!(consume_download(temp.path(), owner, &token).is_err());
}

#[test]
fn session_cleanup_removes_pending_transfers() {
    let temp = tempfile::tempdir().unwrap();
    let session = Uuid::new_v4();
    let reference = store_blob_upload(temp.path(), session, b"pending").unwrap();
    let (_, _, token) = parse_upload_reference(&reference).unwrap();

    cleanup_session_transfers(temp.path(), session);

    assert!(read_upload(temp.path(), session, token).is_err());
}

#[test]
fn mime_detection_is_bounded_and_uses_magic_bytes() {
    let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let encoded = base64::engine::general_purpose::STANDARD.encode(png);

    assert_eq!(detect_mime_type(&encoded).unwrap(), "image/png");
    assert_eq!(
        detect_blob_mime(&encoded).unwrap(),
        format!("BLOB:8:image/png:{encoded}")
    );
    let oversized_header = base64::engine::general_purpose::STANDARD.encode(vec![0; 8193]);
    assert!(detect_mime_type(&oversized_header).is_err());
}

#[test]
fn resolving_an_upload_consumes_its_token_and_cleans_the_temporary_file() {
    let temp = tempfile::tempdir().unwrap();
    let session = Uuid::new_v4();
    let reference = store_blob_upload(temp.path(), session, b"blob").unwrap();
    let (_, _, token) = parse_upload_reference(&reference).unwrap();
    let token = token.to_string();
    let mut value = serde_json::Value::String(reference);

    let upload = resolve_upload_value(temp.path(), Some(session), &mut value, 1024)
        .unwrap()
        .unwrap();
    let consumed_path = value
        .as_str()
        .unwrap()
        .strip_prefix("BLOB_FILE_REF:")
        .unwrap()
        .splitn(3, ':')
        .nth(2)
        .unwrap()
        .to_string();

    assert!(read_upload(temp.path(), session, &token).is_err());
    assert!(std::path::Path::new(&consumed_path).exists());
    drop(upload);
    assert!(!std::path::Path::new(&consumed_path).exists());
}

#[test]
fn browser_values_reject_server_file_references() {
    let temp = tempfile::tempdir().unwrap();
    let mut browser_value = serde_json::json!("BLOB_FILE_REF:4:text/plain:/etc/passwd");
    let mut desktop_value = browser_value.clone();

    let error =
        match resolve_upload_value(temp.path(), Some(Uuid::new_v4()), &mut browser_value, 1024) {
            Err(error) => error,
            Ok(_) => panic!("browser file reference should be rejected"),
        };
    assert!(error.contains("cannot contain server file paths"));
    assert!(
        resolve_upload_value(temp.path(), None, &mut desktop_value, 1024)
            .unwrap()
            .is_none()
    );
}

#[test]
fn transfer_tokens_reject_paths_and_non_v4_identifiers() {
    let temp = tempfile::tempdir().unwrap();
    let session = Uuid::new_v4();

    assert!(read_upload(temp.path(), session, "../../config.json").is_err());
    assert!(read_upload(temp.path(), session, &Uuid::nil().to_string()).is_err());
}
