//! Team share: the storage engine behind a copy of selected connections and
//! their credentials, kept on a folder a team already shares.
//!
//! This module is the engine only — a file format and a merge, with no
//! knowledge of `connections.json`, the keychain or the UI. It is split in
//! two:
//!
//! - [`vault`] owns the on-disk format: a plain-text header (format marker,
//!   revision, KDF parameters, a verifier) over an AES-256-GCM payload keyed
//!   by Argon2id from the team's master password, plus the primitives that
//!   read, write and lock the file.
//! - [`merge`] is the three-way merge that decides what the file should
//!   contain after a member syncs, given what they last saw, what is on the
//!   share now and what they hold locally.
//!
//! Both are pure enough to test on their own: [`merge`] touches no clock and
//! no filesystem, and [`vault`] takes every path as a parameter.

pub mod merge;
pub mod vault;

#[cfg(test)]
mod tests;
