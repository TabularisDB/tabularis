//! Three-way merge between the vault as we last saw it (`base`), the vault as
//! it is on the share right now (`remote`) and what this machine holds
//! locally (`local`).
//!
//! `base` is the payload of the last successful sync, so "in base but not in
//! local" means the member deleted it here, not that they never had it. That
//! is what lets removals propagate without mistaking a teammate's new entry
//! for something we deleted.
//!
//! Conflicts — the same record changed on both sides since `base` — resolve
//! to the local version, because the local side is the one about to write.
//! Every such resolution is reported as a [`MergeNote`] so it reaches the log
//! instead of happening silently.
//!
//! Everything here is pure: no clock, no filesystem, no app handle.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;

use super::vault::{
    VaultEntry, VaultGroup, VaultK8sProfile, VaultPayload, VaultSshProfile, VaultTag,
};

/// Tombstones older than this are dropped, so the vault does not grow forever
/// with records nobody remembers.
pub const TOMBSTONE_RETENTION_DAYS: i64 = 90;

/// What the merge did to one record, for the log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeNote {
    /// `"connection"`, `"group"` or `"tag"`.
    pub kind: &'static str,
    pub id: String,
    pub outcome: MergeOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeOutcome {
    /// Taken from the share (new there, or changed there only).
    PulledFromShare,
    /// Taken from this machine (new here, or changed here only).
    PushedFromLocal,
    /// Changed on both sides; the local version won.
    ConflictLocalWins,
    /// Removed here and turned into a tombstone.
    TombstonedLocally,
    /// An expired tombstone dropped from the vault.
    TombstoneExpired,
}

/// Inputs the merge needs from the outside world.
pub struct MergeContext {
    /// Timestamp stamped on records this merge changes.
    pub now: String,
    /// Label stamped as `updatedBy` on those records.
    pub actor: String,
    /// Tombstones with `updated_at` strictly before this are dropped.
    pub tombstone_cutoff: String,
}

/// Merge the three payloads. Returns the payload to write back to the share
/// and the list of records the merge touched.
pub fn merge_payload(
    base: &VaultPayload,
    remote: &VaultPayload,
    local: &VaultPayload,
    ctx: &MergeContext,
) -> (VaultPayload, Vec<MergeNote>) {
    let mut notes = Vec::new();
    let entries = merge_list(
        "connection",
        &base.entries,
        &remote.entries,
        &local.entries,
        ctx,
        &mut notes,
    );
    let groups = merge_list(
        "group",
        &base.groups,
        &remote.groups,
        &local.groups,
        ctx,
        &mut notes,
    );
    let tags = merge_list("tag", &base.tags, &remote.tags, &local.tags, ctx, &mut notes);
    let ssh_profiles = merge_list(
        "ssh profile",
        &base.ssh_profiles,
        &remote.ssh_profiles,
        &local.ssh_profiles,
        ctx,
        &mut notes,
    );
    let k8s_profiles = merge_list(
        "k8s tunnel",
        &base.k8s_profiles,
        &remote.k8s_profiles,
        &local.k8s_profiles,
        ctx,
        &mut notes,
    );
    (
        VaultPayload {
            entries,
            groups,
            tags,
            ssh_profiles,
            k8s_profiles,
        },
        notes,
    )
}

/// A record the merge can key, stamp and tombstone.
pub trait Mergeable: Clone + Serialize {
    fn id(&self) -> &str;
    fn updated_at(&self) -> &str;
    fn is_deleted(&self) -> bool;
    /// Stamp this record as changed by `actor` at `now`.
    fn stamp(&mut self, now: &str, actor: &str);
    /// A deleted copy of this record, stamped.
    fn tombstone(&self, now: &str, actor: &str) -> Self {
        let mut copy = self.clone();
        copy.mark_deleted();
        copy.stamp(now, actor);
        copy
    }
    fn mark_deleted(&mut self);
}

impl Mergeable for VaultEntry {
    fn id(&self) -> &str {
        &self.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn is_deleted(&self) -> bool {
        self.deleted
    }
    fn stamp(&mut self, now: &str, actor: &str) {
        self.updated_at = now.to_string();
        self.updated_by = actor.to_string();
    }
    fn mark_deleted(&mut self) {
        self.deleted = true;
        // A tombstone must not keep carrying the credentials of the
        // connection it replaces.
        self.params = Default::default();
    }
}

impl Mergeable for VaultGroup {
    fn id(&self) -> &str {
        &self.group.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn is_deleted(&self) -> bool {
        self.deleted
    }
    fn stamp(&mut self, now: &str, _actor: &str) {
        self.updated_at = now.to_string();
    }
    fn mark_deleted(&mut self) {
        self.deleted = true;
    }
}

impl Mergeable for VaultSshProfile {
    fn id(&self) -> &str {
        &self.profile.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn is_deleted(&self) -> bool {
        self.deleted
    }
    fn stamp(&mut self, now: &str, actor: &str) {
        self.updated_at = now.to_string();
        self.updated_by = actor.to_string();
    }
    fn mark_deleted(&mut self) {
        self.deleted = true;
        // A tombstone must not keep carrying the tunnel's credentials.
        self.profile.password = None;
        self.profile.key_passphrase = None;
    }
}

impl Mergeable for VaultK8sProfile {
    fn id(&self) -> &str {
        &self.profile.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn is_deleted(&self) -> bool {
        self.deleted
    }
    fn stamp(&mut self, now: &str, actor: &str) {
        self.updated_at = now.to_string();
        self.updated_by = actor.to_string();
    }
    fn mark_deleted(&mut self) {
        // Nothing to scrub: a K8s tunnel carries no credentials.
        self.deleted = true;
    }
}

impl Mergeable for VaultTag {
    fn id(&self) -> &str {
        &self.tag.id
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
    fn is_deleted(&self) -> bool {
        self.deleted
    }
    fn stamp(&mut self, now: &str, _actor: &str) {
        self.updated_at = now.to_string();
    }
    fn mark_deleted(&mut self) {
        self.deleted = true;
    }
}

/// Serialized form with the merge metadata removed, so two records are
/// compared on what they mean rather than on when they were written.
fn content_of<T: Serialize>(record: &T) -> Value {
    let mut value = serde_json::to_value(record).unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.remove("updatedAt");
        object.remove("updatedBy");
    }
    value
}

fn same_content<T: Serialize>(a: &T, b: &T) -> bool {
    content_of(a) == content_of(b)
}

fn find<'a, T: Mergeable>(list: &'a [T], id: &str) -> Option<&'a T> {
    list.iter().find(|record| record.id() == id)
}

fn merge_list<T: Mergeable>(
    kind: &'static str,
    base: &[T],
    remote: &[T],
    local: &[T],
    ctx: &MergeContext,
    notes: &mut Vec<MergeNote>,
) -> Vec<T> {
    let ids: BTreeSet<&str> = base
        .iter()
        .chain(remote)
        .chain(local)
        .map(Mergeable::id)
        .collect();

    let mut merged = Vec::new();
    for id in ids {
        let Some(resolved) = resolve(kind, id, find(base, id), find(remote, id), find(local, id), ctx, notes)
        else {
            continue;
        };
        merged.push(resolved);
    }
    merged
}

/// Decide the winning version of one record. `None` drops it from the vault.
fn resolve<T: Mergeable>(
    kind: &'static str,
    id: &str,
    base: Option<&T>,
    remote: Option<&T>,
    local: Option<&T>,
    ctx: &MergeContext,
    notes: &mut Vec<MergeNote>,
) -> Option<T> {
    let note = |notes: &mut Vec<MergeNote>, outcome: MergeOutcome| {
        notes.push(MergeNote {
            kind,
            id: id.to_string(),
            outcome,
        });
    };

    let local_changed = match (local, base) {
        (Some(local), Some(base)) => !same_content(local, base),
        (Some(_), None) => true,
        // Gone locally: a removal only when we had it at the last sync.
        // Without a base it was never here, so there is nothing to remove.
        (None, Some(base)) => !base.is_deleted(),
        (None, None) => false,
    };
    let remote_changed = match (remote, base) {
        (Some(remote), Some(base)) => !same_content(remote, base),
        (Some(_), None) => true,
        (None, _) => false,
    };

    let winner = match (local, remote, base) {
        // Removed here. Replace it with a tombstone so teammates drop it too.
        (None, _, Some(base)) if local_changed => {
            let source = remote.unwrap_or(base);
            if source.is_deleted() {
                // Already a tombstone on the share: keep its original stamp so
                // the retention clock is not restarted on every sync.
                Some(source.clone())
            } else {
                note(notes, MergeOutcome::TombstonedLocally);
                Some(source.tombstone(&ctx.now, &ctx.actor))
            }
        }
        // Never here and not on the share either: nothing to keep.
        (None, None, _) => None,
        (None, Some(remote), _) => {
            // New on the share and never seen here. A tombstone for something
            // this machine never had is not a pull — there is nothing to
            // report, it simply stays out of the local list.
            if !remote.is_deleted() {
                note(notes, MergeOutcome::PulledFromShare);
            }
            Some(remote.clone())
        }
        // Identical on both sides. Worth short-circuiting before the change
        // detection: without a base (a first unlock, or a lost base cache)
        // both sides count as "changed", and reporting a conflict over two
        // identical records would be noise.
        (Some(local), Some(remote), _) if same_content(local, remote) => Some(remote.clone()),
        (Some(local), _, _) => {
            if local_changed && remote_changed {
                note(notes, MergeOutcome::ConflictLocalWins);
                let mut winner = local.clone();
                winner.stamp(&ctx.now, &ctx.actor);
                Some(winner)
            } else if local_changed {
                note(notes, MergeOutcome::PushedFromLocal);
                let mut winner = local.clone();
                winner.stamp(&ctx.now, &ctx.actor);
                Some(winner)
            } else if remote_changed {
                note(notes, MergeOutcome::PulledFromShare);
                remote.cloned()
            } else {
                // Unchanged on both sides: keep the share's copy so its
                // timestamps stay authoritative.
                remote.or(Some(local)).cloned()
            }
        }
    }?;

    if winner.is_deleted() && winner.updated_at() < ctx.tombstone_cutoff.as_str() {
        note(notes, MergeOutcome::TombstoneExpired);
        return None;
    }
    Some(winner)
}

/// Records pulled in from the share that a member did not have before,
/// reported by [`merge_payload`] through its notes.
pub fn pulled_ids(notes: &[MergeNote], kind: &str) -> Vec<String> {
    notes
        .iter()
        .filter(|note| note.kind == kind && note.outcome == MergeOutcome::PulledFromShare)
        .map(|note| note.id.clone())
        .collect()
}
