use super::{decode, theme};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use zbus::zvariant::{OwnedValue, Value};

#[derive(Default)]
struct FakeSettings {
    senders: Mutex<Vec<String>>,
    fail: AtomicBool,
    hold: AtomicBool,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}

struct SettingsService(Arc<FakeSettings>);

#[zbus::interface(name = "org.freedesktop.portal.Settings")]
impl SettingsService {
    async fn read_one(
        &self,
        namespace: &str,
        key: &str,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> zbus::fdo::Result<OwnedValue> {
        assert_eq!(namespace, super::NAMESPACE);
        assert_eq!(key, super::KEY);
        self.0
            .senders
            .lock()
            .unwrap()
            .push(header.sender().unwrap().to_string());
        if self.0.hold.load(Ordering::SeqCst) {
            self.0.entered.notify_one();
            self.0.release.notified().await;
        }
        if self.0.fail.load(Ordering::SeqCst) {
            return Err(zbus::fdo::Error::Failed("temporary portal failure".into()));
        }
        Ok(OwnedValue::from(1_u32))
    }
}

#[test]
fn decodes_portal_preferences_without_assuming_unknown_is_light() {
    assert_eq!(theme(1), Some("dark"));
    assert_eq!(theme(2), Some("light"));
    assert_eq!(theme(0), Some("light"));
    assert_eq!(theme(99), None);
}

#[test]
fn reads_both_portal_variant_shapes_and_rejects_wrong_types() {
    assert_eq!(decode(OwnedValue::from(1_u32)).unwrap(), Some("dark"));
    let legacy = OwnedValue::try_from(Value::Value(Box::new(Value::U32(2)))).unwrap();
    assert_eq!(decode(legacy).unwrap(), Some("light"));
    assert_eq!(decode(OwnedValue::from(0_u32)).unwrap(), Some("light"));
    let legacy_default = OwnedValue::try_from(Value::Value(Box::new(Value::U32(0)))).unwrap();
    assert_eq!(decode(legacy_default).unwrap(), Some("light"));
    assert!(decode(OwnedValue::from(true)).is_err());
}

#[tokio::test]
#[ignore = "run under dbus-run-session with a private session bus"]
async fn reads_and_watches_the_settings_portal() {
    let settings = Arc::new(FakeSettings::default());
    let service = zbus::connection::Builder::session()
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at(
            "/org/freedesktop/portal/desktop",
            SettingsService(settings.clone()),
        )
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
        Some(Some("light"))
    );
    watcher.abort();
    assert!(watcher.await.unwrap_err().is_cancelled());

    // Concurrent and subsequent invokes must share one authenticated bus peer.
    settings.senders.lock().unwrap().clear();
    for result in futures::future::join_all((0..8).map(|_| super::read())).await {
        assert_eq!(result.unwrap(), Some("dark"));
    }
    assert_eq!(super::read().await.unwrap(), Some("dark"));
    let senders = settings.senders.lock().unwrap().clone();
    assert_eq!(senders.len(), 9);
    assert!(
        senders.iter().all(|sender| sender == &senders[0]),
        "read invokes opened distinct bus connections: {senders:?}"
    );

    // A portal error must not leave a permanently cached unusable connection.
    settings.fail.store(true, Ordering::SeqCst);
    assert!(super::read().await.is_err());
    settings.fail.store(false, Ordering::SeqCst);
    assert_eq!(super::read().await.unwrap(), Some("dark"));
    assert_ne!(
        settings.senders.lock().unwrap().last().unwrap(),
        &senders[0]
    );

    // Cancellation releases the cache lock, including a timed-out lock waiter.
    settings.hold.store(true, Ordering::SeqCst);
    let pending = tokio::spawn(super::read());
    tokio::time::timeout(wait, settings.entered.notified())
        .await
        .unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(10), super::read())
            .await
            .is_err()
    );
    pending.abort();
    assert!(pending.await.unwrap_err().is_cancelled());
    settings.hold.store(false, Ordering::SeqCst);
    settings.release.notify_one();
    assert_eq!(
        tokio::time::timeout(wait, super::read())
            .await
            .unwrap()
            .unwrap(),
        Some("dark")
    );

    // A real transport disconnect is cleared on error and can reconnect.
    let disconnected = super::READ_CONNECTION
        .lock()
        .await
        .as_ref()
        .unwrap()
        .clone();
    let old_name = disconnected.unique_name().unwrap().to_string();
    disconnected.close().await.unwrap();
    assert!(tokio::time::timeout(wait, super::read())
        .await
        .unwrap()
        .is_err());
    assert_eq!(
        tokio::time::timeout(wait, super::read())
            .await
            .unwrap()
            .unwrap(),
        Some("dark")
    );
    assert_ne!(settings.senders.lock().unwrap().last().unwrap(), &old_name);
}
