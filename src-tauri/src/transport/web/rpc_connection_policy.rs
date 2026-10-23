use super::{ConnectionRpcCommand, DatabaseObjectRpcCommand, InvocationError, RpcCommand};
use crate::application::{
    connections::ConnectionCommand, ApplicationApi, ApplicationRequestContext, AuthorizationLevel,
};
use crate::models::ConnectionParams;
use serde_json::Value;

/// Saved tunnel IDs resolve to administrator-controlled settings. Inline settings
/// can select host executables, credentials and files, even on Database RPCs.
pub(super) fn authorize(
    command: &ConnectionCommand,
    granted: AuthorizationLevel,
) -> Result<(), &'static str> {
    if granted.permits(AuthorizationLevel::LocalAdmin) {
        return Ok(());
    }
    let params = match command {
        ConnectionCommand::SaveConnection { params, .. }
        | ConnectionCommand::UpdateConnection { params, .. } => params,
        ConnectionCommand::TestConnection { request }
        | ConnectionCommand::ListDatabases { request } => &request.params,
        _ => return Ok(()),
    };

    authorize_driver(&params.driver)?;
    // This runtime-only ID can select pooled connections and saved proxy secrets.
    if params.connection_id.is_some() {
        return Err("Runtime connection IDs require local administrator authorization");
    }

    // Reject dormant inline settings too: saving them must not bypass the
    // authorization required to execute them later through a saved connection.
    // The form always supplies ssh_port, which is harmless while SSH is off
    // and replaced by the stored port when using a saved SSH profile.
    let inline_tunnel = (params.ssh_enabled == Some(true) && params.ssh_connection_id.is_none())
        || params.ssh_host.is_some()
        || params.ssh_user.is_some()
        || params.ssh_password.is_some()
        || params.ssh_key_file.is_some()
        || params.ssh_key_passphrase.is_some()
        || params.ssh_allow_passphrase_prompt == Some(true)
        || (params.k8s_enabled == Some(true) && params.k8s_connection_id.is_none())
        || params.k8s_context.is_some()
        || params.k8s_namespace.is_some()
        || params.k8s_resource_type.is_some()
        || params.k8s_resource_name.is_some()
        || params.k8s_port.is_some()
        || params.k8s_kubectl_path.is_some()
        || params.k8s_kubeconfig_path.is_some()
        || params.ssm_enabled == Some(true)
        || params.ssm_target.is_some()
        || params.ssm_profile.is_some()
        || params.ssm_region.is_some();
    let host_certificate =
        params.ssl_ca.is_some() || params.ssl_cert.is_some() || params.ssl_key.is_some();
    // A custom endpoint can receive a saved proxy password selected by the
    // connection ID. Only administrators may choose that credential's host.
    let custom_proxy = params.proxy.as_ref().is_some_and(|proxy| {
        proxy.mode == crate::proxy::ProxyMode::Custom || proxy.endpoint.is_some()
    });
    if inline_tunnel || host_certificate || custom_proxy {
        return Err("Inline tunnel, host certificate and proxy settings require local administrator authorization");
    }
    Ok(())
}

fn authorize_driver(driver: &str) -> Result<(), &'static str> {
    if driver == "sqlite" || crate::drivers::registry::is_local_path_driver(driver) {
        Err("File and folder database drivers require local administrator authorization")
    } else {
        Ok(())
    }
}

/// Check saved references before any RPC branch can resolve a file-backed connection.
pub(super) async fn authorize_saved_access(
    application: &dyn ApplicationApi,
    command: RpcCommand,
    context: &ApplicationRequestContext,
    body: &[u8],
    granted: AuthorizationLevel,
) -> Result<(), InvocationError> {
    if granted.permits(AuthorizationLevel::LocalAdmin) || body.is_empty() {
        return Ok(());
    }
    let payload: Value = super::decode_payload(body).map_err(InvocationError::InvalidPayload)?;
    let reference = match command {
        RpcCommand::Connection(
            ConnectionRpcCommand::GetConnectionById
            | ConnectionRpcCommand::UpdateConnection
            | ConnectionRpcCommand::DeleteConnection
            | ConnectionRpcCommand::DuplicateConnection
            | ConnectionRpcCommand::SetConnectionAppearance,
        ) => &payload["id"],
        RpcCommand::Connection(
            ConnectionRpcCommand::TestConnection | ConnectionRpcCommand::ListDatabases,
        ) => &payload["request"]["connection_id"],
        RpcCommand::DatabaseObject(DatabaseObjectRpcCommand::ExecuteClipboardImport) => {
            &payload["req"]["connection_id"]
        }
        _ => &payload["connectionId"],
    };
    if let Some(id) = reference.as_str() {
        if let Some(params) = application
            .connection_params_for_authorization(context.clone(), id)
            .await
            .map_err(InvocationError::Application)?
        {
            authorize_driver(&params.driver).map_err(InvocationError::Forbidden)?;
        }
    }
    Ok(())
}

pub(super) async fn authorize_saved_credentials(
    application: &dyn ApplicationApi,
    context: &ApplicationRequestContext,
    command: &ConnectionCommand,
    granted: AuthorizationLevel,
) -> Result<(), InvocationError> {
    if granted.permits(AuthorizationLevel::LocalAdmin) {
        return Ok(());
    }
    let (id, params) = match command {
        ConnectionCommand::TestConnection { request }
        | ConnectionCommand::ListDatabases { request } => {
            let Some(id) = request.connection_id.as_deref() else {
                return Ok(());
            };
            (id, &request.params)
        }
        ConnectionCommand::UpdateConnection { id, params, .. } => (id.as_str(), params),
        _ => return Ok(()),
    };
    let Some(saved) = application
        .connection_params_for_authorization(context.clone(), id)
        .await
        .map_err(InvocationError::Application)?
    else {
        return Ok(());
    };
    // Replacing a password can leave older keychain entries behind, so bind the
    // saved identity even when this request supplies a replacement credential.
    if security_target(params) != security_target(&saved) {
        return Err(InvocationError::Forbidden(
            "Changing a saved connection security target requires local administrator authorization",
        ));
    }
    Ok(())
}

fn security_target(params: &ConnectionParams) -> Value {
    // Include opaque plugin fields and all transport/authentication settings by default.
    // Only secrets and settings that cannot retarget a connection are excluded.
    let mut target = serde_json::to_value(params).expect("Connection parameters serialize");
    let target_fields = target
        .as_object_mut()
        .expect("Connection parameters are an object");
    // The connection form tests the primary database of a multi-selection.
    target_fields.insert(
        "database".into(),
        Value::String(params.database.primary().into()),
    );
    // The form omits blank legacy TLS modes; both use the driver's default.
    if params
        .ssl_mode
        .as_deref()
        .is_none_or(|mode| mode.trim().is_empty())
    {
        target_fields.remove("ssl_mode");
    }
    for field in [
        "password",
        "ssh_password",
        "ssh_key_passphrase",
        "save_in_keychain",
        "connection_uri_in_keychain",
        "connection_id",
        "startup_script",
        "pipes_as_concat",
    ] {
        target_fields.remove(field);
    }
    target
}
