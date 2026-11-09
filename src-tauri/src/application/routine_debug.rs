//! Own native debugger resources independently of editor query sessions.
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{ConnectionParams, DatabaseSelection};
use crate::routine_debug::{DebugCommand, DebugResources, DebugResponse, PROTOCOL_VERSION};
use crate::runtime::RuntimeContext;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

#[cfg(test)]
mod tests;

struct Session {
    owner: Option<Uuid>,
    connection_id: String,
    driver: Arc<dyn DatabaseDriver>,
    params: ConnectionParams,
    preview_id: String,
    created: Instant,
    started: bool,
    terminal: Option<crate::routine_debug::DebugSnapshot>,
}

/// Dropping a web request must not strand a running native target.
struct CancellationCleanup {
    driver: Arc<dyn DatabaseDriver>,
    params: ConnectionParams,
    session_id: String,
    armed: bool,
}

impl Drop for CancellationCleanup {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let driver = self.driver.clone();
        let params = self.params.clone();
        let id = self.session_id.clone();
        crate::async_rt::spawn(async move {
            match native_call(driver.as_ref(), &params, &DebugCommand::Stop { session_id: id.clone() }).await {
                Ok(DebugResponse::Session { session, .. }) if matches!(session.resources, DebugResources::Released) => {
                    if let Some(entry) = sessions().lock().unwrap_or_else(|e| e.into_inner()).get_mut(&id) {
                        entry.terminal = Some(session);
                    }
                }
                _ => log::warn!("Cancelled routine debugger operation could not confirm resource release; transaction outcome is unknown"),
            }
        });
    }
}

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

async fn native_call(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    command: &DebugCommand,
) -> Result<DebugResponse, String> {
    let seconds = if matches!(command, DebugCommand::Stop { .. }) {
        5
    } else {
        30
    };
    let response = tokio::time::timeout(
        Duration::from_secs(seconds),
        driver.routine_debug(params, PROTOCOL_VERSION, command),
    )
    .await
    .map_err(|_| {
        "Routine debugger operation timed out; execution/transaction outcome is unknown".to_string()
    })??;
    response.validate_for(command)?;
    Ok(response)
}

pub async fn execute(
    runtime: &RuntimeContext,
    owner: Option<Uuid>,
    connection_id: &str,
    version: u32,
    command: DebugCommand,
) -> Result<DebugResponse, String> {
    command.validate(version, false)?;
    if let DebugCommand::Preview { target, .. } = &command {
        let (_, mut params) =
            super::connections::resolve_saved_connection_params(runtime, owner, connection_id)?;
        params.database = DatabaseSelection::Single(target.database.clone());
        let driver = crate::drivers::registry::get_connection_driver(&params).await?;
        if driver.manifest().capabilities.routine_debug != Some(PROTOCOL_VERSION) {
            return Err("Routine debugging is not supported by this driver".into());
        }
        command.validate(version, driver.manifest().capabilities.readonly)?;
        let mut response = native_call(driver.as_ref(), &params, &command).await?;
        let DebugResponse::Preview { preview_id, .. } = &mut response else {
            return Err("Expected routine debugger preview".into());
        };
        let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, s| {
            (s.started && s.terminal.is_none()) || s.created.elapsed() < Duration::from_secs(300)
        });
        if sessions.values().filter(|s| s.owner == owner).count() >= 16 {
            return Err("Close existing routine debugger sessions before opening another".into());
        }
        let public_id = Uuid::new_v4().to_string();
        sessions.insert(
            public_id.clone(),
            Session {
                owner,
                connection_id: connection_id.into(),
                driver,
                params,
                preview_id: preview_id.clone(),
                created: Instant::now(),
                started: false,
                terminal: None,
            },
        );
        *preview_id = public_id;
        return Ok(response);
    }

    let id = command
        .session_id()
        .ok_or("A debug session identity is required")?
        .to_string();
    let (driver, params, native_command) = {
        let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
        let session = sessions
            .get_mut(&id)
            .filter(|s| s.owner == owner && s.connection_id == connection_id)
            .ok_or("Routine debug session not found")?;
        if let Some(terminal) = session.terminal.clone() {
            if !matches!(
                command,
                DebugCommand::Stop { .. } | DebugCommand::Status { .. }
            ) {
                return Err("Routine debug resources have already been released".into());
            }
            sessions.remove(&id);
            return Ok(DebugResponse::Session {
                version: PROTOCOL_VERSION,
                session: terminal,
            });
        }
        let native_command = if let DebugCommand::Start { preview_id, .. } = &command {
            if preview_id != &id
                || session.started
                || session.created.elapsed() >= Duration::from_secs(300)
            {
                return Err("Routine preview expired or execution was already requested; do not retry start".into());
            }
            // Record before awaiting: a timeout or dropped client is never a reason to rerun.
            session.started = true;
            DebugCommand::Start {
                preview_id: session.preview_id.clone(),
                session_id: id.clone(),
            }
        } else {
            if !session.started {
                if matches!(command, DebugCommand::Stop { .. }) {
                    sessions.remove(&id);
                    use crate::routine_debug::*;
                    macro_rules! unavailable {
                        () => {
                            DebugRead::Unavailable {
                                reason: "Execution was never started".into(),
                            }
                        };
                    }
                    return Ok(DebugResponse::Session {
                        version: PROTOCOL_VERSION,
                        session: DebugSnapshot {
                            session_id: id,
                            revision: 0,
                            execution: DebugExecution::Cancelled,
                            transaction: DebugTransaction::Unknown,
                            resources: DebugResources::Released,
                            source: unavailable!(),
                            stop: unavailable!(),
                            stack: unavailable!(),
                            variables: unavailable!(),
                            outputs: unavailable!(),
                            breakpoints: unavailable!(),
                            error: None,
                        },
                    });
                }
                return Err("Routine execution has not been started".into());
            }
            command
        };
        (
            session.driver.clone(),
            session.params.clone(),
            native_command,
        )
    };
    let mut cleanup = CancellationCleanup {
        driver: driver.clone(),
        params: params.clone(),
        session_id: id.clone(),
        armed: matches!(
            native_command,
            DebugCommand::Start { .. } | DebugCommand::Continue { .. } | DebugCommand::Step { .. }
        ),
    };
    let response = native_call(driver.as_ref(), &params, &native_command).await?;
    cleanup.armed = false;
    if matches!(&response, DebugResponse::Session { session, .. } if matches!(session.resources, DebugResources::Released))
    {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }
    Ok(response)
}

pub async fn release(owner: Option<Uuid>, connection_id: Option<&str>) {
    let pending = {
        let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
        let keys: Vec<_> = sessions
            .iter()
            .filter(|(_, s)| {
                s.owner == owner && connection_id.map_or(true, |id| id == s.connection_id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        keys.into_iter()
            .filter_map(|id| sessions.remove(&id).map(|s| (id, s)))
            .collect::<Vec<_>>()
    };
    futures::future::join_all(pending.into_iter().map(|(id, session)| async move {
        if session.started {
            match native_call(session.driver.as_ref(), &session.params, &DebugCommand::Stop { session_id: id }).await {
                Ok(DebugResponse::Session { session, .. }) if matches!(session.resources, DebugResources::Released) => {},
                _ => log::warn!("Routine debugger cleanup could not confirm resource release; transaction outcome is unknown"),
            }
        }
    })).await;
}
