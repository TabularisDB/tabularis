use futures::StreamExt;
use zbus::{
    zvariant::{OwnedValue, Value},
    Connection, Proxy,
};

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";
// Command reads share a connection; the long-lived watcher has its own peer.
static READ_CONNECTION: tokio::sync::Mutex<Option<Connection>> =
    tokio::sync::Mutex::const_new(None);

fn theme(value: u32) -> Option<&'static str> {
    match value {
        1 => Some("dark"),
        // No preference must not fall back to GTK's last app-forced theme.
        0 | 2 => Some("light"),
        _ => None,
    }
}

fn decode(value: OwnedValue) -> zbus::Result<Option<&'static str>> {
    // Legacy Read wraps its return value in an extra variant; ReadOne does not.
    let value = match Value::from(value) {
        Value::Value(inner) => *inner,
        value => value,
    };
    Ok(theme(u32::try_from(value)?))
}

async fn settings(connection: &Connection) -> zbus::Result<Proxy<'_>> {
    Proxy::new(
        connection,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
    )
    .await
}

async fn read_setting(proxy: &Proxy<'_>) -> zbus::Result<Option<&'static str>> {
    let value: OwnedValue = match proxy.call("ReadOne", &(NAMESPACE, KEY)).await {
        Ok(value) => value,
        Err(zbus::Error::MethodError(name, _, _))
            if name.as_str() == "org.freedesktop.DBus.Error.UnknownMethod" =>
        {
            // Settings portal versions before ReadOne expose Read instead.
            proxy.call("Read", &(NAMESPACE, KEY)).await?
        }
        Err(error) => return Err(error),
    };
    decode(value)
}

pub async fn read() -> zbus::Result<Option<&'static str>> {
    let mut cached = READ_CONNECTION.lock().await;
    let connection = match &*cached {
        Some(connection) => connection.clone(),
        None => {
            let connection = Connection::session().await?;
            *cached = Some(connection.clone());
            connection
        }
    };
    let result = async { read_setting(&settings(&connection).await?).await }.await;
    if result.is_err() {
        // Retry with a fresh connection after a failed read, including bus loss.
        *cached = None;
    }
    result
}

pub async fn watch(mut on_change: impl FnMut(Option<&'static str>)) -> zbus::Result<()> {
    let connection = Connection::session().await?;
    let proxy = settings(&connection).await?;
    let mut changes = proxy
        .receive_signal_with_args("SettingChanged", &[(0, NAMESPACE), (1, KEY)])
        .await?;
    on_change(read_setting(&proxy).await?);
    while let Some(message) = changes.next().await {
        let (namespace, key, value): (String, String, OwnedValue) = message.body().deserialize()?;
        if namespace == NAMESPACE && key == KEY {
            on_change(decode(value)?);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
