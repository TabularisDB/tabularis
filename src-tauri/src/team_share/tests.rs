use std::fs;

use super::merge::{merge_payload, MergeContext, MergeOutcome, TOMBSTONE_RETENTION_DAYS};
use super::vault::{
    self, KdfParams, VaultEntry, VaultGroup, VaultK8sProfile, VaultPayload, VaultSshProfile,
    VaultTag, DEFAULT_VAULT_FILENAME,
};
use crate::models::{
    ConnectionGroup, ConnectionParams, ConnectionTag, DatabaseSelection, K8sConnection,
    SshConnection,
};

fn ssh_profile(id: &str, host: &str, password: Option<&str>) -> SshConnection {
    SshConnection {
        id: id.to_string(),
        name: format!("tunnel-{id}"),
        host: host.to_string(),
        port: 22,
        user: "deploy".to_string(),
        auth_type: Some("password".to_string()),
        password: password.map(str::to_string),
        key_file: None,
        key_passphrase: None,
        allow_passphrase_prompt: None,
        save_in_keychain: Some(true),

    }
}

fn vault_ssh(id: &str, host: &str, password: Option<&str>, updated_at: &str) -> VaultSshProfile {
    VaultSshProfile {
        profile: ssh_profile(id, host, password),
        updated_at: updated_at.to_string(),
        updated_by: "alice@box".to_string(),
        deleted: false,
    }
}

fn ssh_payload(profiles: Vec<VaultSshProfile>) -> VaultPayload {
    VaultPayload {
        ssh_profiles: profiles,
        ..Default::default()
    }
}

/// Argon2 parameters that keep the crypto tests fast. The production
/// parameters live in `export_crypto` and are exercised by its own tests.
fn cheap_kdf() -> KdfParams {
    KdfParams {
        m_cost: 8,
        t_cost: 1,
        p_cost: 1,
        ..KdfParams::default()
    }
}

fn params(host: &str, password: Option<&str>) -> ConnectionParams {
    ConnectionParams {
        driver: "mysql".to_string(),
        host: Some(host.to_string()),
        port: Some(3306),
        username: Some("app".to_string()),
        password: password.map(str::to_string),
        database: DatabaseSelection::Single("shop".to_string()),
        ..Default::default()
    }
}

fn entry(id: &str, host: &str, password: Option<&str>, updated_at: &str) -> VaultEntry {
    VaultEntry {
        id: id.to_string(),
        name: format!("conn-{id}"),
        params: params(host, password),
        group_id: None,
        tag_ids: None,
        environment: None,
        detect_json_in_text_columns: None,
        appearance: None,
        updated_at: updated_at.to_string(),
        updated_by: "alice@box".to_string(),
        deleted: false,
    }
}

fn payload(entries: Vec<VaultEntry>) -> VaultPayload {
    VaultPayload {
        entries,
        ..Default::default()
    }
}

fn ctx() -> MergeContext {
    MergeContext {
        now: "2026-09-15T12:00:00.000Z".to_string(),
        actor: "bob@laptop".to_string(),
        tombstone_cutoff: "2026-06-17T00:00:00.000Z".to_string(),
    }
}

fn outcomes(notes: &[super::merge::MergeNote]) -> Vec<MergeOutcome> {
    notes.iter().map(|n| n.outcome).collect()
}

mod merge {
    use super::*;

    #[test]
    fn pulls_an_entry_a_teammate_added() {
        let base = VaultPayload::default();
        let remote = payload(vec![entry("a", "db.internal", Some("s3cret"), "T1")]);
        let local = VaultPayload::default();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.entries.len(), 1);
        assert_eq!(merged.entries[0].params.password.as_deref(), Some("s3cret"));
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PulledFromShare]);
    }

    #[test]
    fn pushes_an_entry_shared_here() {
        let base = VaultPayload::default();
        let remote = VaultPayload::default();
        let local = payload(vec![entry("a", "db.internal", Some("s3cret"), "T1")]);

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.entries.len(), 1);
        // The push is stamped with this machine's clock and identity.
        assert_eq!(merged.entries[0].updated_at, ctx().now);
        assert_eq!(merged.entries[0].updated_by, ctx().actor);
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PushedFromLocal]);
    }

    #[test]
    fn pulls_a_remote_edit_when_nothing_changed_here() {
        let base = payload(vec![entry("a", "old.host", Some("pw"), "T1")]);
        let remote = payload(vec![entry("a", "new.host", Some("pw"), "T2")]);
        let local = payload(vec![entry("a", "old.host", Some("pw"), "T1")]);

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.entries[0].params.host.as_deref(), Some("new.host"));
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PulledFromShare]);
    }

    #[test]
    fn local_wins_when_both_sides_changed() {
        let base = payload(vec![entry("a", "old.host", Some("pw"), "T1")]);
        let remote = payload(vec![entry("a", "their.host", Some("pw"), "T2")]);
        let local = payload(vec![entry("a", "my.host", Some("pw"), "T1")]);

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.entries[0].params.host.as_deref(), Some("my.host"));
        assert_eq!(merged.entries[0].updated_by, ctx().actor);
        assert_eq!(outcomes(&notes), vec![MergeOutcome::ConflictLocalWins]);
    }

    #[test]
    fn a_password_change_here_reaches_the_share() {
        let base = payload(vec![entry("a", "db", Some("old-pw"), "T1")]);
        let remote = payload(vec![entry("a", "db", Some("old-pw"), "T1")]);
        let local = payload(vec![entry("a", "db", Some("new-pw"), "T1")]);

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.entries[0].params.password.as_deref(), Some("new-pw"));
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PushedFromLocal]);
    }

    #[test]
    fn deleting_here_leaves_a_tombstone_without_credentials() {
        let base = payload(vec![entry("a", "db", Some("s3cret"), "T1")]);
        let remote = payload(vec![entry("a", "db", Some("s3cret"), "T1")]);
        let local = VaultPayload::default();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.entries.len(), 1);
        assert!(merged.entries[0].deleted);
        assert!(merged.entries[0].params.password.is_none());
        assert!(merged.entries[0].params.host.is_none());
        assert_eq!(outcomes(&notes), vec![MergeOutcome::TombstonedLocally]);
    }

    #[test]
    fn an_entry_never_synced_here_is_not_read_as_a_deletion() {
        // No base at all: a teammate's entry must be pulled, not tombstoned.
        let base = VaultPayload::default();
        let remote = payload(vec![entry("a", "db", Some("pw"), "T1")]);
        let local = VaultPayload::default();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert!(!merged.entries[0].deleted);
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PulledFromShare]);
    }

    #[test]
    fn identical_sides_without_a_base_are_not_a_conflict() {
        // The situation on a first unlock, or after the base cache was lost.
        let base = VaultPayload::default();
        let remote = payload(vec![entry("a", "db", Some("pw"), "T1")]);
        let local = payload(vec![entry("a", "db", Some("pw"), "T9")]);

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged, remote, "nothing should be rewritten");
        assert!(notes.is_empty(), "no note for two identical records");
    }

    #[test]
    fn a_remote_tombstone_keeps_its_original_stamp() {
        let mut tombstone = entry("a", "db", None, "T1");
        tombstone.deleted = true;
        let base = payload(vec![entry("a", "db", Some("pw"), "T0")]);
        let remote = payload(vec![tombstone.clone()]);
        let local = VaultPayload::default();

        let (merged, _) = merge_payload(&base, &remote, &local, &ctx());

        // Re-stamping on every sync would keep the tombstone alive forever.
        assert_eq!(merged.entries[0].updated_at, "T1");
    }

    #[test]
    fn expired_tombstones_are_dropped() {
        let mut old = entry("a", "db", None, "2020-01-01T00:00:00.000Z");
        old.deleted = true;
        let base = payload(vec![old.clone()]);
        let remote = payload(vec![old]);
        let local = VaultPayload::default();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert!(merged.entries.is_empty());
        assert_eq!(outcomes(&notes), vec![MergeOutcome::TombstoneExpired]);
        assert!(TOMBSTONE_RETENTION_DAYS > 0);
    }

    #[test]
    fn two_members_adding_different_connections_keep_both() {
        let base = VaultPayload::default();
        let remote = payload(vec![entry("theirs", "their.db", Some("pw1"), "T1")]);
        let local = payload(vec![entry("mine", "my.db", Some("pw2"), "T1")]);

        let (merged, _) = merge_payload(&base, &remote, &local, &ctx());

        let mut ids: Vec<&str> = merged.entries.iter().map(|e| e.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["mine", "theirs"]);
    }

    #[test]
    fn an_ssh_profile_travels_with_its_credentials() {
        // The point of sharing profiles at all: a teammate receiving the
        // connection must also receive a usable tunnel.
        let base = VaultPayload::default();
        let remote = ssh_payload(vec![vault_ssh("s1", "bastion.internal", Some("tunnel-pw"), "T1")]);
        let local = VaultPayload::default();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.ssh_profiles.len(), 1);
        assert_eq!(
            merged.ssh_profiles[0].profile.password.as_deref(),
            Some("tunnel-pw")
        );
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PulledFromShare]);
    }

    #[test]
    fn an_ssh_profile_edited_here_wins_a_conflict() {
        let base = ssh_payload(vec![vault_ssh("s1", "old.bastion", Some("pw"), "T1")]);
        let remote = ssh_payload(vec![vault_ssh("s1", "their.bastion", Some("pw"), "T2")]);
        let local = ssh_payload(vec![vault_ssh("s1", "my.bastion", Some("pw"), "T1")]);

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.ssh_profiles[0].profile.host, "my.bastion");
        assert_eq!(merged.ssh_profiles[0].updated_by, ctx().actor);
        assert_eq!(outcomes(&notes), vec![MergeOutcome::ConflictLocalWins]);
    }

    #[test]
    fn removing_an_ssh_profile_leaves_a_tombstone_without_credentials() {
        let base = ssh_payload(vec![vault_ssh("s1", "bastion", Some("tunnel-pw"), "T1")]);
        let remote = base.clone();
        let local = VaultPayload::default();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert!(merged.ssh_profiles[0].deleted);
        assert!(merged.ssh_profiles[0].profile.password.is_none());
        assert!(merged.ssh_profiles[0].profile.key_passphrase.is_none());
        assert_eq!(outcomes(&notes), vec![MergeOutcome::TombstonedLocally]);
    }

    #[test]
    fn an_unchanged_ssh_profile_is_not_rewritten() {
        // Guards against a sync loop: materialising a profile locally and
        // reading it back must compare equal to what the vault holds.
        let profile = vault_ssh("s1", "bastion", Some("pw"), "T1");
        let base = ssh_payload(vec![profile.clone()]);
        let remote = base.clone();
        let local = base.clone();

        let (merged, notes) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged, remote);
        assert!(notes.is_empty());
    }

    #[test]
    fn a_k8s_tunnel_travels_with_the_connection() {
        let profile = |name: &str, updated_at: &str| VaultK8sProfile {
            profile: K8sConnection {
                id: "k1".to_string(),
                name: name.to_string(),
                context: "prod-cluster".to_string(),
                namespace: "data".to_string(),
                resource_type: "service".to_string(),
                resource_name: "postgres".to_string(),
                port: 5432,
                kubectl_path: None,
                kubeconfig_path: None,

            },
            updated_at: updated_at.to_string(),
            updated_by: "alice@box".to_string(),
            deleted: false,
        };
        let payload = |profiles: Vec<VaultK8sProfile>| VaultPayload {
            k8s_profiles: profiles,
            ..Default::default()
        };

        // Pulled from the share when a teammate added it.
        let (merged, notes) = merge_payload(
            &VaultPayload::default(),
            &payload(vec![profile("prod", "T1")]),
            &VaultPayload::default(),
            &ctx(),
        );
        assert_eq!(merged.k8s_profiles[0].profile.resource_name, "postgres");
        assert_eq!(outcomes(&notes), vec![MergeOutcome::PulledFromShare]);

        // A remote edit lands when nothing changed here.
        let (merged, _) = merge_payload(
            &payload(vec![profile("prod", "T1")]),
            &payload(vec![profile("production", "T2")]),
            &payload(vec![profile("prod", "T1")]),
            &ctx(),
        );
        assert_eq!(merged.k8s_profiles[0].profile.name, "production");
    }

    #[test]
    fn groups_and_tags_merge_like_entries() {
        let group = |name: &str, updated_at: &str| VaultGroup {
            group: ConnectionGroup {
                id: "g1".to_string(),
                name: name.to_string(),
                collapsed: false,
                sort_order: 0,
                parent_id: None,
            },
            updated_at: updated_at.to_string(),
            deleted: false,
        };
        let tag = |name: &str, updated_at: &str| VaultTag {
            tag: ConnectionTag {
                id: "t1".to_string(),
                name: name.to_string(),
                color: "#f97316".to_string(),
            },
            updated_at: updated_at.to_string(),
            deleted: false,
        };

        let base = VaultPayload {
            groups: vec![group("Staging", "T1")],
            tags: vec![tag("legacy", "T1")],
            ..Default::default()
        };
        let remote = VaultPayload {
            groups: vec![group("Production", "T2")],
            tags: vec![tag("legacy", "T1")],
            ..Default::default()
        };
        let local = VaultPayload {
            groups: vec![group("Staging", "T1")],
            tags: vec![tag("critical", "T1")],
            ..Default::default()
        };

        let (merged, _) = merge_payload(&base, &remote, &local, &ctx());

        assert_eq!(merged.groups[0].group.name, "Production");
        assert_eq!(merged.tags[0].tag.name, "critical");
    }
}

mod vault_file {
    use super::*;

    fn seeded_payload() -> VaultPayload {
        payload(vec![entry("a", "db.internal", Some("s3cret"), "T1")])
    }

    #[test]
    fn the_right_password_opens_the_payload() {
        let kdf = cheap_kdf();
        let key = vault::derive_key("correct horse", &kdf).unwrap();
        let file = vault::create(kdf, &key, &seeded_payload()).unwrap();

        assert!(vault::verify_key(&file, &key));
        let opened = vault::open_payload(&file, &key).unwrap();
        assert_eq!(opened, seeded_payload());
    }

    #[test]
    fn a_wrong_password_is_rejected_before_the_payload_is_touched() {
        let kdf = cheap_kdf();
        let key = vault::derive_key("correct horse", &kdf).unwrap();
        let file = vault::create(kdf.clone(), &key, &seeded_payload()).unwrap();

        let wrong = vault::derive_key("battery staple", &kdf).unwrap();
        assert!(!vault::verify_key(&file, &wrong));
        assert!(vault::open_payload(&file, &wrong).is_err());
    }

    #[test]
    fn credentials_are_not_readable_in_the_file_itself() {
        let kdf = cheap_kdf();
        let key = vault::derive_key("pw", &kdf).unwrap();
        let file = vault::create(kdf, &key, &seeded_payload()).unwrap();

        let json = serde_json::to_string(&file).unwrap();
        assert!(!json.contains("s3cret"));
        assert!(!json.contains("db.internal"));
    }

    #[test]
    fn resealing_bumps_the_revision() {
        let kdf = cheap_kdf();
        let key = vault::derive_key("pw", &kdf).unwrap();
        let mut file = vault::create(kdf, &key, &VaultPayload::default()).unwrap();
        assert_eq!(file.revision, 1);

        vault::reseal(&mut file, &key, &seeded_payload()).unwrap();

        assert_eq!(file.revision, 2);
        assert_eq!(vault::open_payload(&file, &key).unwrap(), seeded_payload());
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DEFAULT_VAULT_FILENAME);
        let kdf = cheap_kdf();
        let key = vault::derive_key("pw", &kdf).unwrap();
        let file = vault::create(kdf, &key, &seeded_payload()).unwrap();

        vault::write(&path, &file).unwrap();
        let read_back = vault::read(&path).unwrap().unwrap();

        assert_eq!(read_back.revision, file.revision);
        assert_eq!(
            vault::open_payload(&read_back, &key).unwrap(),
            seeded_payload()
        );
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
    }

    #[test]
    fn overwriting_an_existing_vault_works() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DEFAULT_VAULT_FILENAME);
        let kdf = cheap_kdf();
        let key = vault::derive_key("pw", &kdf).unwrap();
        let mut file = vault::create(kdf, &key, &VaultPayload::default()).unwrap();

        vault::write(&path, &file).unwrap();
        vault::reseal(&mut file, &key, &seeded_payload()).unwrap();
        vault::write(&path, &file).unwrap();

        let read_back = vault::read(&path).unwrap().unwrap();
        assert_eq!(read_back.revision, 2);
    }

    #[test]
    fn a_missing_vault_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(vault::read(&dir.path().join("nothing.json")).unwrap().is_none());
    }

    #[test]
    fn a_foreign_json_file_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("other.json");
        fs::write(&path, r#"{"hello":"world"}"#).unwrap();
        assert!(vault::read(&path).is_err());
    }

    #[test]
    fn the_base_cache_round_trips_and_ignores_another_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(vault::BASE_CACHE_FILENAME);
        let kdf = cheap_kdf();
        let key = vault::derive_key("pw", &kdf).unwrap();
        let other = vault::derive_key("другой", &kdf).unwrap();

        let cache = vault::seal_base_cache(&key, 7, &seeded_payload()).unwrap();
        fs::write(&path, serde_json::to_string(&cache).unwrap()).unwrap();

        assert_eq!(
            vault::read_base_cache(&path, &key),
            Some(seeded_payload()),
            "the owner reads its own base"
        );
        assert_eq!(
            vault::read_base_cache(&path, &other),
            None,
            "a base sealed with another key is ignored, never guessed"
        );
    }

    #[test]
    fn a_folder_resolves_to_the_default_file_name() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            vault::resolve_vault_path(dir.path()),
            dir.path().join(DEFAULT_VAULT_FILENAME)
        );
        let explicit = dir.path().join("team.json");
        assert_eq!(vault::resolve_vault_path(&explicit), explicit);
    }
}

mod locking {
    use super::*;

    #[test]
    fn a_second_holder_is_refused_and_the_lock_frees_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DEFAULT_VAULT_FILENAME);
        let lock_path = vault::lock_path_for(&path);

        let held = vault::VaultLock::acquire(&path).unwrap();
        assert!(lock_path.is_file());

        // Simulate the contended case without waiting out the retry budget:
        // the lock file exists, so creating it exclusively must fail.
        assert!(fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .is_err());

        drop(held);
        assert!(!lock_path.exists(), "the lock must not outlive its holder");
        vault::VaultLock::acquire(&path).unwrap();
    }

    #[test]
    fn a_stale_lock_is_broken() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DEFAULT_VAULT_FILENAME);
        let lock_path = vault::lock_path_for(&path);
        fs::write(&lock_path, "someone who crashed").unwrap();

        // Age the lock past the staleness threshold.
        let stale = std::time::SystemTime::now() - std::time::Duration::from_secs(600);
        filetime::set_file_mtime(&lock_path, filetime::FileTime::from_system_time(stale)).unwrap();

        let lock = vault::VaultLock::acquire(&path).expect("a stale lock must not block the team");
        drop(lock);
    }
}

mod appearance {
    use super::*;
    use crate::models::{ConnectionAppearance, IconOverride};

    fn look(icon: Option<IconOverride>, color: Option<&str>) -> ConnectionAppearance {
        ConnectionAppearance {
            icon,
            accent_color: color.map(str::to_string),
        }
    }

    #[test]
    fn a_colour_and_an_emoji_are_shareable() {
        let local = look(
            Some(IconOverride::Emoji {
                value: "🐘".to_string(),
            }),
            Some("#f97316"),
        );
        assert_eq!(vault::strip_local_appearance(Some(&local)), Some(local));
    }

    #[test]
    fn an_uploaded_image_does_not_travel_but_its_colour_does() {
        // The path points into this machine's data directory; a teammate
        // would resolve it to nothing.
        let local = look(
            Some(IconOverride::Image {
                path: "connection-icons/abc.png".to_string(),
            }),
            Some("#f97316"),
        );
        let shared = vault::strip_local_appearance(Some(&local)).unwrap();
        assert!(shared.icon.is_none());
        assert_eq!(shared.accent_color.as_deref(), Some("#f97316"));
    }

    #[test]
    fn an_image_with_nothing_else_leaves_nothing_to_share() {
        let local = look(
            Some(IconOverride::Image {
                path: "connection-icons/abc.png".to_string(),
            }),
            None,
        );
        assert_eq!(vault::strip_local_appearance(Some(&local)), None);
        assert_eq!(vault::strip_local_appearance(None), None);
    }

    #[test]
    fn the_teams_look_wins_over_the_members_one() {
        let shared = look(
            Some(IconOverride::Pack {
                id: "postgres".to_string(),
            }),
            Some("#2563eb"),
        );
        let local = look(None, Some("#dc2626"));
        let merged = vault::merge_appearance(Some(&shared), Some(&local)).unwrap();
        assert_eq!(merged, shared);
    }

    #[test]
    fn a_members_uploaded_image_survives_a_team_without_an_icon() {
        // The share cannot carry an image, so overwriting one with nothing
        // would silently undo a choice the member cannot get back.
        let image = IconOverride::Image {
            path: "connection-icons/abc.png".to_string(),
        };
        let shared = look(None, Some("#2563eb"));
        let local = look(Some(image.clone()), None);

        let merged = vault::merge_appearance(Some(&shared), Some(&local)).unwrap();
        assert_eq!(merged.icon, Some(image.clone()));
        assert_eq!(merged.accent_color.as_deref(), Some("#2563eb"));

        // And with no team appearance at all it is still kept.
        let merged = vault::merge_appearance(None, Some(&local)).unwrap();
        assert_eq!(merged.icon, Some(image));
    }

    #[test]
    fn nothing_anywhere_stays_nothing() {
        assert_eq!(vault::merge_appearance(None, None), None);
    }
}

