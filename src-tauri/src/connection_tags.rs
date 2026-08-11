//! CRUD for connection tags: user-defined colored labels stored in
//! `connections.json` next to the groups. Tags are purely organizational;
//! assignment lives on `SavedConnection.tag_ids`.

use tauri::{AppHandle, Runtime};
use uuid::Uuid;

use crate::commands::{get_config_path, save_connections_and_invalidate};
use crate::models::{ConnectionTag, ConnectionsFile};
use crate::persistence;

/// Basic sanity check for a CSS hex color (`#rgb`, `#rrggbb` or `#rrggbbaa`),
/// so a crafted connections.json entry can't inject arbitrary CSS.
pub fn is_valid_hex_color(color: &str) -> bool {
    let Some(hex) = color.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// Maximum tag name length in characters, enforced on create/update and
/// mirrored by `maxLength` on the frontend inputs.
pub const MAX_TAG_NAME_CHARS: usize = 32;

fn validate_tag_input(name: &str, color: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    if name.trim().chars().count() > MAX_TAG_NAME_CHARS {
        return Err(format!(
            "Tag name cannot exceed {MAX_TAG_NAME_CHARS} characters"
        ));
    }
    if !is_valid_hex_color(color) {
        return Err(format!("Invalid tag color: {color}"));
    }
    Ok(())
}

// ---------- Pure helpers (unit-tested below) ----------

pub fn create_tag_impl(
    file: &mut ConnectionsFile,
    name: &str,
    color: &str,
) -> Result<ConnectionTag, String> {
    validate_tag_input(name, color)?;
    let name = name.trim();
    if file
        .tags
        .iter()
        .any(|t| t.name.eq_ignore_ascii_case(name))
    {
        return Err(format!("A tag named \"{name}\" already exists"));
    }
    let tag = ConnectionTag {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        color: color.to_string(),
    };
    file.tags.push(tag.clone());
    Ok(tag)
}

pub fn update_tag_impl(
    file: &mut ConnectionsFile,
    id: &str,
    name: &str,
    color: &str,
) -> Result<(), String> {
    validate_tag_input(name, color)?;
    let name = name.trim();
    if file
        .tags
        .iter()
        .any(|t| t.id != id && t.name.eq_ignore_ascii_case(name))
    {
        return Err(format!("A tag named \"{name}\" already exists"));
    }
    let tag = file
        .tags
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or("Tag not found")?;
    tag.name = name.to_string();
    tag.color = color.to_string();
    Ok(())
}

/// Removes the tag and detaches it from every connection that carried it.
pub fn delete_tag_impl(file: &mut ConnectionsFile, id: &str) -> Result<(), String> {
    let before = file.tags.len();
    file.tags.retain(|t| t.id != id);
    if file.tags.len() == before {
        return Err("Tag not found".to_string());
    }
    for conn in &mut file.connections {
        if let Some(tag_ids) = &mut conn.tag_ids {
            tag_ids.retain(|t| t != id);
            if tag_ids.is_empty() {
                conn.tag_ids = None;
            }
        }
    }
    Ok(())
}

/// Replaces the tag set of one connection, preserving the order given by
/// the caller. Duplicates and unknown ids are silently dropped — orphaned
/// ids legitimately occur after a partial import, and saving a connection
/// must not fail because of them.
pub fn set_connection_tags_impl(
    file: &mut ConnectionsFile,
    connection_id: &str,
    tag_ids: &[String],
) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    let mut cleaned = Vec::new();
    for tag_id in tag_ids {
        if file.tags.iter().any(|t| &t.id == tag_id) && seen.insert(tag_id.clone()) {
            cleaned.push(tag_id.clone());
        }
    }
    let conn = file
        .connections
        .iter_mut()
        .find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;
    conn.tag_ids = if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    };
    Ok(())
}

/// Merges imported tags into the existing list, used by the import flow.
/// Same id → the import wins (like connections). Same name (case-insensitive)
/// under a different id → the tags are unified onto the existing id, and the
/// returned map (imported id → existing id) lets the caller remap the
/// imported connections' `tag_ids`, so a "prod" tag created independently on
/// two machines never ends up duplicated. The caller must apply the remap to
/// existing connections as well: a same-id tag whose imported rename collides
/// with another tag is removed and remapped onto the name holder.
pub fn merge_imported_tags(
    existing: &mut Vec<ConnectionTag>,
    imported: Vec<ConnectionTag>,
) -> std::collections::HashMap<String, String> {
    let mut remap = std::collections::HashMap::new();
    for tag in imported {
        // Name match on a *different* existing tag always unifies onto it,
        // even when a tag with the imported id also exists: an imported
        // rename that collides with another tag must not break the
        // unique-name invariant, so the same-id tag is dropped and its id
        // remapped (the caller applies the remap to existing connections
        // too, so nothing dangles).
        if let Some(same_name) = existing
            .iter()
            .find(|t| t.id != tag.id && t.name.eq_ignore_ascii_case(&tag.name))
        {
            let target_id = same_name.id.clone();
            existing.retain(|t| t.id != tag.id);
            remap.insert(tag.id, target_id);
        } else if let Some(same_id) = existing.iter_mut().find(|t| t.id == tag.id) {
            *same_id = tag;
        } else {
            existing.push(tag);
        }
    }
    remap
}

// ---------- Tauri commands ----------

#[tauri::command]
pub async fn list_connection_tags<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ConnectionTag>, String> {
    let path = get_config_path(&app)?;
    Ok(persistence::load_connections_file(&path)?.tags)
}

#[tauri::command]
pub async fn create_connection_tag<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    color: String,
) -> Result<ConnectionTag, String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;
    let tag = create_tag_impl(&mut file, &name, &color)?;
    save_connections_and_invalidate(&app, &path, &file)?;
    Ok(tag)
}

#[tauri::command]
pub async fn update_connection_tag<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;
    update_tag_impl(&mut file, &id, &name, &color)?;
    save_connections_and_invalidate(&app, &path, &file)
}

#[tauri::command]
pub async fn delete_connection_tag<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;
    delete_tag_impl(&mut file, &id)?;
    save_connections_and_invalidate(&app, &path, &file)
}

#[tauri::command]
pub async fn set_connection_tags<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let mut file = persistence::load_connections_file(&path)?;
    set_connection_tags_impl(&mut file, &connection_id, &tag_ids)?;
    save_connections_and_invalidate(&app, &path, &file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionParams, SavedConnection};

    fn conn(id: &str, tag_ids: Option<Vec<&str>>) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: id.to_string(),
            params: ConnectionParams::default(),
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: tag_ids.map(|v| v.iter().map(|s| s.to_string()).collect()),
            environment: None,
        }
    }

    fn file_with_tags(tags: &[(&str, &str)]) -> ConnectionsFile {
        ConnectionsFile {
            groups: vec![],
            connections: vec![],
            tags: tags
                .iter()
                .map(|(id, name)| ConnectionTag {
                    id: id.to_string(),
                    name: name.to_string(),
                    color: "#ff0000".to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn hex_color_validation() {
        assert!(is_valid_hex_color("#fff"));
        assert!(is_valid_hex_color("#f97316"));
        assert!(is_valid_hex_color("#f97316cc"));
        assert!(!is_valid_hex_color("f97316"));
        assert!(!is_valid_hex_color("#f973"));
        assert!(!is_valid_hex_color("#zzzzzz"));
        assert!(!is_valid_hex_color("red"));
    }

    #[test]
    fn create_rejects_duplicate_names_case_insensitively() {
        let mut file = file_with_tags(&[("t1", "Prod")]);
        assert!(create_tag_impl(&mut file, "prod", "#00ff00").is_err());
        assert!(create_tag_impl(&mut file, "  Staging ", "#00ff00").is_ok());
        assert_eq!(file.tags[1].name, "Staging");
    }

    #[test]
    fn create_rejects_empty_name_and_bad_color() {
        let mut file = file_with_tags(&[]);
        assert!(create_tag_impl(&mut file, "   ", "#00ff00").is_err());
        assert!(create_tag_impl(&mut file, "ok", "green").is_err());
    }

    #[test]
    fn name_length_is_capped() {
        let mut file = file_with_tags(&[("t1", "Prod")]);
        let too_long = "x".repeat(MAX_TAG_NAME_CHARS + 1);
        assert!(create_tag_impl(&mut file, &too_long, "#00ff00").is_err());
        assert!(update_tag_impl(&mut file, "t1", &too_long, "#00ff00").is_err());
        // Exactly at the cap is fine, and multi-byte chars count as 1.
        let max_ok = "é".repeat(MAX_TAG_NAME_CHARS);
        assert!(create_tag_impl(&mut file, &max_ok, "#00ff00").is_ok());
    }

    #[test]
    fn update_renames_and_keeps_own_name_valid() {
        let mut file = file_with_tags(&[("t1", "Prod"), ("t2", "Dev")]);
        // Renaming to its own (case-changed) name is allowed.
        update_tag_impl(&mut file, "t1", "PROD", "#123456").unwrap();
        assert_eq!(file.tags[0].name, "PROD");
        assert_eq!(file.tags[0].color, "#123456");
        // Colliding with another tag is not.
        assert!(update_tag_impl(&mut file, "t1", "dev", "#123456").is_err());
        assert!(update_tag_impl(&mut file, "missing", "x", "#123456").is_err());
    }

    #[test]
    fn delete_detaches_tag_from_connections() {
        let mut file = file_with_tags(&[("t1", "Prod"), ("t2", "Dev")]);
        file.connections = vec![conn("c1", Some(vec!["t1", "t2"])), conn("c2", Some(vec!["t1"]))];
        delete_tag_impl(&mut file, "t1").unwrap();
        assert_eq!(file.tags.len(), 1);
        assert_eq!(file.connections[0].tag_ids, Some(vec!["t2".to_string()]));
        // A connection left without tags drops the field entirely.
        assert_eq!(file.connections[1].tag_ids, None);
        assert!(delete_tag_impl(&mut file, "t1").is_err());
    }

    #[test]
    fn set_tags_validates_dedups_and_clears() {
        let mut file = file_with_tags(&[("t1", "Prod"), ("t2", "Dev")]);
        file.connections = vec![conn("c1", None)];

        set_connection_tags_impl(
            &mut file,
            "c1",
            &["t1".to_string(), "t2".to_string(), "t1".to_string()],
        )
        .unwrap();
        assert_eq!(
            file.connections[0].tag_ids,
            Some(vec!["t1".to_string(), "t2".to_string()])
        );

        // Unknown ids are dropped, not fatal (orphans after a partial import).
        set_connection_tags_impl(&mut file, "c1", &["nope".to_string(), "t1".to_string()])
            .unwrap();
        assert_eq!(file.connections[0].tag_ids, Some(vec!["t1".to_string()]));
        assert!(set_connection_tags_impl(&mut file, "missing", &[]).is_err());

        set_connection_tags_impl(&mut file, "c1", &[]).unwrap();
        assert_eq!(file.connections[0].tag_ids, None);
    }

    #[test]
    fn import_merge_unifies_by_id_then_name() {
        let mut existing = file_with_tags(&[("t1", "Prod"), ("t2", "Dev")]).tags;
        let imported = vec![
            // Same id: import wins (renamed + recolored).
            ConnectionTag {
                id: "t1".into(),
                name: "Production".into(),
                color: "#111111".into(),
            },
            // Same name, different id: unified onto the existing tag.
            ConnectionTag {
                id: "other-dev".into(),
                name: "dev".into(),
                color: "#222222".into(),
            },
            // Genuinely new: appended.
            ConnectionTag {
                id: "t3".into(),
                name: "Staging".into(),
                color: "#333333".into(),
            },
        ];

        let remap = merge_imported_tags(&mut existing, imported);

        assert_eq!(existing.len(), 3);
        assert_eq!(existing[0].name, "Production");
        assert_eq!(existing[0].color, "#111111");
        assert_eq!(existing[2].id, "t3");
        assert_eq!(
            remap,
            std::collections::HashMap::from([("other-dev".to_string(), "t2".to_string())])
        );
    }

    #[test]
    fn import_merge_rename_collision_unifies_instead_of_duplicating() {
        // Import renames t1 ("Prod") to "dev", which collides with t2 ("Dev"):
        // t1 must be unified onto t2, never left as a duplicate name.
        let mut existing = file_with_tags(&[("t1", "Prod"), ("t2", "Dev")]).tags;
        let imported = vec![ConnectionTag {
            id: "t1".into(),
            name: "dev".into(),
            color: "#111111".into(),
        }];

        let remap = merge_imported_tags(&mut existing, imported);

        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0].id, "t2");
        assert_eq!(
            remap,
            std::collections::HashMap::from([("t1".to_string(), "t2".to_string())])
        );
    }
}
