use crate::application::{connections::ConnectionCommand, AuthorizationLevel};

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
        ConnectionCommand::TestConnection { request } => &request.params,
        _ => return Ok(()),
    };

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
