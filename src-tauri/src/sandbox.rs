//! Detection of the Linux application sandbox the app is running in.
//!
//! Snap and Flatpak both confine the process and take over integration
//! duties that a plain install performs itself (URL scheme registration via
//! the exported `.desktop` entry, D-Bus access policy, ...). Code that would
//! otherwise poke at the host — or that wants to explain a sandbox-caused
//! failure to the user — asks here first.

use std::ffi::OsString;

/// The confinement system wrapping the running process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sandbox {
    /// Confined by snapd (`SNAP` is set to the snap's mount point).
    Snap,
    /// Confined by Flatpak (`FLATPAK_ID` is set to the app id).
    Flatpak,
}

impl Sandbox {
    /// Human-readable name for log lines and user-facing hints.
    pub fn name(self) -> &'static str {
        match self {
            Sandbox::Snap => "snap",
            Sandbox::Flatpak => "flatpak",
        }
    }
}

/// Returns the sandbox the current process runs in, if any.
///
/// Only Linux packages are sandboxed this way; on other platforms this is
/// always `None`.
pub fn current() -> Option<Sandbox> {
    #[cfg(target_os = "linux")]
    {
        detect(|key| std::env::var_os(key))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Pure detection over an environment lookup, so tests do not have to mutate
/// the process environment.
///
/// Both launchers export their marker unconditionally, and an empty value is
/// treated as "not set" so a stray `SNAP=` in a shell profile does not fool
/// the check.
pub(crate) fn detect(env: impl Fn(&str) -> Option<OsString>) -> Option<Sandbox> {
    let is_set = |key: &str| env(key).is_some_and(|value| !value.is_empty());

    if is_set("SNAP") {
        Some(Sandbox::Snap)
    } else if is_set("FLATPAK_ID") {
        Some(Sandbox::Flatpak)
    } else {
        None
    }
}
