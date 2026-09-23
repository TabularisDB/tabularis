use super::{legacy, ThemeContribution};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

/// Applies only to new independent snapshots, not historical source documents.
pub(super) fn validate_editor_snapshot(editor: &Value) -> Result<(), String> {
    let typed: crate::theme_models::MonacoThemeDefinition = serde_json::from_value(editor.clone())
        .map_err(|e| format!("Invalid personal editor snapshot: {e}"))?;
    if !matches!(typed.base.as_str(), "vs" | "vs-dark" | "hc-black")
        || typed
            .theme_name
            .as_ref()
            .is_some_and(|name| !name.is_empty())
    {
        return Err(
            "An independent editor snapshot requires a supported base and no named alias".into(),
        );
    }
    if let Some(rules) = editor.get("rules").and_then(Value::as_array) {
        for rule in rules {
            if rule
                .get("fontStyle")
                .is_some_and(|value| !value.is_null() && !value.is_string())
            {
                return Err("Invalid snapshot fontStyle".into());
            }
            for field in ["foreground", "background"] {
                if let Some(color) = rule.get(field).and_then(Value::as_str) {
                    let hex = color.strip_prefix('#').unwrap_or(color);
                    if !color.is_empty()
                        && (!matches!(hex.len(), 3 | 4 | 6 | 8)
                            || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
                    {
                        return Err(format!("Invalid editor snapshot token {field}"));
                    }
                }
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableSnapshot {
    theme_snapshot_version: u8,
    source: String,
    editor: Value,
}

fn parse_snapshot(source: &str) -> Result<PortableSnapshot, String> {
    let parsed =
        super::parse_bounded_json(source.as_bytes(), legacy::LEGACY_BYTES * 2, 128, 262_144)?;
    let snapshot: PortableSnapshot = serde_json::from_value(parsed).map_err(|e| e.to_string())?;
    if snapshot.theme_snapshot_version != 1 {
        return Err("Unsupported standalone snapshot version".into());
    }
    legacy::parse_legacy(&snapshot.source)?;
    validate_editor_snapshot(&snapshot.editor)?;
    Ok(snapshot)
}

/// Historical exports stay byte-for-byte unchanged. New independent snapshots
/// need an explicit container: the legacy renderer appends SQL rules and cannot
/// represent arbitrary exact editor definitions. Old clients reject this shape.
pub fn standalone_theme_source(entry: &ThemeContribution) -> Result<String, String> {
    if entry.format == "legacy" {
        if let Some(editor) = &entry.editor {
            validate_editor_snapshot(editor)?;
            return serde_json::to_string_pretty(&PortableSnapshot {
                theme_snapshot_version: 1,
                source: entry.source.clone(),
                editor: editor.clone(),
            })
            .map_err(|e| e.to_string());
        }
    }
    Ok(entry.source.clone())
}

pub(super) fn snapshot_mode(editor: &Value) -> String {
    match editor["base"].as_str() {
        Some("vs") => "light",
        Some("hc-black") => "high-contrast",
        _ => "dark",
    }
    .into()
}

pub(super) fn preview_snapshot(source: &str, name: &str) -> Result<ThemeContribution, String> {
    super::catalog::validate_name(name)?;
    let snapshot = parse_snapshot(source)?;
    Ok(ThemeContribution {
        id: "theme:preview-document".into(),
        name: name.into(),
        revision: super::catalog::revision(source),
        origin: json!({"kind":"personal"}),
        read_only: false,
        mode: snapshot_mode(&snapshot.editor),
        format: "legacy".into(),
        source: snapshot.source,
        available: true,
        editor: Some(snapshot.editor),
    })
}

pub fn update_personal_snapshot(
    root: &Path,
    id: &str,
    name: &str,
    source: &str,
    editor: Value,
    expected_revision: &str,
) -> Result<ThemeContribution, String> {
    legacy::personal_id(id)?;
    super::catalog::validate_name(name)?;
    legacy::parse_legacy(source)?;
    validate_editor_snapshot(&editor)?;
    let _lock = super::files::write_lock(root)?;
    let path = root
        .join(super::catalog::PERSONAL_DIR)
        .join(format!("{id}.json"));
    let before =
        super::catalog::personal_entry(&super::files::read_file(&path, legacy::LEGACY_BYTES * 2)?)?;
    if before.id != id || before.format != "legacy" || before.editor.is_none() {
        return Err("Not an independent personal snapshot".into());
    }
    if before.revision != expected_revision {
        return Err("Personal theme changed; reload before editing".into());
    }
    let source = legacy::merge_legacy(
        source,
        &json!({"id":id,"name":name,"isPreset":false,"isReadOnly":false}),
    )?;
    let document = super::catalog_models::PersonalDocument {
        storage_version: 1,
        id: id.into(),
        name: name.into(),
        format: "legacy".into(),
        source,
        editor: Some(editor),
    };
    let text = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    let entry = super::catalog::personal_entry(&text)?;
    super::files::atomic_write(&path, text.as_bytes(), true)?;
    Ok(entry)
}

pub fn create_personal_snapshot(
    root: &Path,
    name: &str,
    source: &str,
) -> Result<ThemeContribution, String> {
    let preview = preview_snapshot(source, name)?;
    let id = format!("custom-{}", uuid::Uuid::new_v4());
    let source = legacy::merge_legacy(
        &preview.source,
        &json!({"id":id,"name":name,"isPreset":false,"isReadOnly":false}),
    )?;
    let document = super::catalog_models::PersonalDocument {
        storage_version: 1,
        id: id.clone(),
        name: name.into(),
        format: "legacy".into(),
        source,
        editor: preview.editor,
    };
    let text = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    let entry = super::catalog::personal_entry(&text)?;
    let _lock = super::files::write_lock(root)?;
    super::files::atomic_write(
        &root
            .join(super::catalog::PERSONAL_DIR)
            .join(format!("{id}.json")),
        text.as_bytes(),
        false,
    )?;
    Ok(entry)
}
