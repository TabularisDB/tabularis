use super::*;
use crate::application::provisioning::{connection_id, ProvisionCommand, ProvisionedConnection};

fn metadata(connection: SavedConnection) -> ProvisionedConnection {
    ProvisionedConnection {
        external_ref: connection
            .id
            .strip_prefix("provisioned-")
            .expect("provisioned id")
            .to_string(),
        id: connection.id,
        name: connection.name,
        driver: connection.params.driver,
        managed: connection.managed,
    }
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &Arc<ApplicationState>,
    command: ProvisionCommand,
) -> Result<Value, String> {
    // All machine writes are serialized, including their runtime cleanup.
    // Deterministic IDs also make retries after process restarts idempotent.
    let _guard = state.provisioning_lock.lock().await;
    let mut file = load_file(runtime)?;
    let reference = match &command {
        ProvisionCommand::List => {
            return json(
                file.connections
                    .into_iter()
                    .filter(|c| c.managed && c.id.starts_with("provisioned-"))
                    .map(metadata)
                    .collect::<Vec<_>>(),
            )
        }
        ProvisionCommand::Get(r) | ProvisionCommand::Put(r, _) | ProvisionCommand::Delete(r) => r,
    };
    let id = connection_id(reference)?;
    let existing = file.connections.iter().find(|c| c.id == id).cloned();
    match command {
        ProvisionCommand::List => unreachable!(),
        ProvisionCommand::Get(_) => json(metadata(existing.ok_or("not_found")?)),
        ProvisionCommand::Delete(_) => {
            if let Some(existing) = existing {
                delete_connection(runtime, state, &id)?;
                invalidate(runtime, state, &existing).await;
            }
            Ok(Value::Null)
        }
        ProvisionCommand::Put(_, mut input) => {
            if input.name.trim().is_empty() || input.name.len() > 256 {
                return Err("invalid_name".into());
            }
            // Classify caller mistakes before any secret/file writes. Storage
            // failures below remain server errors, without exposing their text.
            if non_empty(input.params.connection_uri.as_ref()).is_some()
                && !input.params.save_in_keychain.unwrap_or(false)
            {
                return Err("invalid_connection".into());
            }
            crate::plugin_secrets::validate_secret_changes(&input.plugin_secret_changes)
                .map_err(|_| "invalid_connection")?;
            let driver = crate::drivers::registry::get_driver(&input.params.driver)
                .await
                .ok_or("unknown_driver")?;
            crate::application::read_only::validate_support(
                &input.params,
                &driver.manifest().capabilities,
            )
            .map_err(|_| "unsupported_read_only")?;
            input.params.connection_id = None;
            let connection = if let Some(previous) = &existing {
                // Preserve proxy credentials too: shared DB/SSH/URI/plugin secret
                // merging is performed by update_connection below.
                if input.params.socks5_proxy_password.is_none() {
                    input.params.socks5_proxy_password =
                        previous.params.socks5_proxy_password.clone();
                }
                update_connection(
                    runtime,
                    state,
                    id.clone(),
                    input.name,
                    input.params,
                    input.plugin_secret_changes,
                    previous.detect_json_in_text_columns,
                    previous.environment.clone(),
                )?
            } else {
                let mut writes = SecretWrites::default();
                let result = (|| {
                    let keys = persist_plugin_secrets(
                        runtime,
                        &id,
                        None,
                        &mut input.params,
                        &input.plugin_secret_changes,
                        &mut writes,
                    )?;
                    persist_secrets_for_create(runtime, &id, &mut input.params, &mut writes)?;
                    let connection = SavedConnection {
                        id: id.clone(),
                        name: input.name,
                        params: input.params,
                        plugin_secret_keys: keys,
                        managed: true,
                        group_id: None,
                        sort_order: None,
                        detect_json_in_text_columns: None,
                        appearance: None,
                        tag_ids: None,
                        environment: None,
                    };
                    file.connections.push(connection.clone());
                    save_file(runtime, state, &file)?;
                    Ok::<_, String>(connection)
                })();
                if result.is_err() {
                    writes.rollback(runtime);
                }
                result?
            };
            if let Some(previous) = existing {
                invalidate(runtime, state, &previous).await;
            }
            invalidate_connection_metadata(
                runtime,
                &id,
                [&connection.params.driver, &connection.params.driver],
            )
            .await;
            json(metadata(connection))
        }
    }
}

async fn invalidate(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    previous: &SavedConnection,
) {
    let id = &previous.id;
    crate::credential_cache::invalidate_all_for_connection(&state.credential_cache, id);
    state.connection_cache.invalidate();
    let owners: Vec<_> = state
        .web_active_connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .keys()
        .copied()
        .collect();
    for owner in owners {
        super::super::routine_debug::release(Some(owner), Some(id)).await;
    }
    super::super::query_sessions::release_provisioned_connection(runtime, id).await;
    crate::pool_manager::close_pools_for_connection_id(&previous.params.driver, id).await;
    invalidate_connection_metadata(
        runtime,
        id,
        [&previous.params.driver, &previous.params.driver],
    )
    .await;
    crate::health_check::unregister_connection(id).await;
    for connections in state
        .web_active_connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values_mut()
    {
        connections.remove(id);
    }
}
