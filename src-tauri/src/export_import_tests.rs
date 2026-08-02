#[cfg(test)]
mod tests {
    use crate::models::{ExportPayload, ConnectionGroup, SavedConnection, SshConnection, ConnectionParams, DatabaseSelection};

    #[test]
    fn test_export_payload_serialization() {
        let payload = ExportPayload {
            version: 1,
            groups: vec![ConnectionGroup {
                id: "group1".to_string(),
                name: "Test Group".to_string(),
                collapsed: false,
                sort_order: 0,
                parent_id: None,
            }],
            connections: vec![SavedConnection {
                id: "conn1".to_string(),
                name: "Test Conn".to_string(),
                params: ConnectionParams {
                    driver: "mysql".to_string(),
                    host: Some("localhost".to_string()),
                    port: Some(3306),
                    username: Some("root".to_string()),
                    password: Some("password".to_string()),
                    database: DatabaseSelection::Single("test".to_string()),
                    ssh_enabled: Some(false),
                    save_in_keychain: Some(true),
                    ..Default::default()
                },
                group_id: Some("group1".to_string()),
                sort_order: Some(0),
                detect_json_in_text_columns: None,
                appearance: None,
            }],
            ssh_connections: vec![SshConnection {
                id: "ssh1".to_string(),
                name: "Test SSH".to_string(),
                host: "remote".to_string(),
                port: 22,
                user: "user".to_string(),
                auth_type: Some("password".to_string()),
                password: Some("ssh_password".to_string()),
                key_file: None,
                key_passphrase: None,
                allow_passphrase_prompt: None,
                save_in_keychain: Some(true),
            }],
            k8s_connections: vec![],
        };

        let json = serde_json::to_string(&payload).unwrap();
        let deserialized: ExportPayload = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.version, 1);
        assert_eq!(deserialized.groups.len(), 1);
        assert_eq!(deserialized.connections.len(), 1);
        assert_eq!(deserialized.ssh_connections.len(), 1);
        assert_eq!(deserialized.connections[0].params.password, Some("password".to_string()));
        assert_eq!(deserialized.ssh_connections[0].password, Some("ssh_password".to_string()));
    }

    // Helper: build a 3-level tree
    //   - root "A"
    //     - child "A1" (parent=A)
    //       - grandchild "A1a" (parent=A1)
    //   - root "B"
    fn build_tree() -> Vec<ConnectionGroup> {
        vec![
            ConnectionGroup {
                id: "A".into(),
                name: "A".into(),
                collapsed: false,
                sort_order: 0,
                parent_id: None,
            },
            ConnectionGroup {
                id: "A1".into(),
                name: "A1".into(),
                collapsed: false,
                sort_order: 0,
                parent_id: Some("A".into()),
            },
            ConnectionGroup {
                id: "A1a".into(),
                name: "A1a".into(),
                collapsed: false,
                sort_order: 0,
                parent_id: Some("A1".into()),
            },
            ConnectionGroup {
                id: "B".into(),
                name: "B".into(),
                collapsed: false,
                sort_order: 1,
                parent_id: None,
            },
        ]
    }

    #[test]
    fn test_export_preserves_nested_group_hierarchy() {
        // The export payload must round-trip the parent_id chain through
        // JSON so the importer can rebuild the tree, not just flat-list
        // the groups.
        let tree = build_tree();
        let payload = ExportPayload {
            version: 1,
            groups: tree.clone(),
            connections: vec![],
            ssh_connections: vec![],
            k8s_connections: vec![],
        };

        let json = serde_json::to_string(&payload).unwrap();
        let deserialized: ExportPayload = serde_json::from_str(&json).unwrap();

        // Same set of ids
        let original_ids: std::collections::HashSet<_> = tree.iter().map(|g| g.id.clone()).collect();
        let new_ids: std::collections::HashSet<_> =
            deserialized.groups.iter().map(|g| g.id.clone()).collect();
        assert_eq!(original_ids, new_ids);

        // Every parent_id points to a group that exists in the payload
        let new_id_refs: std::collections::HashSet<&str> =
            deserialized.groups.iter().map(|g| g.id.as_str()).collect();
        for g in &deserialized.groups {
            if let Some(parent) = g.parent_id.as_deref() {
                assert!(
                    new_id_refs.contains(parent),
                    "After deserialization, {} has parent_id {} which is not in the payload",
                    g.id,
                    parent
                );
            }
        }

        // The 3-level chain is intact: A1a -> A1 -> A
        let a1a = deserialized.groups.iter().find(|g| g.id == "A1a").unwrap();
        let a1 = deserialized.groups.iter().find(|g| g.id == "A1").unwrap();
        let a = deserialized.groups.iter().find(|g| g.id == "A").unwrap();
        assert_eq!(a1a.parent_id.as_deref(), Some("A1"));
        assert_eq!(a1.parent_id.as_deref(), Some("A"));
        assert_eq!(a.parent_id, None);
    }

    #[test]
    fn test_merge_groups_imports_full_subtree_preserving_hierarchy() {
        // Simulate the import step: empty local config, payload brings a
        // 3-level tree. Every group should land with its parent_id intact.
        let mut existing: Vec<ConnectionGroup> = vec![];
        let incoming = build_tree();
        crate::commands::merge_groups(&mut existing, incoming);

        assert_eq!(existing.len(), 4);
        let a1a = existing.iter().find(|g| g.id == "A1a").unwrap();
        let a1 = existing.iter().find(|g| g.id == "A1").unwrap();
        let a = existing.iter().find(|g| g.id == "A").unwrap();
        let b = existing.iter().find(|g| g.id == "B").unwrap();

        assert_eq!(a1a.parent_id.as_deref(), Some("A1"));
        assert_eq!(a1.parent_id.as_deref(), Some("A"));
        assert_eq!(a.parent_id, None);
        assert_eq!(b.parent_id, None);
    }

    #[test]
    fn test_merge_groups_demotes_orphaned_parent_id_to_root() {
        // The JSON claims "A1a" is a child of "MISSING", which doesn't
        // exist in the payload nor locally. We must not import a dangling
        // pointer; instead we treat the orphan as a top-level group.
        let mut existing: Vec<ConnectionGroup> = vec![];
        let incoming = vec![ConnectionGroup {
            id: "A1a".into(),
            name: "A1a".into(),
            collapsed: false,
            sort_order: 0,
            parent_id: Some("MISSING".into()),
        }];
        crate::commands::merge_groups(&mut existing, incoming);

        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0].parent_id, None);
    }

    #[test]
    fn test_merge_groups_keeps_existing_parent_when_payload_overrides() {
        // The local config has "A" as a top-level group and "A1" as a
        // child of "A". The payload re-imports the same ids but renames
        // "A1" to "A-renamed". The child should still be a child of "A"
        // in the merged result, because the parent's id is unchanged.
        let mut existing = vec![
            ConnectionGroup {
                id: "A".into(),
                name: "A".into(),
                collapsed: false,
                sort_order: 0,
                parent_id: None,
            },
            ConnectionGroup {
                id: "A1".into(),
                name: "A1".into(),
                collapsed: false,
                sort_order: 0,
                parent_id: Some("A".into()),
            },
        ];
        let incoming = vec![ConnectionGroup {
            id: "A1".into(),
            name: "A-renamed".into(),
            collapsed: false,
            sort_order: 0,
            parent_id: Some("A".into()),
        }];
        crate::commands::merge_groups(&mut existing, incoming);

        assert_eq!(existing.len(), 2);
        let a1 = existing.iter().find(|g| g.id == "A1").unwrap();
        assert_eq!(a1.name, "A-renamed");
        assert_eq!(a1.parent_id.as_deref(), Some("A"));
    }

    #[test]
    fn test_merge_groups_is_idempotent() {
        // Re-applying the same payload must not create duplicates or
        // change the result beyond the first merge.
        let mut existing: Vec<ConnectionGroup> = vec![];
        let incoming = build_tree();
        crate::commands::merge_groups(&mut existing, incoming.clone());
        let snapshot = existing.clone();
        crate::commands::merge_groups(&mut existing, incoming);
        assert_eq!(existing, snapshot);
    }

    #[test]
    fn test_merge_groups_incoming_parent_in_existing_only() {
        // The payload brings "A1" with parent_id = "A", but "A" already
        // exists in the local config (created independently). The merge
        // must keep the link working: "A1" remains a child of "A".
        let mut existing = vec![ConnectionGroup {
            id: "A".into(),
            name: "A-existing".into(),
            collapsed: false,
            sort_order: 0,
            parent_id: None,
        }];
        let incoming = vec![ConnectionGroup {
            id: "A1".into(),
            name: "A1".into(),
            collapsed: false,
            sort_order: 0,
            parent_id: Some("A".into()),
        }];
        crate::commands::merge_groups(&mut existing, incoming);

        let a1 = existing.iter().find(|g| g.id == "A1").unwrap();
        let a = existing.iter().find(|g| g.id == "A").unwrap();
        assert_eq!(a1.parent_id.as_deref(), Some("A"));
        // Existing "A" was not in the payload, so it stays as the user
        // named it locally.
        assert_eq!(a.name, "A-existing");
    }
}
