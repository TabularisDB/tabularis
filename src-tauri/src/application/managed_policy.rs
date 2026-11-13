use serde::{Deserialize, Serialize};
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

impl ConnectionAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Use => "use",
            Self::Create => "create",
            Self::Update => "update",
            Self::Delete => "delete",
            Self::Duplicate => "duplicate",
            Self::Import => "import",
            Self::Export => "export",
            Self::TestWithParams => "test_with_params",
            Self::EditBranding => "edit_branding",
            Self::EditOrganization => "edit_organization",
        }
    }
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

/// What a browser session may do, derived from the policy so the frontend
/// never has to infer it. The backend still enforces every one of these.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCapabilities {
    pub managed: bool,
    pub can_create: bool,
    pub can_update: bool,
    pub can_delete: bool,
    pub can_duplicate: bool,
    pub can_import: bool,
    pub can_export: bool,
    pub can_test: bool,
    pub can_edit_branding: bool,
    pub can_edit_organization: bool,
}

impl ManagedConnectionPolicy {
    pub fn capabilities(&self) -> ConnectionCapabilities {
        let allows = |action| self.authorize(action, false).is_ok();
        ConnectionCapabilities {
            managed: self.is_managed_only(),
            can_create: allows(ConnectionAction::Create),
            can_update: allows(ConnectionAction::Update),
            can_delete: allows(ConnectionAction::Delete),
            can_duplicate: allows(ConnectionAction::Duplicate),
            can_import: allows(ConnectionAction::Import),
            can_export: allows(ConnectionAction::Export),
            can_test: allows(ConnectionAction::TestWithParams),
            can_edit_branding: allows(ConnectionAction::EditBranding),
            can_edit_organization: allows(ConnectionAction::EditOrganization),
        }
    }
}

#[cfg(test)]
mod tests;
