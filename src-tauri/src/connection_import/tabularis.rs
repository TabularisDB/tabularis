//! Native Tabularis-JSON import: preview + apply operating directly on an
//! [`ExportPayload`], so no native field is lost the way the foreign-app neutral
//! envelope would drop it. Reuses the shared [`ImportPreview`] /
//! [`ImportResolution`] types and the same group-resolution semantics as
//! [`super::convert`], so the frontend renders the identical per-item picker.

use std::collections::{HashMap, HashSet};

use super::analyzer::{dup_key_existing, ImportItem, ImportItemStatus, ImportPreview};
use super::convert::{new_id, resolve_group, ImportResolution};
use crate::models::{ConnectionGroup, ExportPayload, SavedConnection};

/// Source name shown in the preview header for a Tabularis JSON import.
pub const TABULARIS_SOURCE_NAME: &str = "Tabularis";

/// Build a preview from a parsed Tabularis export payload, annotating each
/// connection against the user's existing connections (duplicate detection) and
/// seeding the group name from the payload's own group hierarchy.
pub fn preview(
    payload: &ExportPayload,
    existing: &[SavedConnection],
    registered_ids: &[String],
) -> ImportPreview {
    let existing_keys: Vec<(_, String, String)> = existing
        .iter()
        .map(|c| (dup_key_existing(c), c.id.clone(), c.name.clone()))
        .collect();

    let items = payload
        .connections
        .iter()
        .enumerate()
        .map(|(index, conn)| {
            let driver_installed = registered_ids.iter().any(|r| r == &conn.params.driver);
            let key = dup_key_existing(conn);
            let status = if let Some((_, id, name)) =
                existing_keys.iter().find(|(k, _, _)| k == &key)
            {
                ImportItemStatus::Duplicate {
                    existing_id: id.clone(),
                    existing_name: name.clone(),
                }
            } else if !driver_installed {
                ImportItemStatus::Warnings {
                    warnings: vec![format!(
                        "Database driver \"{}\" is not installed",
                        conn.params.driver
                    )],
                }
            } else {
                ImportItemStatus::Ready
            };

            let group_name = conn
                .group_id
                .as_ref()
                .and_then(|gid| payload.groups.iter().find(|g| &g.id == gid))
                .map(|g| g.name.clone());

            let has_password =
                conn.params.password.is_some() || conn.params.save_in_keychain == Some(true);
            let has_ssh =
                conn.params.ssh_enabled == Some(true) || conn.params.ssh_connection_id.is_some();

            ImportItem {
                index,
                name: conn.name.clone(),
                driver_id: conn.params.driver.clone(),
                driver_installed,
                host: conn.params.host.clone().unwrap_or_default(),
                port: conn.params.port.unwrap_or(0),
                database: conn.params.database.primary().to_string(),
                username: conn.params.username.clone().unwrap_or_default(),
                has_ssh,
                has_password,
                group_name,
                status,
            }
        })
        .collect();

    ImportPreview {
        source_name: TABULARIS_SOURCE_NAME.to_string(),
        credentials_aborted: false,
        items,
    }
}

/// Apply the payload using the per-item resolutions, preserving every native
/// field and only overriding group assignment and record ids. Newly-imported
/// connections get fresh ids (with their linked SSH record remapped) so the
/// import never clobbers an unrelated existing connection; `replace` reuses the
/// chosen existing id.
pub fn apply(
    payload: &ExportPayload,
    resolutions: &[ImportResolution],
    existing_groups: &[ConnectionGroup],
) -> ExportPayload {
    let mut out = ExportPayload {
        version: 1,
        groups: Vec::new(),
        connections: Vec::new(),
        ssh_connections: Vec::new(),
        k8s_connections: Vec::new(),
    };
    let mut group_ids: HashMap<String, String> = HashMap::new();
    // Original payload group ids to preserve verbatim (with their ancestor
    // chain) for connections that keep their source group.
    let mut keep_original: HashSet<String> = HashSet::new();

    for res in resolutions {
        if res.action == "skip" {
            continue;
        }
        let conn = match payload.connections.get(res.index) {
            Some(c) => c.clone(),
            None => continue,
        };

        // Only trust an original group id that actually resolves in the payload.
        let original_group = conn
            .group_id
            .clone()
            .filter(|gid| payload.groups.iter().any(|g| &g.id == gid));

        // Group assignment mirrors `convert::build_payload`: new group by name
        // (optionally nested), an existing group id, explicit "none" (empty
        // string), or — by default — keep the source group.
        let group_id = if res.action == "replace" {
            if let Some(g) = &original_group {
                keep_original.insert(g.clone());
            }
            original_group.clone()
        } else if let Some(name) = res
            .new_group_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let parent = res
                .new_group_parent_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            Some(resolve_group(
                name,
                parent,
                existing_groups,
                &mut group_ids,
                &mut out,
            ))
        } else if let Some(gid) = &res.group_id {
            (!gid.is_empty()).then(|| gid.clone())
        } else {
            if let Some(g) = &original_group {
                keep_original.insert(g.clone());
            }
            original_group.clone()
        };

        let mut new_conn = conn;
        new_conn.id = if res.action == "replace" {
            res.replace_existing_id.clone().unwrap_or_else(new_id)
        } else {
            new_id()
        };
        new_conn.group_id = group_id;
        new_conn.sort_order = None;

        // Remap the linked SSH record to a fresh id so the copy doesn't share
        // (and later clobber) the original's keychain entry.
        if let Some(old_ssh_id) = new_conn.params.ssh_connection_id.clone() {
            if let Some(ssh) = payload.ssh_connections.iter().find(|s| s.id == old_ssh_id) {
                let mut ssh_clone = ssh.clone();
                ssh_clone.id = new_id();
                new_conn.params.ssh_connection_id = Some(ssh_clone.id.clone());
                out.ssh_connections.push(ssh_clone);
            }
        }

        out.connections.push(new_conn);
    }

    include_group_chains(payload, &keep_original, &mut out);
    out
}

/// Add every kept original group plus its ancestor chain to `out.groups`,
/// preserving the payload's ids and hierarchy (deduped by id).
fn include_group_chains(
    payload: &ExportPayload,
    keep_original: &HashSet<String>,
    out: &mut ExportPayload,
) {
    let mut included: HashSet<String> = out.groups.iter().map(|g| g.id.clone()).collect();
    for start in keep_original {
        let mut current = Some(start.clone());
        while let Some(id) = current {
            if !included.insert(id.clone()) {
                break; // already added (and so is its chain)
            }
            match payload.groups.iter().find(|g| g.id == id) {
                Some(group) => {
                    out.groups.push(group.clone());
                    current = group.parent_id.clone();
                }
                None => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionParams, DatabaseSelection, SshConnection};

    fn group(id: &str, name: &str, parent: Option<&str>) -> ConnectionGroup {
        ConnectionGroup {
            id: id.into(),
            name: name.into(),
            parent_id: parent.map(str::to_string),
            collapsed: false,
            sort_order: 0,
        }
    }

    fn conn(id: &str, name: &str, host: &str, db: &str, group_id: Option<&str>) -> SavedConnection {
        SavedConnection {
            id: id.into(),
            name: name.into(),
            params: ConnectionParams {
                driver: "postgres".into(),
                host: Some(host.into()),
                port: Some(5432),
                username: Some("user".into()),
                database: DatabaseSelection::Single(db.into()),
                ..Default::default()
            },
            group_id: group_id.map(str::to_string),
            sort_order: Some(3),
            detect_json_in_text_columns: None,
            appearance: None,
        }
    }

    fn res(index: usize, action: &str) -> ImportResolution {
        ImportResolution {
            index,
            action: action.into(),
            replace_existing_id: None,
            group_id: None,
            new_group_name: None,
            new_group_parent_id: None,
        }
    }

    fn payload(groups: Vec<ConnectionGroup>, connections: Vec<SavedConnection>) -> ExportPayload {
        ExportPayload {
            version: 1,
            groups,
            connections,
            ssh_connections: Vec::new(),
            k8s_connections: Vec::new(),
        }
    }

    #[test]
    fn preview_marks_duplicates_and_seeds_group_name() {
        let p = payload(
            vec![group("g1", "Work", None)],
            vec![conn("c1", "Prod", "db.example.com", "app", Some("g1"))],
        );
        let existing = vec![conn("existing", "Existing Prod", "db.example.com", "app", None)];
        let preview = preview(&p, &existing, &["postgres".into()]);

        assert_eq!(preview.source_name, "Tabularis");
        assert_eq!(preview.items[0].group_name.as_deref(), Some("Work"));
        assert!(matches!(
            preview.items[0].status,
            ImportItemStatus::Duplicate { .. }
        ));
    }

    #[test]
    fn preview_warns_on_uninstalled_driver() {
        let p = payload(vec![], vec![conn("c1", "Prod", "h", "app", None)]);
        let preview = preview(&p, &[], &["mysql".into()]);
        assert!(matches!(
            preview.items[0].status,
            ImportItemStatus::Warnings { .. }
        ));
        assert!(!preview.items[0].driver_installed);
    }

    #[test]
    fn apply_default_keeps_original_group_with_hierarchy() {
        // Nested: root "A" > "A1"; connection lives in A1.
        let p = payload(
            vec![group("A", "A", None), group("A1", "A1", Some("A"))],
            vec![conn("c1", "Prod", "h", "app", Some("A1"))],
        );
        let out = apply(&p, &[res(0, "import")], &[]);

        assert_eq!(out.connections.len(), 1);
        // Fresh connection id, but the source group is kept.
        assert_ne!(out.connections[0].id, "c1");
        assert_eq!(out.connections[0].group_id.as_deref(), Some("A1"));
        // Both the group and its ancestor are carried over verbatim.
        let ids: Vec<&str> = out.groups.iter().map(|g| g.id.as_str()).collect();
        assert!(ids.contains(&"A1") && ids.contains(&"A"));
    }

    #[test]
    fn apply_new_group_name_overrides_source() {
        let p = payload(
            vec![group("A", "A", None)],
            vec![conn("c1", "Prod", "h", "app", Some("A"))],
        );
        let mut r = res(0, "import");
        r.new_group_name = Some("Imported".into());
        let out = apply(&p, &[r], &[]);

        // A fresh group is minted; the original "A" is not carried over.
        assert_eq!(out.groups.len(), 1);
        assert_eq!(out.groups[0].name, "Imported");
        assert_eq!(
            out.connections[0].group_id.as_deref(),
            Some(out.groups[0].id.as_str())
        );
    }

    #[test]
    fn apply_existing_group_id_and_explicit_none() {
        let p = payload(
            vec![group("A", "A", None)],
            vec![
                conn("c1", "One", "h1", "app", Some("A")),
                conn("c2", "Two", "h2", "app", Some("A")),
            ],
        );
        let mut assign = res(0, "import");
        assign.group_id = Some("user-group".into());
        let mut clear = res(1, "import");
        clear.group_id = Some(String::new());
        let out = apply(&p, &[assign, clear], &[]);

        assert_eq!(out.connections[0].group_id.as_deref(), Some("user-group"));
        assert_eq!(out.connections[1].group_id, None);
        // Neither kept the source group, so "A" isn't imported.
        assert!(out.groups.is_empty());
    }

    #[test]
    fn apply_skips_and_replaces() {
        let p = payload(
            vec![],
            vec![
                conn("c1", "Keep", "h1", "app", None),
                conn("c2", "Drop", "h2", "app", None),
            ],
        );
        let mut replace = res(0, "replace");
        replace.replace_existing_id = Some("target-id".into());
        let out = apply(&p, &[replace, res(1, "skip")], &[]);

        assert_eq!(out.connections.len(), 1);
        assert_eq!(out.connections[0].id, "target-id");
    }

    #[test]
    fn apply_remaps_linked_ssh_to_fresh_id() {
        let mut c = conn("c1", "Prod", "h", "app", None);
        c.params.ssh_enabled = Some(true);
        c.params.ssh_connection_id = Some("ssh-old".into());
        let mut p = payload(vec![], vec![c]);
        p.ssh_connections.push(SshConnection {
            id: "ssh-old".into(),
            name: "bastion".into(),
            host: "bastion".into(),
            port: 22,
            user: "deploy".into(),
            auth_type: Some("password".into()),
            password: None,
            key_file: None,
            key_passphrase: None,
            allow_passphrase_prompt: None,
            save_in_keychain: Some(false),
        });

        let out = apply(&p, &[res(0, "import")], &[]);
        assert_eq!(out.ssh_connections.len(), 1);
        let new_ssh_id = &out.ssh_connections[0].id;
        assert_ne!(new_ssh_id, "ssh-old");
        assert_eq!(
            out.connections[0].params.ssh_connection_id.as_ref(),
            Some(new_ssh_id)
        );
    }
}
