use futures::StreamExt;
use zbus::{
    zvariant::{OwnedValue, Value},
    Connection, Proxy,
};

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";

fn theme(value: u32) -> Option<&'static str> {
    match value {
        1 => Some("dark"),
        2 => Some("light"),
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
    let connection = Connection::session().await?;
    read_setting(&settings(&connection).await?).await
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
#[path = "portal/tests.rs"]
mod tests;
