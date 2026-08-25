use std::sync::{Arc, Mutex};

type ShutdownHook = Box<dyn Fn() + Send + Sync>;

#[derive(Clone, Default)]
pub struct ShutdownHooks {
    hooks: Arc<Mutex<Vec<ShutdownHook>>>,
}

impl ShutdownHooks {
    pub fn register(&self, hook: impl Fn() + Send + Sync + 'static) {
        self.hooks
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(Box::new(hook));
    }

    pub fn run(&self) {
        for hook in self
            .hooks
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
        {
            hook();
        }
    }
}

pub async fn shutdown_headless_runtime(state: &super::state::ApplicationState) {
    state.abort_background_jobs();
    crate::pool_manager::close_all_pools().await;
    crate::ssh_tunnel::stop_all_tunnels();
    crate::k8s_tunnel::stop_all_tunnels();
    crate::drivers::registry::shutdown_external_drivers().await;
}

pub fn start_desktop_schedulers(app: tauri::AppHandle, ping_interval_secs: u64) {
    let health_check_app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::health_check::start_ping_loop(health_check_app, ping_interval_secs).await;
    });
    crate::ai_approval_watcher::spawn(app.clone());
    crate::backup::spawn_scheduler(app);
    crate::heartbeat::spawn();
}
