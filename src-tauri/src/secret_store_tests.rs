use super::*;

const PASSPHRASE: &str = "correct horse battery staple";

fn credential(store: &Arc<FileSecretStore>, user: &str) -> Box<Credential> {
    FileCredentialBuilder(store.clone())
        .build(None, "tabularis", user)
        .unwrap()
}

#[test]
fn round_trips_secrets_across_reopen_without_storing_plaintext() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("secrets.enc.json");
    let store = Arc::new(FileSecretStore::open(path.clone(), PASSPHRASE).unwrap());

    credential(&store, "conn-1:db").set_password("s3cret-value").unwrap();
    assert_eq!(
        credential(&store, "conn-1:db").get_password().unwrap(),
        "s3cret-value"
    );
    assert!(!fs::read_to_string(&path).unwrap().contains("s3cret-value"));

    let reopened = Arc::new(FileSecretStore::open(path, PASSPHRASE).unwrap());
    assert_eq!(
        credential(&reopened, "conn-1:db").get_password().unwrap(),
        "s3cret-value"
    );
}

#[test]
fn reports_missing_entries_as_no_entry() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(
        FileSecretStore::open(temp.path().join("secrets.enc.json"), PASSPHRASE).unwrap(),
    );
    let missing = credential(&store, "missing");

    assert!(matches!(missing.get_password(), Err(keyring::Error::NoEntry)));
    assert!(matches!(
        missing.delete_credential(),
        Err(keyring::Error::NoEntry)
    ));

    missing.set_password("value").unwrap();
    missing.delete_credential().unwrap();
    assert!(matches!(missing.get_password(), Err(keyring::Error::NoEntry)));
}

#[test]
fn keeps_targets_services_and_users_apart() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(
        FileSecretStore::open(temp.path().join("secrets.enc.json"), PASSPHRASE).unwrap(),
    );
    let builder = FileCredentialBuilder(store.clone());
    builder
        .build(None, "tabularis", "a")
        .unwrap()
        .set_password("one")
        .unwrap();
    builder
        .build(Some("other"), "tabularis", "a")
        .unwrap()
        .set_password("two")
        .unwrap();

    assert_eq!(credential(&store, "a").get_password().unwrap(), "one");
    assert!(matches!(
        builder.build(None, "other-service", "a").unwrap().get_password(),
        Err(keyring::Error::NoEntry)
    ));
}

#[test]
fn rejects_a_wrong_or_short_key() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("secrets.enc.json");
    FileSecretStore::open(path.clone(), PASSPHRASE).unwrap();

    let error = FileSecretStore::open(path.clone(), "a different passphrase")
        .err()
        .unwrap();
    assert!(error.contains("does not match"), "{error}");
    let error = FileSecretStore::open(path, "short").err().unwrap();
    assert!(error.contains("at least"), "{error}");
}

#[cfg(unix)]
#[test]
fn writes_the_store_privately() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("nested").join("secrets.enc.json");
    FileSecretStore::open(path.clone(), PASSPHRASE).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn generates_and_reuses_a_key_when_none_is_configured() {
    let temp = tempfile::tempdir().unwrap();
    let first = generated_key(temp.path(), &temp.path().join(STORE_FILE)).unwrap();
    let second = generated_key(temp.path(), &temp.path().join(STORE_FILE)).unwrap();

    assert_eq!(first, second);
    assert!(first.chars().count() >= MIN_KEY_CHARS);
    let store = temp.path().join("secrets.enc.json");
    FileSecretStore::open(store, &first).unwrap();
}

#[test]
fn repairs_an_incomplete_generated_key_only_without_an_existing_store() {
    let temp = tempfile::tempdir().unwrap();
    let key_path = temp.path().join(GENERATED_KEY_FILE);
    fs::write(&key_path, "").unwrap();
    let recovered = generated_key(temp.path(), &temp.path().join(STORE_FILE)).unwrap();
    assert!(recovered.chars().count() >= MIN_KEY_CHARS);
    fs::write(temp.path().join(STORE_FILE), "existing encrypted data").unwrap();
    fs::write(&key_path, "short").unwrap();
    let error = generated_key(temp.path(), &temp.path().join(STORE_FILE)).unwrap_err();
    assert!(error.contains(GENERATED_KEY_FILE));
    assert_eq!(fs::read_to_string(&key_path).unwrap(), "short");
}

#[test]
fn concurrent_first_starts_publish_one_complete_generated_key() {
    let temp = tempfile::tempdir().unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let root = temp.path().to_path_buf();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                generated_key(&root, &root.join(STORE_FILE)).unwrap()
            })
        })
        .collect();
    let keys: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert!(keys
        .iter()
        .all(|key| key == &keys[0] && key.len() >= MIN_KEY_CHARS));
    assert_eq!(
        fs::read_to_string(temp.path().join(GENERATED_KEY_FILE)).unwrap(),
        keys[0]
    );
}

#[test]
fn rejects_a_truncated_base64_generated_key_without_changing_a_custom_store() {
    let temp = tempfile::tempdir().unwrap();
    let store = temp.path().join("custom-store.json");
    let key = generated_key(temp.path(), &store).unwrap();
    fs::write(&store, "existing encrypted data").unwrap();
    fs::write(temp.path().join(GENERATED_KEY_FILE), &key[..24]).unwrap();
    let error = generated_key(temp.path(), &store).unwrap_err();
    assert!(error.contains(GENERATED_KEY_FILE));
    assert_eq!(
        fs::read_to_string(&store).unwrap(),
        "existing encrypted data"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join(GENERATED_KEY_FILE)).unwrap(),
        &key[..24]
    );
}

#[cfg(unix)]
#[test]
fn does_not_replace_a_key_when_store_presence_cannot_be_checked() {
    let temp = tempfile::tempdir().unwrap();
    let key_path = temp.path().join(GENERATED_KEY_FILE);
    fs::write(&key_path, "short").unwrap();
    let parent = temp.path().join("not-a-directory");
    fs::write(&parent, "file").unwrap();
    assert!(generated_key(temp.path(), &parent.join(STORE_FILE)).is_err());
    assert_eq!(fs::read_to_string(&key_path).unwrap(), "short");
}
