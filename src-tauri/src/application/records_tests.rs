use super::{
    detect_blob_mime, detect_mime_type, parse_upload_reference, resolve_upload_value,
    BLOB_TRANSFER_PURPOSE,
};
use crate::application::file_transfers::FileTransferStore;
use base64::Engine;
use bytes::Bytes;
use std::convert::Infallible;
use uuid::Uuid;

async fn store_blob(data_dir: &std::path::Path, owner: Uuid, bytes: &'static [u8]) -> String {
    let metadata = FileTransferStore::new(data_dir)
        .store_upload(
            owner,
            BLOB_TRANSFER_PURPOSE,
            "blob.bin",
            Some("application/octet-stream"),
            futures::stream::once(
                async move { Ok::<Bytes, Infallible>(Bytes::from_static(bytes)) },
            ),
        )
        .await
        .unwrap();
    format!(
        "BLOB_UPLOAD_REF:{}:{}:{}",
        metadata.size, metadata.mime_type, metadata.token
    )
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

#[tokio::test]
async fn resolving_an_upload_consumes_its_token_and_cleans_the_temporary_file() {
    let temp = tempfile::tempdir().unwrap();
    let session = Uuid::new_v4();
    let reference = store_blob(temp.path(), session, b"blob").await;
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

    assert!(FileTransferStore::new(temp.path())
        .open_upload(session, &token, BLOB_TRANSFER_PURPOSE)
        .await
        .is_err());
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
fn blob_upload_references_reject_paths_and_non_v4_identifiers() {
    assert!(parse_upload_reference("BLOB_UPLOAD_REF:4:text/plain:../../config.json").is_err());
    assert!(
        parse_upload_reference(&format!("BLOB_UPLOAD_REF:4:text/plain:{}", Uuid::nil())).is_err()
    );
}
