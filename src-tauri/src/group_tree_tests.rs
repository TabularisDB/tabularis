//! Unit tests for the nested connection-group tree helpers in `commands.rs`.
//!
//! Covers the cycle detector and the `/`-separated path parser/lookup used
//! by `create_group_path`. Pure functions, so they don't need any Tauri
//! runtime or filesystem.

#[cfg(test)]
mod tests {
    use crate::commands::{find_child_group, parse_group_path, reject_if_would_create_cycle};
    use crate::models::{collect_group_ancestors, ConnectionGroup};

    fn g(id: &str, parent: Option<&str>) -> ConnectionGroup {
        ConnectionGroup {
            id: id.to_string(),
            name: id.to_string(),
            collapsed: false,
            sort_order: 0,
            parent_id: parent.map(|s| s.to_string()),
        }
    }

    #[test]
    fn cycle_check_none_parent_is_always_ok() {
        let groups = vec![g("a", None), g("b", Some("a")), g("c", Some("b"))];
        assert!(reject_if_would_create_cycle(&groups, "c", None).is_ok());
    }

    #[test]
    fn cycle_check_same_id_is_rejected() {
        let groups = vec![g("a", None)];
        let err = reject_if_would_create_cycle(&groups, "a", Some("a")).unwrap_err();
        assert!(err.to_lowercase().contains("cycle"));
    }

    #[test]
    fn cycle_check_direct_parent_is_rejected() {
        let groups = vec![g("a", Some("b")), g("b", None)];
        let err = reject_if_would_create_cycle(&groups, "b", Some("a")).unwrap_err();
        assert!(err.to_lowercase().contains("cycle"));
    }

    #[test]
    fn cycle_check_deep_descendant_is_rejected() {
        let groups = vec![
            g("a", Some("b")),
            g("b", Some("c")),
            g("c", None),
        ];
        let err = reject_if_would_create_cycle(&groups, "c", Some("a")).unwrap_err();
        assert!(err.to_lowercase().contains("cycle"));
    }

    #[test]
    fn cycle_check_unrelated_target_is_ok() {
        let groups = vec![
            g("a1", Some("a")),
            g("a", None),
            g("b1", Some("b")),
            g("b", None),
        ];
        assert!(reject_if_would_create_cycle(&groups, "a", Some("b")).is_ok());
    }

    #[test]
    fn cycle_check_handles_preexisting_cycle_safely() {
        let c = g("c", None);
        let groups = vec![g("a", Some("b")), g("b", Some("a")), c];
        let result = reject_if_would_create_cycle(&groups, "c", Some("a"));
        assert!(result.is_err());
    }

    #[test]
    fn cycle_check_target_not_in_tree_is_ok() {
        let groups = vec![g("a", None), g("b", Some("a"))];
        assert!(reject_if_would_create_cycle(&groups, "b", Some("a")).is_ok());
    }

    #[test]
    fn parse_group_path_splits_on_slash() {
        assert_eq!(
            parse_group_path("a/b/c").unwrap(),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn parse_group_path_trims_whitespace_and_skips_empty() {
        assert_eq!(
            parse_group_path("  a /  /  b  / ").unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn parse_group_path_rejects_empty_string() {
        assert!(parse_group_path("").is_err());
        assert!(parse_group_path("   /  /  ").is_err());
    }

    #[test]
    fn parse_group_path_keeps_single_segment() {
        assert_eq!(parse_group_path("lone").unwrap(), vec!["lone".to_string()]);
    }

    #[test]
    fn find_child_group_is_case_insensitive() {
        // The `g` helper uses the id as the name, so "Production" here
        // and a search for "production" should still match.
        let groups = vec![g("Production", None)];
        let found = find_child_group(&groups, "production", &None);
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "Production");
    }

    #[test]
    fn find_child_group_scopes_to_parent() {
        // Two groups named the same, but with different parents.
        let groups = vec![
            g("alpha", Some("parent-1")),
            g("alpha", Some("parent-2")),
        ];
        // Only the one under "parent-1" is found.
        let found = find_child_group(&groups, "alpha", &Some("parent-1".to_string()));
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "alpha");
        // Wrong parent yields None.
        let missing = find_child_group(&groups, "alpha", &None);
        assert!(missing.is_none());
    }

    #[test]
    fn group_ancestors_walks_up_to_the_root() {
        let groups = vec![g("root", None), g("mid", Some("root")), g("leaf", Some("mid"))];
        let kept = collect_group_ancestors(&groups, ["leaf"]);
        assert_eq!(
            kept,
            ["root", "mid", "leaf"].iter().map(|s| s.to_string()).collect()
        );
    }

    #[test]
    fn group_ancestors_ignores_unknown_ids() {
        let groups = vec![g("a", None)];
        let kept = collect_group_ancestors(&groups, ["nope"]);
        assert!(kept.is_empty());
    }

    #[test]
    fn group_ancestors_merges_multiple_leaves_without_duplicates() {
        let groups = vec![
            g("root", None),
            g("x", Some("root")),
            g("y", Some("root")),
            g("other", None),
        ];
        let kept = collect_group_ancestors(&groups, ["x", "y"]);
        assert_eq!(
            kept,
            ["root", "x", "y"].iter().map(|s| s.to_string()).collect()
        );
        assert!(!kept.contains("other"));
    }

    #[test]
    fn group_ancestors_terminates_on_cyclic_parents() {
        // Defensive: the backend rejects cycles, but the walker must not spin
        // forever if a corrupted file sneaks one in.
        let groups = vec![g("a", Some("b")), g("b", Some("a"))];
        let kept = collect_group_ancestors(&groups, ["a"]);
        assert_eq!(kept, ["a", "b"].iter().map(|s| s.to_string()).collect());
    }
}
