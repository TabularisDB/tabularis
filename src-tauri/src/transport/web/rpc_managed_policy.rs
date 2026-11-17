use super::{ConnectionFilesRpcCommand, ConnectionRpcCommand, RpcCommand, TunnelRpcCommand};
use crate::application::{ConnectionAction, ManagedConnectionPolicy, PolicyDenial};

/// How managed mode treats an RPC command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ManagedAccess {
    /// Not connection management; managed mode does not restrict it.
    Unrestricted,
    Action(ConnectionAction),
}

pub(super) fn authorize(
    policy: &ManagedConnectionPolicy,
    command: RpcCommand,
) -> Result<(), PolicyDenial> {
    match access(command) {
        ManagedAccess::Unrestricted => Ok(()),
        // Managed-only protects every connection through the instance policy, so
        // no stored marker needs to be looked up. A mixed mode would resolve
        // the target connection's marker here.
        ManagedAccess::Action(action) => policy.authorize(action, false),
    }
}

/// Every command has an entry. The matches below name each variant instead of
/// using a catch-all, so adding a command without deciding how managed mode
/// treats it does not compile.
pub(super) fn access(command: RpcCommand) -> ManagedAccess {
    use ManagedAccess::Unrestricted;
    match command {
        RpcCommand::Connection(command) => connection_access(command),
        RpcCommand::ConnectionFiles(command) => connection_files_access(command),
        RpcCommand::Tunnel(command) => tunnel_access(command),
        RpcCommand::IsDebugMode
        | RpcCommand::GetConnections
        | RpcCommand::CancelQuery
        | RpcCommand::ListServerDirectory
        | RpcCommand::ResolveServerSaveTarget
        | RpcCommand::CreateSqliteFile
        | RpcCommand::CreateSqliteDatabase
        | RpcCommand::OpenDataFile
        | RpcCommand::ReadSqlFile
        | RpcCommand::WriteSqlFile
        | RpcCommand::Theme(_)
        | RpcCommand::HostSettings(_)
        | RpcCommand::UiState(_)
        | RpcCommand::DatabaseTransfer(_)
        | RpcCommand::GenericExport(_)
        | RpcCommand::Ai(_)
        | RpcCommand::Metadata(_)
        | RpcCommand::DatabaseObject(_)
        | RpcCommand::Query(_)
        | RpcCommand::Record(_)
        | RpcCommand::Persistence(_)
        | RpcCommand::Productivity(_)
        | RpcCommand::Notebook(_)
        | RpcCommand::Plugin(_)
        | RpcCommand::Operational(_)
        | RpcCommand::McpHost(_) => Unrestricted,
    }
}

fn connection_access(command: ConnectionRpcCommand) -> ManagedAccess {
    use ConnectionAction as A;
    use ManagedAccess::{Action, Unrestricted};
    match command {
        ConnectionRpcCommand::SetSelectedDatabases
        | ConnectionRpcCommand::GetConnectionById
        | ConnectionRpcCommand::GetConnectionsWithGroups
        | ConnectionRpcCommand::GetConnectionGroups
        | ConnectionRpcCommand::ListConnectionTags
        | ConnectionRpcCommand::GetRegisteredDrivers
        | ConnectionRpcCommand::GetDriverManifest
        | ConnectionRpcCommand::GetActiveConnections
        | ConnectionRpcCommand::RegisterActiveConnection
        | ConnectionRpcCommand::DisconnectConnection
        // Takes only a saved connection's id, so it cannot probe a new target.
        | ConnectionRpcCommand::OpenSavedConnection => Unrestricted,
        ConnectionRpcCommand::SaveConnection => Action(A::Create),
        ConnectionRpcCommand::UpdateConnection => Action(A::Update),
        ConnectionRpcCommand::DeleteConnection => Action(A::Delete),
        ConnectionRpcCommand::DuplicateConnection => Action(A::Duplicate),
        // Both take caller-supplied parameters, so they can probe any host.
        ConnectionRpcCommand::TestConnection | ConnectionRpcCommand::ListDatabases => {
            Action(A::TestWithParams)
        }
        ConnectionRpcCommand::SetConnectionAppearance
        | ConnectionRpcCommand::SaveConnectionIcon
        | ConnectionRpcCommand::DeleteConnectionIcon => Action(A::EditBranding),
        ConnectionRpcCommand::CreateConnectionGroup
        | ConnectionRpcCommand::CreateGroupPath
        | ConnectionRpcCommand::UpdateConnectionGroup
        | ConnectionRpcCommand::MoveGroupToParent
        | ConnectionRpcCommand::DeleteConnectionGroup
        | ConnectionRpcCommand::MoveConnectionToGroup
        | ConnectionRpcCommand::ReorderGroups
        | ConnectionRpcCommand::ReorderConnectionsInGroup
        | ConnectionRpcCommand::CreateConnectionTag
        | ConnectionRpcCommand::UpdateConnectionTag
        | ConnectionRpcCommand::DeleteConnectionTag
        | ConnectionRpcCommand::SetConnectionTags => Action(A::EditOrganization),
    }
}

fn connection_files_access(command: ConnectionFilesRpcCommand) -> ManagedAccess {
    use ConnectionAction as A;
    use ManagedAccess::Action;
    match command {
        ConnectionFilesRpcCommand::ListImportSources
        | ConnectionFilesRpcCommand::PreviewForeignImport
        | ConnectionFilesRpcCommand::ApplyForeignImport
        | ConnectionFilesRpcCommand::PreviewTabularisImport
        | ConnectionFilesRpcCommand::ApplyPreparedTabularisImport => Action(A::Import),
        // Backups write every connection and credential to a target the
        // session can choose.
        ConnectionFilesRpcCommand::Export
        | ConnectionFilesRpcCommand::GetBackupStatus
        | ConnectionFilesRpcCommand::GetDatabaseBackupStatus
        | ConnectionFilesRpcCommand::RunDatabaseBackup
        | ConnectionFilesRpcCommand::CancelDatabaseBackup
        | ConnectionFilesRpcCommand::SetBackupPassword
        | ConnectionFilesRpcCommand::SetBackupTargetPassword
        | ConnectionFilesRpcCommand::RunBackup => Action(A::Export),
    }
}

/// Tunnel profiles decide where a connection's traffic goes, so changing or
/// probing them retargets a managed connection.
fn tunnel_access(command: TunnelRpcCommand) -> ManagedAccess {
    use ConnectionAction as A;
    use ManagedAccess::{Action, Unrestricted};
    match command {
        TunnelRpcCommand::GetSshConnections
        | TunnelRpcCommand::GetK8sConnections
        | TunnelRpcCommand::RespondSshAskpass => Unrestricted,
        TunnelRpcCommand::SaveSshConnection | TunnelRpcCommand::SaveK8sConnection => {
            Action(A::Create)
        }
        TunnelRpcCommand::UpdateSshConnection | TunnelRpcCommand::UpdateK8sConnection => {
            Action(A::Update)
        }
        TunnelRpcCommand::DeleteSshConnection | TunnelRpcCommand::DeleteK8sConnection => {
            Action(A::Delete)
        }
        TunnelRpcCommand::TestSshConnection
        | TunnelRpcCommand::TestK8sConnection
        | TunnelRpcCommand::TestSsmConnection
        | TunnelRpcCommand::GetK8sContexts
        | TunnelRpcCommand::GetK8sNamespaces
        | TunnelRpcCommand::GetK8sResources
        | TunnelRpcCommand::GetK8sResourcePorts
        | TunnelRpcCommand::ValidateK8sPath => Action(A::TestWithParams),
    }
}

#[cfg(test)]
#[path = "rpc_managed_policy_tests.rs"]
mod tests;
