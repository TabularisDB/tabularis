use super::catalog::{label, legacy_path, personal_entry, revision, validate_name, PERSONAL_DIR};
use super::catalog_models::PersonalDocument;
use super::{files, legacy, read_theme_catalog, ThemeContribution};
use serde_json::{json, Value};
use std::path::Path;

pub fn save_legacy_theme(root: &Path, value: Value) -> Result<(), String> {
    let source = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let parsed = legacy::parse_legacy(&source)?;
    let id = label(&parsed, "id")?;
    legacy::existing_personal_id(id)?;
    let _lock = files::write_lock(root)?;
    let existing = legacy_path(root, id)?;
    if existing.is_none() {
        legacy::personal_id(id)?;
    }
    if legacy::personal_id(id).is_ok()
        && root.join(PERSONAL_DIR).join(format!("{id}.json")).exists()
    {
        if existing.is_some() {
            return Err("Ambiguous personal theme identity".into());
        }
        let path = root.join(PERSONAL_DIR).join(format!("{id}.json"));
        let original = files::read_file(&path, legacy::LEGACY_BYTES * 2)?;
        let entry = personal_entry(&original)?;
        if entry.id != id || entry.format != "legacy" {
            return Err("Use the personal definition editor for this theme".into());
        }
        let mut document: PersonalDocument =
            serde_json::from_str(&original).map_err(|e| e.to_string())?;
        let previous = legacy::parse_legacy(&document.source)?;
        if previous.get("monacoTheme") != parsed.get("monacoTheme") {
            let editor = parsed
                .get("monacoTheme")
                .ok_or("Missing editor definition")?;
            if editor
                .get("themeName")
                .and_then(Value::as_str)
                .is_some_and(|name| !name.is_empty())
            {
                return Err("Changing an independent snapshot requires a resolved editor definition, not a named alias".into());
            }
            document.editor = Some(editor.clone());
        }
        document.source = legacy::merge_legacy(&document.source, &parsed)?;
        document.name = label(&parsed, "name")?.into();
        let output = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
        personal_entry(&output)?;
        return files::atomic_write(&path, output.as_bytes(), true);
    }
    let path = existing
        .clone()
        .unwrap_or_else(|| root.join("themes").join(format!("{id}.json")));
    // Case-folded physical filenames may alias on supported filesystems.
    if existing.is_none() {
        for entry in files::directory(&root.join("themes"))? {
            if entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(&format!("{id}.json"))
            {
                return Err("Personal theme filename collision".into());
            }
        }
    }
    let output = if existing.is_some() {
        legacy::merge_legacy(&files::read_file(&path, legacy::LEGACY_BYTES)?, &parsed)?
    } else {
        source
    };
    legacy::parse_legacy(&output)?;
    files::atomic_write(&path, output.as_bytes(), existing.is_some())
}

pub fn import_legacy_theme(root: &Path, source: &str) -> Result<Value, String> {
    let mut value = legacy::parse_legacy(source)?;
    let id = format!("custom-{}", uuid::Uuid::new_v4());
    value["id"] = json!(id);
    value["isPreset"] = json!(false);
    value["isReadOnly"] = json!(false);
    value["createdAt"] = json!(chrono::Utc::now().to_rfc3339());
    value["updatedAt"] = value["createdAt"].clone();
    // Merge only host-issued fields into the raw source, preserving opaque data.
    let output = legacy::merge_legacy(
        source,
        &json!({
            "id":id,"isPreset":false,"isReadOnly":false,
            "createdAt":value["createdAt"],"updatedAt":value["updatedAt"]
        }),
    )?;
    // Host-issued identity/timestamps also count toward the readable legacy limit.
    legacy::parse_legacy(&output)?;
    let _lock = files::write_lock(root)?;
    files::atomic_write(
        &root.join("themes").join(format!("{id}.json")),
        output.as_bytes(),
        false,
    )?;
    Ok(value)
}

/// Additive naming for explicit UI imports; the old command without a name
/// retains the original legacy name and all opaque source fields.
pub fn import_legacy_theme_named(root: &Path, source: &str, name: &str) -> Result<Value, String> {
    legacy::parse_legacy(source)?;
    validate_name(name)?;
    let renamed = legacy::merge_legacy(source, &json!({"name":name}))?;
    import_legacy_theme(root, &renamed)
}

pub fn export_personal_theme(root: &Path, id: &str) -> Result<String, String> {
    let legacy = legacy_path(root, id)?;
    if legacy::personal_id(id).is_ok() {
        let path = root.join(PERSONAL_DIR).join(format!("{id}.json"));
        if path.exists() {
            if legacy.is_some() {
                return Err("Ambiguous personal theme identity".into());
            }
            let entry = personal_entry(&files::read_file(&path, legacy::LEGACY_BYTES * 2)?)?;
            if entry.id != id {
                return Err("Personal theme identity mismatch".into());
            }
            return super::snapshot::standalone_theme_source(&entry);
        }
    }
    files::read_file(
        &legacy.ok_or("Personal theme not found")?,
        legacy::LEGACY_BYTES,
    )
}

pub fn remove_personal_theme(root: &Path, id: &str) -> Result<(), String> {
    legacy::existing_personal_id(id)?;
    let _lock = files::write_lock(root)?;
    if legacy::personal_id(id).is_err() {
        let path = legacy_path(root, id)?.ok_or("Personal theme not found")?;
        files::check_path(&path)?;
        return std::fs::remove_file(path).map_err(|e| e.to_string());
    }
    let modern = root.join(PERSONAL_DIR).join(format!("{id}.json"));
    if modern.exists() {
        let entry = personal_entry(&files::read_file(&modern, legacy::LEGACY_BYTES * 2)?)?;
        if entry.id != id {
            return Err("Personal theme identity mismatch".into());
        }
        if legacy_path(root, id)?.is_some() {
            return Err("Ambiguous personal theme identity".into());
        }
        std::fs::remove_file(modern).map_err(|e| e.to_string())
    } else {
        let path = legacy_path(root, id)?.ok_or("Personal theme not found")?;
        files::check_path(&path)?;
        std::fs::remove_file(path).map_err(|e| e.to_string())
    }
}

pub fn create_personal_definition(
    root: &Path,
    name: &str,
    source: &str,
) -> Result<ThemeContribution, String> {
    validate_name(name)?;
    super::validate_definition_json(source.as_bytes())?;
    let document = PersonalDocument {
        storage_version: 1,
        id: format!("custom-{}", uuid::Uuid::new_v4()),
        name: name.into(),
        format: "v1".into(),
        source: source.into(),
        editor: None,
    };
    let text = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    let entry = personal_entry(&text)?;
    let _lock = files::write_lock(root)?;
    files::atomic_write(
        &root
            .join(PERSONAL_DIR)
            .join(format!("{}.json", document.id)),
        text.as_bytes(),
        false,
    )?;
    Ok(entry)
}

pub fn update_personal_definition(
    root: &Path,
    id: &str,
    name: &str,
    source: &str,
    expected_revision: &str,
) -> Result<ThemeContribution, String> {
    legacy::personal_id(id)?;
    validate_name(name)?;
    let _lock = files::write_lock(root)?;
    let path = root.join(PERSONAL_DIR).join(format!("{id}.json"));
    let original = files::read_file(&path, legacy::LEGACY_BYTES * 2)?;
    let entry = personal_entry(&original)?;
    if entry.id != id || revision(&original) != expected_revision {
        return Err("Theme changed; reload before editing".into());
    }
    if entry.format != "v1" {
        return Err("Use the legacy editor for this snapshot".into());
    }
    super::validate_definition_json(source.as_bytes())?;
    let updated = PersonalDocument {
        storage_version: 1,
        id: id.into(),
        name: name.into(),
        format: "v1".into(),
        source: source.into(),
        editor: None,
    };
    let text = serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?;
    let result = personal_entry(&text)?;
    files::atomic_write(&path, text.as_bytes(), true)?;
    Ok(result)
}

/// The editor snapshot is visual data from the shared frontend resolver, never
/// authority. Native lookup supplies ownership/source and issues the fresh ID.
pub fn duplicate_personal_theme(
    root: &Path,
    data_root: &Path,
    host_version: &str,
    source_id: &str,
    name: &str,
    editor: Option<Value>,
) -> Result<ThemeContribution, String> {
    validate_name(name)?;
    let source = read_theme_catalog(root, data_root, host_version)
        .themes
        .into_iter()
        .find(|entry| entry.id == source_id && entry.available)
        .ok_or("Source theme is unavailable")?;
    if source.format == "v1" {
        return create_personal_definition(root, name, &source.source);
    }
    let editor =
        editor.ok_or("Independent legacy duplication requires a resolved editor snapshot")?;
    super::snapshot::validate_editor_snapshot(&editor)?;
    let id = format!("custom-{}", uuid::Uuid::new_v4());
    let raw = legacy::merge_legacy(
        &source.source,
        &json!({"id":id,"name":name,"isPreset":false,"isReadOnly":false}),
    )?;
    let document = PersonalDocument {
        storage_version: 1,
        id: id.clone(),
        name: name.into(),
        format: "legacy".into(),
        source: raw,
        editor: Some(editor),
    };
    let text = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    let result = personal_entry(&text)?;
    let _lock = files::write_lock(root)?;
    files::atomic_write(
        &root.join(PERSONAL_DIR).join(format!("{id}.json")),
        text.as_bytes(),
        false,
    )?;
    Ok(result)
}
