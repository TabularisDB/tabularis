use super::*;
use crate::application::ConnectionAction as A;
use ManagedAccess::{Action, Unrestricted};

/// (command, group, expected managed-mode treatment). Every command of the
/// connection-related groups must appear here.
const MATRIX: &[(&str, &str, ManagedAccess)] = &[
    ("set_selected_databases", "connection", Unrestricted),
    ("get_connection_by_id", "connection", Unrestricted),
    ("get_connections_with_groups", "connection", Unrestricted),
    ("save_connection", "connection", Action(A::Create)),
    ("update_connection", "connection", Action(A::Update)),
    ("delete_connection", "connection", Action(A::Delete)),
    ("duplicate_connection", "connection", Action(A::Duplicate)),
    (
        "set_connection_appearance",
        "connection",
        Action(A::EditBranding),
    ),
    (
        "save_connection_icon",
        "connection",
        Action(A::EditBranding),
    ),
    (
        "delete_connection_icon",
        "connection",
        Action(A::EditBranding),
    ),
    ("get_connection_groups", "connection", Unrestricted),
    (
        "create_connection_group",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "create_group_path",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "update_connection_group",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "move_group_to_parent",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "delete_connection_group",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "move_connection_to_group",
        "connection",
        Action(A::EditOrganization),
    ),
    ("reorder_groups", "connection", Action(A::EditOrganization)),
    (
        "reorder_connections_in_group",
        "connection",
        Action(A::EditOrganization),
    ),
    ("list_connection_tags", "connection", Unrestricted),
    (
        "create_connection_tag",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "update_connection_tag",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "delete_connection_tag",
        "connection",
        Action(A::EditOrganization),
    ),
    (
        "set_connection_tags",
        "connection",
        Action(A::EditOrganization),
    ),
    ("get_registered_drivers", "connection", Unrestricted),
    ("get_driver_manifest", "connection", Unrestricted),
    ("get_active_connections", "connection", Unrestricted),
    ("register_active_connection", "connection", Unrestricted),
    ("disconnect_connection", "connection", Unrestricted),
    ("test_connection", "connection", Action(A::TestWithParams)),
    ("list_databases", "connection", Action(A::TestWithParams)),
    ("export_connections_file", "files", Action(A::Export)),
    ("list_connection_import_sources", "files", Action(A::Import)),
    ("preview_connection_import", "files", Action(A::Import)),
    ("apply_connection_import", "files", Action(A::Import)),
    ("preview_tabularis_import_file", "files", Action(A::Import)),
    (
        "apply_prepared_tabularis_import",
        "files",
        Action(A::Import),
    ),
    ("get_connections_backup_status", "files", Action(A::Export)),
    ("get_database_backup_status", "files", Action(A::Export)),
    ("run_database_backup_now", "files", Action(A::Export)),
    ("cancel_database_backup", "files", Action(A::Export)),
    (
        "set_connections_backup_password",
        "files",
        Action(A::Export),
    ),
    (
        "set_connections_backup_target_password",
        "files",
        Action(A::Export),
    ),
    ("run_connections_backup", "files", Action(A::Export)),
    ("get_ssh_connections", "tunnel", Unrestricted),
    ("save_ssh_connection", "tunnel", Action(A::Create)),
    ("update_ssh_connection", "tunnel", Action(A::Update)),
    ("delete_ssh_connection", "tunnel", Action(A::Delete)),
    ("test_ssh_connection", "tunnel", Action(A::TestWithParams)),
    ("respond_ssh_askpass", "tunnel", Unrestricted),
    ("get_k8s_connections", "tunnel", Unrestricted),
    ("save_k8s_connection", "tunnel", Action(A::Create)),
    ("update_k8s_connection", "tunnel", Action(A::Update)),
    ("delete_k8s_connection", "tunnel", Action(A::Delete)),
    (
        "test_k8s_connection_cmd",
        "tunnel",
        Action(A::TestWithParams),
    ),
    ("get_k8s_contexts_cmd", "tunnel", Action(A::TestWithParams)),
    (
        "get_k8s_namespaces_cmd",
        "tunnel",
        Action(A::TestWithParams),
    ),
    ("get_k8s_resources_cmd", "tunnel", Action(A::TestWithParams)),
    (
        "get_k8s_resource_ports_cmd",
        "tunnel",
        Action(A::TestWithParams),
    ),
    ("validate_k8s_path_cmd", "tunnel", Action(A::TestWithParams)),
    (
        "test_ssm_connection_cmd",
        "tunnel",
        Action(A::TestWithParams),
    ),
];

const SAMPLE_UNRESTRICTED: &[&str] = &[
    "get_connections",
    "execute_query",
    "get_tables",
    "get_columns",
    "set_last_active_connection",
    "get_saved_queries",
    "export_table_to_sql",
    "dump_database",
];

#[test]
fn every_matrix_command_resolves_to_its_expected_treatment() {
    for (name, _, expected) in MATRIX {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("{name} is not a command"));
        assert_eq!(access(command), *expected, "{name}");
    }
}

#[test]
fn ordinary_database_commands_stay_unrestricted() {
    for name in SAMPLE_UNRESTRICTED {
        let command = RpcCommand::parse(name).unwrap_or_else(|| panic!("{name} is not a command"));
        assert_eq!(access(command), Unrestricted, "{name}");
    }
}

/// The names a group's `parse` function accepts, read from the source so a
/// command added there without a policy entry fails this test.
fn parsed_names(group: &str) -> Vec<String> {
    let source = include_str!("rpc.rs");
    let start = source
        .find(&format!("impl {group} {{\n    fn parse"))
        .unwrap_or_else(|| panic!("no parse function for {group}"));
    let block = &source[start..];
    let end = block
        .find("_ => return None")
        .expect("parse has no fallback");
    block[..end]
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix('"')?;
            let (name, tail) = rest.split_once('"')?;
            tail.trim_start()
                .starts_with("=>")
                .then(|| name.to_string())
        })
        .collect()
}

#[test]
fn guard_every_connection_command_has_a_policy_entry() {
    for (group, source_group) in [
        ("connection", "ConnectionRpcCommand"),
        ("files", "ConnectionFilesRpcCommand"),
        ("tunnel", "TunnelRpcCommand"),
    ] {
        let mut parsed = parsed_names(source_group);
        let mut listed: Vec<String> = MATRIX
            .iter()
            .filter(|(_, matrix_group, _)| *matrix_group == group)
            .map(|(name, _, _)| name.to_string())
            .collect();
        assert!(!parsed.is_empty(), "{source_group} parsed no commands");
        parsed.sort();
        listed.sort();
        assert_eq!(
            parsed, listed,
            "{source_group} commands and the policy matrix disagree: give every new command an entry"
        );
    }
}

#[test]
fn standalone_authorizes_every_matrix_command() {
    let policy = ManagedConnectionPolicy::standalone();
    for (name, _, _) in MATRIX {
        let command = RpcCommand::parse(name).unwrap();
        assert!(authorize(&policy, command).is_ok(), "{name}");
    }
}

#[test]
fn managed_only_denies_exactly_the_connection_management_commands() {
    let policy = ManagedConnectionPolicy::managed_only();
    for (name, _, expected) in MATRIX {
        let command = RpcCommand::parse(name).unwrap();
        let result = authorize(&policy, command);
        match expected {
            Unrestricted => assert!(result.is_ok(), "{name} must stay usable"),
            Action(action) => {
                assert_eq!(result.unwrap_err().action, *action, "{name}");
            }
        }
    }
}

#[test]
fn the_switches_open_only_their_own_commands() {
    let policy = ManagedConnectionPolicy::managed_only()
        .with_branding_allowed(true)
        .with_organization_allowed(true);
    for (name, _, expected) in MATRIX {
        let command = RpcCommand::parse(name).unwrap();
        let result = authorize(&policy, command);
        let opened = matches!(
            expected,
            Unrestricted | Action(A::EditBranding) | Action(A::EditOrganization)
        );
        assert_eq!(result.is_ok(), opened, "{name}");
    }
}
