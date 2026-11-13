use std::fmt;

/// Stable machine-readable code carried by every policy denial.
pub const MANAGED_CONNECTION_DENIED: &str = "managed_connection_denied";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConnectionPolicyMode {
    #[default]
    Standalone,
    ManagedOnly,
}

/// What a browser session is trying to do to a connection or to the shared
/// settings around it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectionAction {
    /// Open, browse and query within the database account's privileges.
    Use,
    Create,
    Update,
    Delete,
    Duplicate,
    Import,
    Export,
    /// Test or list databases with caller-supplied parameters.
    TestWithParams,
    /// Change appearance and icons.
    EditBranding,
    /// Change groups and tags, which are shared instance state.
    EditOrganization,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PolicyDenial {
    pub action: ConnectionAction,
}

impl PolicyDenial {
    pub fn code(&self) -> &'static str {
        MANAGED_CONNECTION_DENIED
    }
}

impl fmt::Display for PolicyDenial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{MANAGED_CONNECTION_DENIED}: {:?}", self.action)
    }
}

impl std::error::Error for PolicyDenial {}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ManagedConnectionPolicy {
    mode: ConnectionPolicyMode,
    allow_branding: bool,
    allow_organization: bool,
}

impl ManagedConnectionPolicy {
    pub fn standalone() -> Self {
        Self::default()
    }

    /// Both shared-settings switches start denied.
    pub fn managed_only() -> Self {
        Self {
            mode: ConnectionPolicyMode::ManagedOnly,
            ..Self::default()
        }
    }

    pub fn with_branding_allowed(mut self, allowed: bool) -> Self {
        self.allow_branding = allowed;
        self
    }

    pub fn with_organization_allowed(mut self, allowed: bool) -> Self {
        self.allow_organization = allowed;
        self
    }

    pub fn mode(&self) -> ConnectionPolicyMode {
        self.mode
    }

    pub fn is_managed_only(&self) -> bool {
        self.mode == ConnectionPolicyMode::ManagedOnly
    }

    /// Whether a connection is protected. In managed-only mode the instance
    /// protects every connection, so the marker is deliberately ignored.
    pub fn protects(&self, _marker: bool) -> bool {
        self.is_managed_only()
    }

    /// Decide an action against a connection with the given persisted marker.
    /// Use `false` for actions with no existing connection, such as creating
    /// or importing one.
    pub fn authorize(&self, action: ConnectionAction, marker: bool) -> Result<(), PolicyDenial> {
        if !self.protects(marker) {
            return Ok(());
        }
        let allowed = match action {
            ConnectionAction::Use => true,
            ConnectionAction::EditBranding => self.allow_branding,
            ConnectionAction::EditOrganization => self.allow_organization,
            ConnectionAction::Create
            | ConnectionAction::Update
            | ConnectionAction::Delete
            | ConnectionAction::Duplicate
            | ConnectionAction::Import
            | ConnectionAction::Export
            | ConnectionAction::TestWithParams => false,
        };
        if allowed {
            Ok(())
        } else {
            Err(PolicyDenial { action })
        }
    }
}

#[cfg(test)]
mod tests;
