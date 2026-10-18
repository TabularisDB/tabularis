use std::sync::Arc;

use tauri::{AppHandle, Wry};

use super::*;
use crate::models::{ConnectionParams, ConnectionsFile, SavedConnection, SshConnection};

fn connection(id: &str, managed_by: Option<&str>) -> SavedConnection {
    SavedConnection {
        id: id.to_string(),
        name: format!("conn-{id}"),
        params: ConnectionParams::default(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
        managed_by: managed_by.map(str::to_string),
    }
}

fn ssh_profile() -> SshConnection {
    SshConnection {
        id: "s1".to_string(),
        name: "bastion".to_string(),
        host: "bastion.internal".to_string(),
        port: 22,
        user: "deploy".to_string(),
        auth_type: Some("password".to_string()),
        password: Some("pw".to_string()),
        key_file: None,
        key_passphrase: Some("phrase".to_string()),
        allow_passphrase_prompt: None,
        save_in_keychain: Some(true),
        managed_by: None,
    }
}

mod stripping {
    use super::*;

    #[test]
    fn removes_every_connection_secret_and_the_keychain_marker() {
        let mut p = ConnectionParams {
            host: Some("db".to_string()),
            password: Some("pw".to_string()),
            ssh_password: Some("ssh-pw".to_string()),
            ssh_key_passphrase: Some("phrase".to_string()),
            connection_uri: Some("mysql://user:pw@db/shop".to_string()),
            connection_uri_in_keychain: Some(true),
            ..ConnectionParams::default()
        };

        strip_connection_secrets(&mut p);

        assert!(p.password.is_none());
        assert!(p.ssh_password.is_none());
        assert!(p.ssh_key_passphrase.is_none());
        assert!(p.connection_uri.is_none());
        assert!(p.connection_uri_in_keychain.is_none());
        // Non-secret parameters survive: they are what the source shares.
        assert_eq!(p.host.as_deref(), Some("db"));
    }

    #[test]
    fn leaves_an_ssh_profile_reachable() {
        let mut profile = ssh_profile();

        strip_ssh_secrets(&mut profile);

        assert!(profile.password.is_none());
        assert!(profile.key_passphrase.is_none());
        assert_eq!(profile.host, "bastion.internal");
        assert_eq!(profile.port, 22);
        assert_eq!(profile.user, "deploy");
    }
}

mod lookup {
    use super::*;

    #[test]
    fn finds_the_source_of_a_connection_by_id() {
        let file = ConnectionsFile {
            connections: vec![
                connection("local", None),
                connection("shared", Some("team-share")),
            ],
            ..ConnectionsFile::default()
        };

        assert_eq!(
            connection_manager(&file, "shared").as_deref(),
            Some("team-share")
        );
        assert_eq!(connection_manager(&file, "local"), None);
        assert_eq!(connection_manager(&file, "missing"), None);
    }

    #[test]
    fn a_managed_flag_is_what_makes_a_record_managed() {
        assert!(connection("a", Some("team-share")).is_managed());
        assert!(!connection("b", None).is_managed());
        let mut profile = ssh_profile();
        assert!(!profile.is_managed());
        profile.managed_by = Some("team-share".to_string());
        assert!(profile.is_managed());
    }

    /// A source whose methods are never called: only the registry is tested.
    struct Inert;

    impl CredentialProvider<Wry> for Inert {
        fn is_available(&self, _: &AppHandle<Wry>) -> bool {
            unreachable!()
        }
        fn connection_secrets(
            &self,
            _: &AppHandle<Wry>,
            _: &mut SavedConnection,
        ) -> Result<(), String> {
            unreachable!()
        }
        fn ssh_secrets(&self, _: &AppHandle<Wry>, _: &mut SshConnection) -> Result<(), String> {
            unreachable!()
        }
        fn unavailable_error(&self, _: &AppHandle<Wry>, _: ManagedKind) -> String {
            unreachable!()
        }
    }

    impl ConnectionSource<Wry> for Inert {
        fn local_change(&self, _: &AppHandle<Wry>, _: ManagedKind, _: &str, _: ManagedChange<'_>) {
            unreachable!()
        }
    }

    #[test]
    fn the_registry_answers_only_for_registered_ids() {
        let registry = ManagedRegistry::<Wry>::default().with("team-share", Arc::new(Inert));

        assert!(registry.get("team-share").is_some());
        assert!(registry.get("some-plugin").is_none());
    }
}

mod messages {
    use super::*;

    #[test]
    fn a_team_share_connection_over_mcp_says_why_it_cannot_work() {
        let message = unavailable_outside_app_message("team-share", "prod");
        assert!(message.contains("prod"));
        assert!(message.contains("shared with your team"));
        assert!(message.contains("MCP"));
    }

    #[test]
    fn an_unknown_source_is_named_in_the_message() {
        let message = unavailable_outside_app_message("vault-plugin", "prod");
        assert!(message.contains("vault-plugin"));
        assert!(missing_source_message("vault-plugin").contains("vault-plugin"));
    }
}
