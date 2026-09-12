use super::{decode, theme};
use zbus::zvariant::{OwnedValue, Value};

struct FakeSettings;

#[zbus::interface(name = "org.freedesktop.portal.Settings")]
impl FakeSettings {
    fn read_one(&self, namespace: &str, key: &str) -> OwnedValue {
        assert_eq!(namespace, super::NAMESPACE);
        assert_eq!(key, super::KEY);
        OwnedValue::from(1_u32)
    }
}

#[test]
fn decodes_portal_preferences_without_assuming_unknown_is_light() {
    assert_eq!(theme(1), Some("dark"));
    assert_eq!(theme(2), Some("light"));
    assert_eq!(theme(0), None);
    assert_eq!(theme(99), None);
}

#[test]
fn reads_both_portal_variant_shapes_and_rejects_wrong_types() {
    assert_eq!(decode(OwnedValue::from(1_u32)).unwrap(), Some("dark"));
    let legacy = OwnedValue::try_from(Value::Value(Box::new(Value::U32(2)))).unwrap();
    assert_eq!(decode(legacy).unwrap(), Some("light"));
    assert!(decode(OwnedValue::from(true)).is_err());
}

#[tokio::test]
#[ignore = "run under dbus-run-session with a private session bus"]
async fn reads_and_watches_the_settings_portal() {
    let service = zbus::connection::Builder::session()
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at("/org/freedesktop/portal/desktop", FakeSettings)
        .unwrap()
        .build()
        .await
        .unwrap();
    assert_eq!(super::read().await.unwrap(), Some("dark"));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let watcher = tokio::spawn(super::watch(move |value| {
        tx.send(value).unwrap();
    }));
    let wait = std::time::Duration::from_secs(2);
    assert_eq!(
        tokio::time::timeout(wait, rx.recv()).await.unwrap(),
        Some(Some("dark"))
    );
    for (namespace, key, value) in [
        ("other.namespace", super::KEY, 1_u32),
        (super::NAMESPACE, "other-key", 1_u32),
        (super::NAMESPACE, super::KEY, 2_u32),
        (super::NAMESPACE, super::KEY, 0_u32),
    ] {
        service
            .emit_signal(
                None::<&str>,
                "/org/freedesktop/portal/desktop",
                "org.freedesktop.portal.Settings",
                "SettingChanged",
                &(namespace, key, Value::new(value)),
            )
            .await
            .unwrap();
    }
    assert_eq!(
        tokio::time::timeout(wait, rx.recv()).await.unwrap(),
        Some(Some("light"))
    );
    assert_eq!(
        tokio::time::timeout(wait, rx.recv()).await.unwrap(),
        Some(None)
    );
    watcher.abort();
    assert!(watcher.await.unwrap_err().is_cancelled());
}
