//! Compatibility validation is intentionally separate from the closed v1 schema.
use super::json::parse_bounded_json;
use crate::theme_models::Theme;
use serde_json::{value::RawValue, Value};
use std::collections::BTreeMap;

pub(super) const LEGACY_BYTES: usize = 4 * 1024 * 1024;
type RawObject = BTreeMap<String, Box<RawValue>>;

pub(super) fn builtin_themes() -> Vec<Value> {
    serde_json::from_str(include_str!("../../../packages/web-ui/src/themes/builtin-themes.json"))
        .expect("Bundled builtin catalog must be valid")
}

pub(super) fn is_builtin(id: &str) -> bool {
    builtin_themes()
        .iter()
        .any(|theme| theme["id"].as_str() == Some(id))
}

/// Existing IDs are labels bound by directory lookup, not path components.
/// Even historical path-looking labels cannot escape storage through lookup.
pub(super) fn existing_personal_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 4096
        || id.chars().any(char::is_control)
        || id.starts_with("theme:")
        || is_builtin(id)
    {
        return Err("Invalid, reserved or read-only personal theme identity".into());
    }
    Ok(())
}

/// New physical filenames use a portable policy; existing IDs remain unchanged.
pub(super) fn personal_id(id: &str) -> Result<(), String> {
    let stem = id.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if id.is_empty()
        || id.len() > 240
        || id.starts_with('.')
        || id.ends_with(['.', ' '])
        || id
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || reserved
        || is_builtin(id)
    {
        return Err("Invalid, reserved or read-only personal theme identity".into());
    }
    Ok(())
}

pub(super) fn parse_legacy(source: &str) -> Result<Value, String> {
    // Legacy has a separate, wider budget and retains unknown fields. The raw
    // text is separately retained for export and lossless metadata preservation.
    let raw = parse_bounded_json(source.as_bytes(), LEGACY_BYTES, 128, 262_144)?;
    let mut compatible = raw.clone();
    let object = compatible
        .as_object_mut()
        .ok_or("Legacy theme must be an object")?;
    object.entry("isPreset").or_insert(Value::Bool(false));
    object.entry("isReadOnly").or_insert(Value::Bool(false));
    let semantic = compatible
        .pointer_mut("/colors/semantic")
        .and_then(Value::as_object_mut)
        .ok_or("Legacy theme has no semantic palette")?;
    for (native, frontend) in [
        ("connection_active", "connectionActive"),
        ("connection_inactive", "connectionInactive"),
    ] {
        if !semantic.contains_key(native) {
            if let Some(value) = semantic.get(frontend).cloned() {
                semantic.insert(native.into(), value);
            }
        }
    }
    let editor = compatible
        .get_mut("monacoTheme")
        .and_then(Value::as_object_mut)
        .ok_or("Legacy theme has no editor definition")?;
    editor.entry("inherit").or_insert(Value::Bool(true));
    if let Some(rules) = editor.get("rules").and_then(Value::as_array) {
        for rule in rules {
            if rule
                .get("fontStyle")
                .is_some_and(|style| !style.is_null() && !style.is_string())
            {
                return Err("Invalid legacy editor fontStyle".into());
            }
        }
    }
    // Validate historical required structure without reserializing it to disk.
    serde_json::from_value::<Theme>(compatible)
        .map_err(|e| format!("Invalid legacy theme: {e}"))?;
    Ok(raw)
}

/// Keep opaque original fields as RawValue, including large integer lexemes.
/// Editing supported fields must not round unknown metadata through JS/f64.
pub(super) fn merge_legacy(original: &str, update: &Value) -> Result<String, String> {
    let mut raw: RawObject = serde_json::from_str(original).map_err(|e| e.to_string())?;
    let object = update
        .as_object()
        .ok_or("Legacy update must be an object")?;
    let mut template = builtin_themes()
        .into_iter()
        .next()
        .ok_or("Missing legacy template")?;
    for key in ["author", "version", "createdAt", "updatedAt", "taskbarIcon"] {
        template[key] = Value::Null;
    }
    template["colors"]["semantic"]["connection_active"] = Value::Null;
    template["colors"]["semantic"]["connection_inactive"] = Value::Null;
    template["monacoTheme"]["rules"] = serde_json::json!([{"token":null,"foreground":null,"background":null,"fontStyle":null,"font_style":null}]);
    template["monacoTheme"]["colors"] = Value::Null;
    merge_known(
        &mut raw,
        object,
        template.as_object().ok_or("Invalid legacy template")?,
    )?;
    serde_json::to_string_pretty(&raw).map_err(|e| e.to_string())
}

fn merge_known(
    raw: &mut RawObject,
    update: &serde_json::Map<String, Value>,
    template: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    for (key, value) in update {
        if !template.contains_key(key) && raw.contains_key(key) {
            continue;
        }
        if let (Some(existing), Some(updates), Some(rule_template)) = (
            raw.get(key),
            value.as_array(),
            template.get(key).and_then(Value::as_array),
        ) {
            if let (Ok(originals), Some(known)) = (
                serde_json::from_str::<Vec<Box<RawValue>>>(existing.get()),
                rule_template.first().and_then(Value::as_object),
            ) {
                let mut combined = Vec::new();
                for (index, update) in updates.iter().enumerate() {
                    let fields = update.as_object().ok_or("Invalid legacy rule")?;
                    let mut rule = originals
                        .get(index)
                        .and_then(|original| serde_json::from_str::<RawObject>(original.get()).ok())
                        .unwrap_or_default();
                    let same_token = rule
                        .get("token")
                        .and_then(|token| serde_json::from_str::<Value>(token.get()).ok())
                        .as_ref()
                        == update.get("token");
                    if !same_token {
                        rule.clear();
                    }
                    merge_known(&mut rule, fields, known)?;
                    combined.push(rule);
                }
                raw.insert(
                    key.clone(),
                    RawValue::from_string(
                        serde_json::to_string(&combined).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?,
                );
                continue;
            }
        }
        if let (Some(existing), Some(fields), Some(known)) = (
            raw.get(key),
            value.as_object(),
            template.get(key).and_then(Value::as_object),
        ) {
            if let Ok(mut nested) = serde_json::from_str::<RawObject>(existing.get()) {
                merge_known(&mut nested, fields, known)?;
                raw.insert(
                    key.clone(),
                    RawValue::from_string(
                        serde_json::to_string(&nested).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?,
                );
                continue;
            }
        }
        raw.insert(
            key.clone(),
            RawValue::from_string(serde_json::to_string(value).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(())
}
