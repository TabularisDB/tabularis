use super::*;

#[test]
fn atomic_connection_snapshot_replaces_complete_file_and_is_private() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("connections.json");
    std::fs::write(&path,"previous snapshot").unwrap();
    atomic_private_write(&path,b"complete replacement").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(),b"complete replacement");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(),1);
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,0o600);
    }
}

#[test]
fn failed_replacement_does_not_destroy_existing_target() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("retained"),"data").unwrap();
    assert!(atomic_private_write(&target,b"new").is_err());
    assert_eq!(std::fs::read_to_string(target.join("retained")).unwrap(),"data");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(),1);
}
