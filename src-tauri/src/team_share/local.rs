//! The local side of the team share, as pure functions: what this machine's
//! files say about the shared records, and how a merged payload is written
//! back into them.
//!
//! Nothing here touches the disk, the keychain or Tauri state, so every rule —
//! which records travel, what a teammate's deletion may remove here — is
//! tested directly in `tests.rs`.

use std::collections::{HashMap, HashSet};

use crate::models::{
    collect_group_ancestors, ConnectionsFile, K8sConnection, SavedConnection, SshConnection,
};

use super::secrets::{EntrySecrets, SshSecrets};
use super::vault::{
    self, VaultEntry, VaultGroup, VaultK8sProfile, VaultPayload, VaultSshProfile, VaultTag,
};
use super::SOURCE_ID;

/// True when a record's `managed_by` names the team share. A record owned by
/// another source is none of the team share's business.
pub fn is_team(managed_by: &Option<String>) -> bool {
    managed_by.as_deref() == Some(SOURCE_ID)
}

fn team_flag() -> Option<String> {
    Some(SOURCE_ID.to_string())
}

/// The credentials of the shared records, as held while the share is open.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SecretMaps {
    pub connections: HashMap<String, EntrySecrets>,
    pub ssh: HashMap<String, SshSecrets>,
}

/// The local files, as read for a sync.
#[derive(Debug, Clone, Default)]
pub struct LocalFiles {
    pub connections: ConnectionsFile,
    pub ssh: Vec<SshConnection>,
    pub k8s: Vec<K8sConnection>,
}

fn find_entry<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultEntry> {
    payload.entries.iter().find(|e| e.id == id)
}

fn find_group<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultGroup> {
    payload.groups.iter().find(|g| g.group.id == id)
}

fn find_tag<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultTag> {
    payload.tags.iter().find(|t| t.tag.id == id)
}

fn find_ssh_profile<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultSshProfile> {
    payload.ssh_profiles.iter().find(|p| p.profile.id == id)
}

fn find_k8s_profile<'a>(payload: &'a VaultPayload, id: &str) -> Option<&'a VaultK8sProfile> {
    payload.k8s_profiles.iter().find(|p| p.profile.id == id)
}

/// Build the payload describing what this machine holds right now: the
/// connections owned by the team share, with their in-memory credentials,
/// plus the groups, tags, SSH profiles and K8s tunnels they need.
///
/// `base` is the payload of the last sync. Its stamps are carried over so an
/// untouched record stays byte-identical to it, and its SSH and K8s records
/// keep travelling while they still exist here, so unsharing the last
/// connection using a profile does not delete it for the team.
pub fn build_payload(
    files: &LocalFiles,
    secrets: &SecretMaps,
    base: &VaultPayload,
) -> VaultPayload {
    let file = &files.connections;

    let mut entries = Vec::new();
    for connection in file.connections.iter().filter(|c| is_team(&c.managed_by)) {
        let mut params = connection.params.clone();
        params.connection_id = None;
        if let Some(secrets) = secrets.connections.get(&connection.id) {
            secrets.apply_to(&mut params);
        }
        let previous = find_entry(base, &connection.id);
        entries.push(VaultEntry {
            id: connection.id.clone(),
            name: connection.name.clone(),
            params,
            group_id: connection.group_id.clone(),
            tag_ids: connection.tag_ids.clone(),
            environment: connection.environment.clone(),
            detect_json_in_text_columns: connection.detect_json_in_text_columns,
            appearance: vault::strip_local_appearance(connection.appearance.as_ref()),
            // Stamps are rewritten by the merge whenever the content actually
            // differs, so carrying the previous ones over keeps an untouched
            // record byte-identical to its base.
            updated_at: previous
                .map(|e| e.updated_at.clone())
                .unwrap_or_else(vault::now_timestamp),
            updated_by: previous
                .map(|e| e.updated_by.clone())
                .unwrap_or_else(vault::current_actor),
            deleted: false,
        });
    }

    // A group is on the share exactly while it holds a shared connection,
    // directly or through a descendant — the ancestor chain comes along so the
    // hierarchy is not orphaned. A group that loses its last shared connection
    // drops out here and is tombstoned by the merge, so the team does not
    // accumulate empty folders.
    let wanted_groups = collect_group_ancestors(
        &file.groups,
        entries.iter().filter_map(|e| e.group_id.as_deref()),
    );
    let groups = file
        .groups
        .iter()
        .filter(|g| wanted_groups.contains(&g.id))
        .map(|g| VaultGroup {
            group: g.clone(),
            updated_at: find_group(base, &g.id)
                .map(|v| v.updated_at.clone())
                .unwrap_or_else(vault::now_timestamp),
            deleted: false,
        })
        .collect();

    // Same rule for tags: only the ones a shared connection actually wears.
    let wanted_tags: HashSet<String> = entries
        .iter()
        .flat_map(|e| e.tag_ids.iter().flatten())
        .cloned()
        .collect();
    let tags = file
        .tags
        .iter()
        .filter(|t| wanted_tags.contains(&t.id))
        .map(|t| VaultTag {
            tag: t.clone(),
            updated_at: find_tag(base, &t.id)
                .map(|v| v.updated_at.clone())
                .unwrap_or_else(vault::now_timestamp),
            deleted: false,
        })
        .collect();

    let mut wanted_ssh: HashSet<String> = entries
        .iter()
        .filter(|entry| entry.params.ssh_enabled.unwrap_or(false))
        .filter_map(|entry| entry.params.ssh_connection_id.clone())
        .collect();
    wanted_ssh.extend(base.ssh_profiles.iter().map(|p| p.profile.id.clone()));
    let ssh_profiles = files
        .ssh
        .iter()
        .filter(|profile| wanted_ssh.contains(&profile.id))
        .map(|profile| {
            let previous = find_ssh_profile(base, &profile.id);
            let mut profile = profile.clone();
            // Which source owns the profile is this machine's bookkeeping,
            // not something the team agrees on.
            profile.managed_by = None;
            if let Some(secrets) = secrets.ssh.get(&profile.id) {
                secrets.apply_to(&mut profile);
            }
            VaultSshProfile {
                profile,
                updated_at: previous
                    .map(|p| p.updated_at.clone())
                    .unwrap_or_else(vault::now_timestamp),
                updated_by: previous
                    .map(|p| p.updated_by.clone())
                    .unwrap_or_else(vault::current_actor),
                deleted: false,
            }
        })
        .collect();

    let mut wanted_k8s: HashSet<String> = entries
        .iter()
        .filter(|entry| entry.params.k8s_enabled.unwrap_or(false))
        .filter_map(|entry| entry.params.k8s_connection_id.clone())
        .collect();
    wanted_k8s.extend(base.k8s_profiles.iter().map(|p| p.profile.id.clone()));
    let k8s_profiles = files
        .k8s
        .iter()
        .filter(|profile| wanted_k8s.contains(&profile.id))
        .map(|profile| {
            let previous = find_k8s_profile(base, &profile.id);
            let mut profile = profile.clone();
            profile.managed_by = None;
            VaultK8sProfile {
                profile,
                updated_at: previous
                    .map(|p| p.updated_at.clone())
                    .unwrap_or_else(vault::now_timestamp),
                updated_by: previous
                    .map(|p| p.updated_by.clone())
                    .unwrap_or_else(vault::current_actor),
                deleted: false,
            }
        })
        .collect();

    VaultPayload {
        entries,
        groups,
        tags,
        ssh_profiles,
        k8s_profiles,
    }
}

/// Write a merged payload into the local files, keeping the secrets out of
/// them, and return those secrets for the in-memory maps.
///
/// Local-only decoration (`appearance` images, `sort_order`) survives, so a
/// member's own preferences are not overwritten by a teammate's sync. A
/// teammate's deletion only ever reaches records owned by the team share:
/// local connections that happen to share an id, or that sit in a group or
/// wear a tag the team dropped, keep their organisation.
pub fn apply_payload(files: &mut LocalFiles, payload: &VaultPayload) -> SecretMaps {
    let mut secrets = SecretMaps::default();
    apply_entries(&mut files.connections, payload, &mut secrets.connections);
    apply_groups(&mut files.connections, payload);
    apply_tags(&mut files.connections, payload);
    apply_ssh_profiles(&mut files.ssh, payload, &mut secrets.ssh);
    apply_k8s_profiles(&mut files.k8s, payload);
    secrets
}

fn apply_entries(
    file: &mut ConnectionsFile,
    payload: &VaultPayload,
    secrets: &mut HashMap<String, EntrySecrets>,
) {
    for entry in &payload.entries {
        if entry.deleted {
            file.connections
                .retain(|c| c.id != entry.id || !is_team(&c.managed_by));
            continue;
        }
        secrets.insert(entry.id.clone(), EntrySecrets::from_params(&entry.params));

        let mut params = entry.params.clone();
        crate::managed::strip_connection_secrets(&mut params);
        params.connection_id = None;

        let existing = file.connections.iter().find(|c| c.id == entry.id);
        let connection = SavedConnection {
            id: entry.id.clone(),
            name: entry.name.clone(),
            params,
            group_id: entry.group_id.clone(),
            // Ordering stays a per-member preference; the look does not.
            sort_order: existing.and_then(|c| c.sort_order),
            detect_json_in_text_columns: entry.detect_json_in_text_columns,
            appearance: vault::merge_appearance(
                entry.appearance.as_ref(),
                existing.and_then(|c| c.appearance.as_ref()),
            ),
            tag_ids: entry.tag_ids.clone(),
            environment: entry.environment.clone(),
            managed_by: team_flag(),
        };
        match file.connections.iter_mut().find(|c| c.id == entry.id) {
            Some(slot) => *slot = connection,
            None => file.connections.push(connection),
        }
    }
}

fn apply_groups(file: &mut ConnectionsFile, payload: &VaultPayload) {
    let mut removed: HashSet<String> = HashSet::new();
    for group in &payload.groups {
        let id = &group.group.id;
        if !group.deleted {
            match file.groups.iter_mut().find(|g| &g.id == id) {
                Some(slot) => *slot = group.group.clone(),
                None => file.groups.push(group.group.clone()),
            }
            continue;
        }
        // The team dropped the group: the shared connections leave it…
        for connection in file
            .connections
            .iter_mut()
            .filter(|c| is_team(&c.managed_by))
        {
            if connection.group_id.as_ref() == Some(id) {
                connection.group_id = None;
            }
        }
        // …but it stays here while a local connection still sits in it, or
        // in one of its subgroups.
        let still_used = collect_group_ancestors(
            &file.groups,
            file.connections
                .iter()
                .filter(|c| !is_team(&c.managed_by))
                .filter_map(|c| c.group_id.as_deref()),
        );
        if !still_used.contains(id) {
            file.groups.retain(|g| &g.id != id);
            removed.insert(id.clone());
        }
    }
    // A subgroup of a group that is gone becomes a root instead of pointing
    // at nothing.
    if !removed.is_empty() {
        for group in &mut file.groups {
            if group
                .parent_id
                .as_ref()
                .is_some_and(|p| removed.contains(p))
            {
                group.parent_id = None;
            }
        }
    }
}

fn apply_tags(file: &mut ConnectionsFile, payload: &VaultPayload) {
    for tag in &payload.tags {
        let id = &tag.tag.id;
        if !tag.deleted {
            match file.tags.iter_mut().find(|t| &t.id == id) {
                Some(slot) => *slot = tag.tag.clone(),
                None => file.tags.push(tag.tag.clone()),
            }
            continue;
        }
        for connection in file
            .connections
            .iter_mut()
            .filter(|c| is_team(&c.managed_by))
        {
            if let Some(ids) = connection.tag_ids.as_mut() {
                ids.retain(|t| t != id);
            }
        }
        let still_worn = file
            .connections
            .iter()
            .any(|c| c.tag_ids.iter().flatten().any(|t| t == id));
        if !still_worn {
            file.tags.retain(|t| &t.id != id);
        }
    }
}

fn apply_ssh_profiles(
    profiles: &mut Vec<SshConnection>,
    payload: &VaultPayload,
    secrets: &mut HashMap<String, SshSecrets>,
) {
    for shared in &payload.ssh_profiles {
        let id = &shared.profile.id;
        if shared.deleted {
            profiles.retain(|p| &p.id != id || !is_team(&p.managed_by));
            continue;
        }
        secrets.insert(id.clone(), SshSecrets::from_profile(&shared.profile));

        let mut profile = shared.profile.clone();
        crate::managed::strip_ssh_secrets(&mut profile);
        profile.managed_by = team_flag();
        match profiles.iter_mut().find(|p| &p.id == id) {
            Some(slot) => *slot = profile,
            None => profiles.push(profile),
        }
    }
}

fn apply_k8s_profiles(profiles: &mut Vec<K8sConnection>, payload: &VaultPayload) {
    for shared in &payload.k8s_profiles {
        let id = &shared.profile.id;
        if shared.deleted {
            profiles.retain(|p| &p.id != id || !is_team(&p.managed_by));
            continue;
        }
        let mut profile = shared.profile.clone();
        profile.managed_by = team_flag();
        match profiles.iter_mut().find(|p| &p.id == id) {
            Some(slot) => *slot = profile,
            None => profiles.push(profile),
        }
    }
}

/// The SSH profiles and K8s tunnels that must be on the share for `file`: the
/// ones a shared connection goes through.
pub fn wanted_profiles(file: &ConnectionsFile) -> (HashSet<String>, HashSet<String>) {
    let shared = file.connections.iter().filter(|c| is_team(&c.managed_by));
    let mut ssh = HashSet::new();
    let mut k8s = HashSet::new();
    for connection in shared {
        if connection.params.ssh_enabled.unwrap_or(false) {
            if let Some(id) = &connection.params.ssh_connection_id {
                ssh.insert(id.clone());
            }
        }
        if connection.params.k8s_enabled.unwrap_or(false) {
            if let Some(id) = &connection.params.k8s_connection_id {
                k8s.insert(id.clone());
            }
        }
    }
    (ssh, k8s)
}

/// Bring the K8s tunnels in line with which connections are shared. A tunnel
/// holds no credentials, so joining or leaving is only the flag. Returns
/// whether anything changed.
pub fn reconcile_k8s_flags(profiles: &mut [K8sConnection], wanted: &HashSet<String>) -> bool {
    let mut changed = false;
    for profile in profiles.iter_mut() {
        let should_share = wanted.contains(&profile.id);
        let is_shared = is_team(&profile.managed_by);
        // A tunnel owned by another source is left alone.
        if should_share == is_shared || (profile.managed_by.is_some() && !is_shared) {
            continue;
        }
        profile.managed_by = should_share.then(team_flag).flatten();
        changed = true;
    }
    changed
}

/// What leaving the share does to the local files.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct LeaveOutcome {
    /// Connections and profiles whose credentials were put back on them, for
    /// the caller to move into the keychain where they ask for it.
    pub restored_connections: Vec<String>,
    pub restored_ssh_profiles: Vec<String>,
    /// Kept records that could not get their credentials back because the
    /// share was locked.
    pub kept_without_credentials: usize,
}

/// Turn the shared records into local ones (`keep`), or drop them.
///
/// With `secrets` — the share is open — a kept record gets its credentials
/// back, so leaving the share does not leave the user retyping them.
pub fn leave_share(
    files: &mut LocalFiles,
    keep: bool,
    secrets: Option<&SecretMaps>,
) -> LeaveOutcome {
    let mut outcome = LeaveOutcome::default();

    if !keep {
        files
            .connections
            .connections
            .retain(|c| !is_team(&c.managed_by));
        files.ssh.retain(|p| !is_team(&p.managed_by));
        files.k8s.retain(|p| !is_team(&p.managed_by));
        return outcome;
    }

    for connection in files
        .connections
        .connections
        .iter_mut()
        .filter(|c| is_team(&c.managed_by))
    {
        connection.managed_by = None;
        match secrets.and_then(|s| s.connections.get(&connection.id)) {
            Some(found) => {
                found.apply_to(&mut connection.params);
                outcome.restored_connections.push(connection.id.clone());
            }
            None => outcome.kept_without_credentials += 1,
        }
    }
    for profile in files.ssh.iter_mut().filter(|p| is_team(&p.managed_by)) {
        profile.managed_by = None;
        match secrets.and_then(|s| s.ssh.get(&profile.id)) {
            Some(found) => {
                found.apply_to(profile);
                outcome.restored_ssh_profiles.push(profile.id.clone());
            }
            None => outcome.kept_without_credentials += 1,
        }
    }
    for profile in files.k8s.iter_mut().filter(|p| is_team(&p.managed_by)) {
        profile.managed_by = None;
    }
    outcome
}
