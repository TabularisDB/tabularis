use serde_json::Value;
use std::sync::OnceLock;

static EN: OnceLock<Value> = OnceLock::new();

/// Looks up a dotted key such as `sidebar.connections` in the English locale.
pub fn t(key: &str) -> &'static str {
    let locale = EN.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../packages/web-ui/src/i18n/locales/en.json"
        ))
        .expect("en.json is valid JSON")
    });
    locale
        .pointer(&format!("/{}", key.replace('.', "/")))
        .and_then(Value::as_str)
        .unwrap_or("")
}
