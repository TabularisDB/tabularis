use super::{
    remove_expired_transfers, safe_content_type, safe_file_name, FileTransferStore, UploadError,
};
use bytes::Bytes;
use futures::stream;
use std::io;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use uuid::Uuid;

fn bytes_stream(
    chunks: impl IntoIterator<Item = &'static [u8]>,
) -> impl futures::Stream<Item = Result<Bytes, io::Error>> {
    stream::iter(
        chunks
            .into_iter()
            .map(|chunk| Ok(Bytes::from_static(chunk))),
    )
}

#[tokio::test]
async fn uploads_are_streamed_safely_and_bound_to_owner_and_purpose() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::new(temp.path());
    let owner = Uuid::new_v4();
    let metadata = store
        .store_upload(
            owner,
            "connection-import",
            "../../quarterly\nreport.csv",
            Some("text/csv; charset=utf-8"),
            bytes_stream([b"region,".as_slice(), b"total\nwest,42\n".as_slice()]),
        )
        .await
        .unwrap();

    assert_eq!(metadata.file_name, "quarterly_report.csv");
    assert_eq!(metadata.mime_type, "text/csv");
    assert_eq!(metadata.size, 21);
    assert!(!metadata
        .token
        .contains(temp.path().to_string_lossy().as_ref()));
    assert!(store
        .open_upload(Uuid::new_v4(), &metadata.token, "connection-import")
        .await
        .is_err());
    assert!(store
        .open_upload(owner, &metadata.token, "notebook-import")
        .await
        .is_err());

    let mut reader = store
        .open_upload(owner, &metadata.token, "connection-import")
        .await
        .unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).await.unwrap();
    assert_eq!(bytes, b"region,total\nwest,42\n");
}

#[tokio::test]
async fn traversal_and_guessed_tokens_never_select_files() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::new(temp.path());
    let owner = Uuid::new_v4();

    assert!(store
        .open_upload(owner, "../../config.json", "connection-import")
        .await
        .is_err());
    assert!(store
        .open_upload(
            owner,
            "00000000-0000-4000-8000-000000000000",
            "connection-import",
        )
        .await
        .is_err());
    assert_eq!(safe_file_name("C:\\fakepath\\report.sql"), "report.sql");
    assert_eq!(safe_file_name("../.."), "download.bin");
    assert_eq!(
        safe_content_type(Some("text/html\r\nx-unsafe: yes")),
        "application/octet-stream"
    );
}

#[tokio::test]
async fn downloads_are_single_use_and_cleanup_when_streaming_stops() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::new(temp.path());
    let owner = Uuid::new_v4();
    let metadata = store
        .store_download(
            owner,
            "query-export",
            "results.csv",
            Some("text/csv"),
            bytes_stream([b"a,b\n".as_slice(), b"1,2\n".as_slice()]),
        )
        .await
        .unwrap();

    let mut reader = store
        .consume_download(owner, &metadata.token)
        .await
        .unwrap();
    let mut prefix = [0_u8; 2];
    reader.read_exact(&mut prefix).await.unwrap();
    assert_eq!(&prefix, b"a,");
    assert!(store
        .consume_download(owner, &metadata.token)
        .await
        .is_err());
    drop(reader);

    let downloads = store.root.join(owner.to_string()).join("downloads");
    assert_eq!(std::fs::read_dir(downloads).unwrap().count(), 0);
}

#[tokio::test]
async fn interrupted_and_oversized_uploads_leave_no_transfer_token() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::with_limits(temp.path(), 8, Duration::from_secs(60));
    let owner = Uuid::new_v4();
    let interrupted = stream::iter(vec![
        Ok(Bytes::from_static(b"partial")),
        Err(io::Error::new(
            io::ErrorKind::ConnectionReset,
            "disconnected",
        )),
    ]);

    assert!(store
        .store_upload(
            owner,
            "connection-import",
            "partial.sql",
            Some("text/plain"),
            interrupted,
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("interrupted"));
    assert!(matches!(
        store
            .store_upload(
                owner,
                "connection-import",
                "large.sql",
                Some("text/plain"),
                bytes_stream([b"123456789".as_slice()]),
            )
            .await,
        Err(UploadError::TooLarge(message)) if message.contains("8 byte limit")
    ));

    let uploads = store.root.join(owner.to_string()).join("uploads");
    assert_eq!(std::fs::read_dir(uploads).unwrap().count(), 0);
}

#[tokio::test]
async fn session_cleanup_revokes_every_pending_transfer() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::new(temp.path());
    let owner = Uuid::new_v4();
    let upload = store
        .store_upload(
            owner,
            "connection-import",
            "connections.json",
            Some("application/json"),
            bytes_stream([b"{}".as_slice()]),
        )
        .await
        .unwrap();
    let download = store
        .store_download(
            owner,
            "query-export",
            "results.csv",
            Some("text/csv"),
            bytes_stream([b"id\n1\n".as_slice()]),
        )
        .await
        .unwrap();

    store.cleanup_session(owner);

    assert!(store
        .open_upload(owner, &upload.token, "connection-import")
        .await
        .is_err());
    assert!(store
        .consume_download(owner, &download.token)
        .await
        .is_err());
}

#[tokio::test]
async fn expired_tokens_are_removed_before_use() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::with_limits(temp.path(), 1024, Duration::ZERO);
    let owner = Uuid::new_v4();
    let metadata = store
        .store_upload(
            owner,
            "notebook-import",
            "notebook.json",
            Some("application/json"),
            bytes_stream([b"{}".as_slice()]),
        )
        .await
        .unwrap();

    assert!(store
        .open_upload(owner, &metadata.token, "notebook-import")
        .await
        .is_err());
    assert!(!store
        .root
        .join(owner.to_string())
        .join("uploads")
        .join(metadata.token)
        .exists());
}

#[tokio::test]
async fn sweeping_removes_expired_transfers_of_every_session() {
    let temp = tempfile::tempdir().unwrap();
    let expired = FileTransferStore::with_limits(temp.path(), 1024, Duration::ZERO);
    let fresh = FileTransferStore::with_limits(temp.path(), 1024, Duration::from_secs(60));
    let stale_owner = Uuid::new_v4();
    let live_owner = Uuid::new_v4();
    let stale = expired
        .store_upload(
            stale_owner,
            "notebook-import",
            "old.json",
            None,
            bytes_stream([b"{}".as_slice()]),
        )
        .await
        .unwrap();
    let live = fresh
        .store_upload(
            live_owner,
            "notebook-import",
            "new.json",
            None,
            bytes_stream([b"{}".as_slice()]),
        )
        .await
        .unwrap();

    remove_expired_transfers(&fresh.root, Duration::from_secs(60)).unwrap();

    let uploads = |owner: Uuid, token: &str| {
        fresh
            .root
            .join(owner.to_string())
            .join("uploads")
            .join(token)
    };
    assert!(!uploads(stale_owner, &stale.token).exists());
    assert!(uploads(live_owner, &live.token).exists());
}

#[tokio::test]
async fn a_body_cut_off_by_the_router_limit_is_too_large() {
    use http_body_util::{Full, Limited};
    let temp = tempfile::tempdir().unwrap();
    let store = FileTransferStore::with_limits(temp.path(), 1024, Duration::from_secs(60));
    // RequestBodyLimitLayer wraps chunked bodies the same way.
    let body = axum::body::Body::new(Limited::new(
        Full::new(Bytes::from_static(b"0123456789")),
        4,
    ))
    .into_data_stream();
    let error = store
        .store_upload(Uuid::new_v4(), "notebook-import", "big.json", None, body)
        .await
        .unwrap_err();
    assert!(matches!(error, UploadError::TooLarge(_)), "{error}");
}
