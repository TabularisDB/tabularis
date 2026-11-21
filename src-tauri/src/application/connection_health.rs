//! Ping and reconnect I/O shared by both transports, and the health loop of
//! `tabularis web`.
//!
//! The desktop loop lives in `transport/desktop/health_check.rs`. The web loop
//! below runs the same lifecycle (`connection_lifecycle`) over the browser
//! sessions that hold each connection, and sends its events to those sessions
//! only.

use crate::application::connection_lifecycle::{
    auto_reconnect_for_tick, plan_tick, ConnectionLifecycle, ConnectionLifecycleEvent,
    HealthTracker, PingOutcome, TickPing, CONNECTION_LIFECYCLE_EVENT, POOL_CLOSE_TIMEOUT,
    RECONNECT_TIMEOUT,
};
use crate::application::tunnels::{discard_ssh_tunnel, ssh_tunnel_lease, TunnelLease};
use crate::health_check::{DEFAULT_PING_INTERVAL, PING_TIMEOUT};
use crate::models::ConnectionParams;
use crate::runtime::state::ApplicationState;
use crate::runtime::RuntimeContext;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use uuid::Uuid;

pub const CONNECTION_HEALTH_FAILED_EVENT: &str = "connection-health-failed";

/// How often a disabled web loop (interval 0) looks at the setting again.
const DISABLED_RECHECK: Duration = Duration::from_secs(30);

pub(crate) fn is_builtin_driver(driver: &str) -> bool {
    matches!(driver, "mysql" | "postgres" | "sqlite")
}

/// Ping a connection through its existing pool, without opening one.
pub(crate) async fn ping_resolved(params: &ConnectionParams, connection_id: &str) -> PingOutcome {
    if is_builtin_driver(&params.driver)
        && !crate::pool_manager::has_pool(params, Some(connection_id)).await
    {
        return PingOutcome::Error("No active connection pool".into());
    }

    let Some(driver) = crate::drivers::registry::get_driver(&params.driver).await else {
        return PingOutcome::Error(format!("Driver not found: {}", params.driver));
    };

    match tokio::time::timeout(PING_TIMEOUT, driver.ping(params)).await {
        Ok(Ok(())) => PingOutcome::Ok,
        Ok(Err(err)) => PingOutcome::Error(err),
        Err(_) => PingOutcome::TimedOut,
    }
}

/// Open a fresh pool for a built-in driver and ping through it. Plugin drivers
/// own their connections, so for them this is one more `ping`.
pub(crate) async fn reconnect(
    params: &ConnectionParams,
    connection_id: &str,
) -> Result<(), String> {
    let id = Some(connection_id);
    match params.driver.as_str() {
        "postgres" => drop(crate::pool_manager::get_postgres_pool_with_id(params, id).await?),
        "mysql" => drop(crate::pool_manager::get_mysql_pool_with_id(params, id).await?),
        "sqlite" => drop(crate::pool_manager::get_sqlite_pool_with_id(params, id).await?),
        _ => {}
    }
    let driver = crate::drivers::registry::get_driver(&params.driver)
        .await
        .ok_or_else(|| format!("Driver not found: {}", params.driver))?;
    driver.ping(params).await
}

/// Run the web health loop until the task is aborted. The interval and the
/// auto-reconnect setting are read from the config file, so a change in the
/// Web UI settings applies from the next tick without a restart.
pub fn spawn_headless(
    runtime: RuntimeContext,
    state: Arc<ApplicationState>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tracker: Option<(u64, HealthTracker)> = None;
        loop {
            let interval_secs = ping_interval_secs(&runtime);
            if interval_secs == 0 {
                tracker = None;
                tokio::time::sleep(DISABLED_RECHECK).await;
                continue;
            }
            let period = Duration::from_secs(interval_secs);
            if tracker.as_ref().map(|(secs, _)| *secs) != Some(interval_secs) {
                log::info!("Health check: web ping loop every {interval_secs}s");
                tracker = Some((interval_secs, HealthTracker::new(period)));
            }
            if let Some((_, tracker)) = tracker.as_mut() {
                if tracker.begin_tick(SystemTime::now()) {
                    log::info!("Health check: resumed after a long gap, re-checking connections");
                }
                let active = crate::health_check::active_connections().await;
                check_connections(&runtime, &state, tracker, active).await;
                tracker.end_tick(SystemTime::now());
            }
            tokio::time::sleep(period).await;
        }
    })
}

fn ping_interval_secs(runtime: &RuntimeContext) -> u64 {
    u64::from(
        crate::application::persistence::load_config(runtime)
            .ping_interval
            .unwrap_or(DEFAULT_PING_INTERVAL),
    )
}

/// One web tick over `connection_ids`: ping each, then recover or drop the
/// ones that failed, the same way the desktop loop does.
pub(crate) async fn check_connections(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    tracker: &mut HealthTracker,
    connection_ids: Vec<String>,
) {
    if connection_ids.is_empty() {
        return;
    }
    let results = futures::future::join_all(connection_ids.into_iter().map(|id| async move {
        let (lease, outcome) = ping_saved(runtime, state, &id).await;
        (id, lease, outcome)
    }))
    .await;
    let tick: Vec<TickPing> = results
        .into_iter()
        .map(|(connection_id, lease, outcome)| TickPing {
            verdict: tracker.record(&connection_id, outcome == PingOutcome::Ok),
            connection_id,
            lease,
            outcome,
        })
        .collect();

    let auto_reconnect = auto_reconnect_for_tick(&tick, || {
        crate::application::persistence::load_config(runtime)
            .auto_reconnect
            .unwrap_or(false)
    });
    let plan = plan_tick(tick, auto_reconnect, tracker);
    for discard in &plan.discards {
        if discard_ssh_tunnel(&discard.lease) {
            log::warn!(
                "Health check: discarding half-open SSH tunnel (generation {}), {} connections affected",
                discard.lease.generation,
                discard.recover.len()
            );
        }
    }
    for failed in plan.failed {
        if failed.recover {
            recover_connection(runtime, state, &failed.connection_id).await;
        } else {
            log::error!(
                "Health check: connection {} failed, disconnecting",
                failed.connection_id
            );
            handle_connection_failure(runtime, state, &failed.connection_id, &failed.error).await;
        }
    }
}

/// Browser sessions that hold `connection_id` open.
fn owners(state: &ApplicationState, connection_id: &str) -> Vec<Uuid> {
    state
        .web_active_connections
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
        .filter(|(_, connections)| connections.contains(connection_id))
        .map(|(session_id, _)| *session_id)
        .collect()
}

/// Remove `connection_id` from every session and return the sessions that held it.
fn take_owners(state: &ApplicationState, connection_id: &str) -> Vec<Uuid> {
    let mut sessions = state
        .web_active_connections
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut owners = Vec::new();
    sessions.retain(|session_id, connections| {
        if connections.remove(connection_id) {
            owners.push(*session_id);
        }
        !connections.is_empty()
    });
    owners
}

/// The connection's SSH tunnel lease, taken before resolving, and its resolved
/// params. An SSH passphrase prompt, if resolving needs one, goes to a session
/// that holds the connection rather than to every browser.
fn resolve_saved(
    runtime: &RuntimeContext,
    owner: Option<Uuid>,
    connection_id: &str,
) -> Result<(Option<TunnelLease>, ConnectionParams), String> {
    let lease =
        crate::application::connections::load_connections(&runtime.paths.connections_file())?
            .into_iter()
            .find(|saved| saved.id == connection_id)
            .and_then(|saved| {
                let mut params = saved.params;
                params.connection_id = Some(connection_id.to_string());
                crate::application::tunnels::expand_connection_params(runtime, &params).ok()
            })
            .and_then(|expanded| ssh_tunnel_lease(&expanded));
    let (_, params) = crate::application::connections::resolve_saved_connection_params(
        runtime,
        owner,
        connection_id,
    )?;
    Ok((lease, params))
}

async fn resolve_off_thread(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    connection_id: &str,
) -> Result<(Option<TunnelLease>, ConnectionParams), String> {
    let runtime = runtime.clone();
    let owner = owners(state, connection_id).into_iter().next();
    let connection_id = connection_id.to_string();
    tokio::task::spawn_blocking(move || resolve_saved(&runtime, owner, &connection_id))
        .await
        .map_err(|e| format!("Resolving connection params failed: {e}"))?
}

async fn ping_saved(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    connection_id: &str,
) -> (Option<TunnelLease>, PingOutcome) {
    match resolve_off_thread(runtime, state, connection_id).await {
        Ok((lease, params)) => (lease, ping_resolved(&params, connection_id).await),
        Err(err) => (None, PingOutcome::Error(err)),
    }
}

/// Replace the pools of a failed connection and test it once, within
/// `RECONNECT_TIMEOUT`. Released tab sessions are not replayed.
async fn recover_connection(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    connection_id: &str,
) {
    log::warn!(
        "Health check: connection {} failed, reconnecting once",
        connection_id
    );
    emit_lifecycle(
        runtime,
        &owners(state, connection_id),
        connection_id,
        ConnectionLifecycle::Reconnecting,
    );

    let recovery = async {
        let (_, params) = resolve_off_thread(runtime, state, connection_id).await?;
        let released_sessions = if is_builtin_driver(&params.driver) {
            close_connection_resources(runtime, &owners(state, connection_id), connection_id).await
        } else {
            0
        };
        reconnect(&params, connection_id).await?;
        Ok(released_sessions)
    };
    let attempt = tokio::time::timeout(RECONNECT_TIMEOUT, recovery)
        .await
        .unwrap_or_else(|_| Err("Reconnect timed out".to_string()));

    match attempt {
        Ok(_) if owners(state, connection_id).is_empty() => {
            close_connection_resources(runtime, &[], connection_id).await;
        }
        Ok(released_sessions) => {
            log::info!("Health check: connection {} reconnected", connection_id);
            emit_lifecycle(
                runtime,
                &owners(state, connection_id),
                connection_id,
                ConnectionLifecycle::Reconnected { released_sessions },
            );
        }
        Err(err) => {
            log::error!(
                "Health check: reconnect failed for {}: {}",
                connection_id,
                err
            );
            handle_connection_failure(runtime, state, connection_id, &err).await;
        }
    }
}

/// Take the connection away from every session that holds it, close its
/// pools, and tell those sessions.
async fn handle_connection_failure(
    runtime: &RuntimeContext,
    state: &ApplicationState,
    connection_id: &str,
    error: &str,
) {
    crate::health_check::unregister_connection(connection_id).await;
    let owners = take_owners(state, connection_id);
    close_connection_resources(runtime, &owners, connection_id).await;

    let payload = serde_json::json!({
        "connectionId": connection_id,
        "error": error,
    });
    for owner in owners {
        if let Err(e) =
            runtime
                .events
                .emit_to(owner, CONNECTION_HEALTH_FAILED_EVENT, payload.clone())
        {
            log::error!("Health check: failed to emit {CONNECTION_HEALTH_FAILED_EVENT}: {e}");
        }
        crate::application::connections::emit_active_connections(runtime, Some(state), Some(owner))
            .await;
    }
}

/// Release the owners' tab sessions and routine debuggers on the connection,
/// then close its pools. Returns how many tab sessions were released.
async fn close_connection_resources(
    runtime: &RuntimeContext,
    owners: &[Uuid],
    connection_id: &str,
) -> usize {
    let mut released = 0;
    for owner in owners {
        released += crate::application::query_sessions::release_connection(
            runtime,
            Some(*owner),
            connection_id,
        )
        .await;
        crate::application::routine_debug::release(Some(*owner), Some(connection_id)).await;
    }
    match crate::application::connections::saved_connection_driver(runtime, connection_id) {
        Ok(driver) => {
            let closed = crate::pool_manager::close_pools_for_connection_id_within(
                &driver,
                connection_id,
                POOL_CLOSE_TIMEOUT,
            )
            .await;
            if !closed {
                log::warn!(
                    "Health check: pools for {connection_id} are still closing; a checked-out connection has not been returned"
                );
            }
        }
        Err(err) => log::warn!("Health check: cannot close pools for {connection_id}: {err}"),
    }
    released
}

fn emit_lifecycle(
    runtime: &RuntimeContext,
    owners: &[Uuid],
    connection_id: &str,
    lifecycle: ConnectionLifecycle,
) {
    let event = ConnectionLifecycleEvent {
        connection_id: connection_id.to_string(),
        lifecycle,
    };
    let payload = match serde_json::to_value(event) {
        Ok(payload) => payload,
        Err(e) => {
            log::error!("Health check: failed to encode {CONNECTION_LIFECYCLE_EVENT}: {e}");
            return;
        }
    };
    for owner in owners {
        if let Err(e) = runtime
            .events
            .emit_to(*owner, CONNECTION_LIFECYCLE_EVENT, payload.clone())
        {
            log::error!("Health check: failed to emit {CONNECTION_LIFECYCLE_EVENT}: {e}");
        }
    }
}

#[cfg(test)]
#[path = "connection_health_tests.rs"]
mod tests;
