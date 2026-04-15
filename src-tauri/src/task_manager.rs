use std::collections::HashSet;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sysinfo::{get_current_pid, Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::time::{sleep, Duration};

use crate::drivers::registry;
use crate::plugins::installer;
use crate::plugins::manager::load_plugin_from_dir;

// ---------------------------------------------------------------------------
// Persistent System instance — required so that delta fields (cpu_usage,
// disk read_bytes / written_bytes) are computed between successive polls.
// ---------------------------------------------------------------------------
static SYSTEM: Lazy<Mutex<System>> = Lazy::new(|| {
    Mutex::new(System::new_with_specifics(
        RefreshKind::new().with_processes(
            ProcessRefreshKind::new()
                .with_cpu()
                .with_disk_usage()
                .with_memory(),
        ),
    ))
});

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChildProcessInfo {
    pub pid: u32,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessInfo {
    pub plugin_id: String,
    pub plugin_name: String,
    pub pid: Option<u32>,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub status: String,
    pub children: Vec<ChildProcessInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TabularisChildProcess {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TabularisSelfStats {
    pub pid: u32,
    /// RSS of the main tabularis process only (bytes).
    pub self_memory_bytes: u64,
    /// RSS sum across the whole process tree (main + all children, bytes).
    pub total_memory_bytes: u64,
    pub cpu_percent: f32,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub child_count: usize,
    // children are fetched on-demand via get_tabularis_children, not on every poll
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used: u64,
    pub memory_total: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub process_count: usize,
    pub tabularis: Option<TabularisSelfStats>,
}

// ---------------------------------------------------------------------------
// Helpers (called on blocking thread, inside spawn_blocking)
// ---------------------------------------------------------------------------

fn refresh_and_collect_process_stats(
    plugin_pids: Vec<(String, String, Option<u32>)>,
) -> Vec<ProcessInfo> {
    let mut sys = SYSTEM.lock().expect("system mutex poisoned");
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new()
            .with_cpu()
            .with_disk_usage()
            .with_memory(),
    );
    sys.refresh_cpu_usage();

    let mut processes: Vec<ProcessInfo> = plugin_pids
        .into_iter()
        .map(|(plugin_id, plugin_name, pid_opt)| {
            let (cpu_percent, memory_bytes, disk_read_bytes, disk_write_bytes, status, children) =
                match pid_opt {
                    Some(pid) => {
                        let sysinfo_pid = Pid::from(pid as usize);
                        match sys.process(sysinfo_pid) {
                            Some(proc) => {
                                let du = proc.disk_usage();
                                let mut children: Vec<ChildProcessInfo> = sys
                                    .processes()
                                    .iter()
                                    .filter(|(_, p)| p.parent() == Some(sysinfo_pid))
                                    .map(|(child_pid, child_proc)| {
                                        let cdu = child_proc.disk_usage();
                                        ChildProcessInfo {
                                            pid: child_pid.as_u32(),
                                            cpu_percent: child_proc.cpu_usage(),
                                            memory_bytes: child_proc.memory(),
                                            disk_read_bytes: cdu.read_bytes,
                                            disk_write_bytes: cdu.written_bytes,
                                        }
                                    })
                                    .collect();
                                children.sort_by_key(|c| c.pid);
                                (
                                    proc.cpu_usage(),
                                    proc.memory(),
                                    du.read_bytes,
                                    du.written_bytes,
                                    "running".to_string(),
                                    children,
                                )
                            }
                            None => (0.0, 0, 0, 0, "unknown".to_string(), vec![]),
                        }
                    }
                    None => (0.0, 0, 0, 0, "stopped".to_string(), vec![]),
                };

            ProcessInfo {
                plugin_id,
                plugin_name,
                pid: pid_opt,
                cpu_percent,
                memory_bytes,
                disk_read_bytes,
                disk_write_bytes,
                status,
                children,
            }
        })
        .collect();

    processes.sort_by(|a, b| a.plugin_name.cmp(&b.plugin_name));
    processes
}

fn refresh_and_collect_system_stats() -> SystemStats {
    let mut sys = SYSTEM.lock().expect("system mutex poisoned");
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new()
            .with_cpu()
            .with_disk_usage()
            .with_memory(),
    );
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    let process_count = sys.processes().len();

    // Real-time disk I/O: sum of per-process deltas since last refresh.
    let (disk_read_bytes, disk_write_bytes) = {
        let mut read: u64 = 0;
        let mut write: u64 = 0;
        for proc in sys.processes().values() {
            let du = proc.disk_usage();
            read = read.saturating_add(du.read_bytes);
            write = write.saturating_add(du.written_bytes);
        }
        (read, write)
    };

    // Tabularis self stats.
    let tabularis = get_current_pid().ok().map(|self_pid| {
        // Collect descendants recursively.
        let mut descendants: HashSet<Pid> = HashSet::new();
        let mut queue = vec![self_pid];
        while let Some(current) = queue.pop() {
            for (pid, proc) in sys.processes() {
                if proc.parent() == Some(current) && !descendants.contains(pid) {
                    descendants.insert(*pid);
                    queue.push(*pid);
                }
            }
        }

        // Main process stats.
        let self_memory_bytes = sys.process(self_pid).map(|p| p.memory()).unwrap_or(0);

        let mut total_cpu: f32 = sys.process(self_pid).map(|p| p.cpu_usage()).unwrap_or(0.0);
        let mut total_mem: u64 = self_memory_bytes;
        let mut total_dr: u64 = sys
            .process(self_pid)
            .map(|p| p.disk_usage().read_bytes)
            .unwrap_or(0);
        let mut total_dw: u64 = sys
            .process(self_pid)
            .map(|p| p.disk_usage().written_bytes)
            .unwrap_or(0);

        for pid in &descendants {
            if let Some(proc) = sys.process(*pid) {
                total_cpu += proc.cpu_usage();
                total_mem = total_mem.saturating_add(proc.memory());
                let du = proc.disk_usage();
                total_dr = total_dr.saturating_add(du.read_bytes);
                total_dw = total_dw.saturating_add(du.written_bytes);
            }
        }

        TabularisSelfStats {
            pid: self_pid.as_u32(),
            self_memory_bytes,
            total_memory_bytes: total_mem,
            cpu_percent: total_cpu,
            disk_read_bytes: total_dr,
            disk_write_bytes: total_dw,
            child_count: descendants.len(),
        }
    });

    SystemStats {
        cpu_percent,
        memory_used,
        memory_total,
        disk_read_bytes,
        disk_write_bytes,
        process_count,
        tabularis,
    }
}

fn collect_tabularis_children() -> Vec<TabularisChildProcess> {
    let mut sys = SYSTEM.lock().expect("system mutex poisoned");
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_cpu().with_memory(),
    );

    let self_pid = match get_current_pid() {
        Ok(p) => p,
        Err(_) => return vec![],
    };

    let mut descendants: HashSet<Pid> = HashSet::new();
    let mut queue = vec![self_pid];
    while let Some(current) = queue.pop() {
        for (pid, proc) in sys.processes() {
            if proc.parent() == Some(current) && !descendants.contains(pid) {
                descendants.insert(*pid);
                queue.push(*pid);
            }
        }
    }

    let mut children: Vec<TabularisChildProcess> = descendants
        .iter()
        .filter_map(|pid| {
            sys.process(*pid).map(|proc| TabularisChildProcess {
                pid: pid.as_u32(),
                name: proc.name().to_string_lossy().to_string(),
                cpu_percent: proc.cpu_usage(),
                memory_bytes: proc.memory(),
            })
        })
        .collect();
    children.sort_by_key(|c| c.pid);
    children
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_process_list() -> Result<Vec<ProcessInfo>, String> {
    let drivers = registry::list_drivers_with_pid().await;

    // Extract the data we need (non-blocking) before entering spawn_blocking.
    let plugin_pids: Vec<(String, String, Option<u32>)> = drivers
        .into_iter()
        .filter(|(manifest, _)| !manifest.is_builtin)
        .map(|(manifest, pid_opt)| (manifest.id, manifest.name, pid_opt))
        .collect();

    let processes =
        tokio::task::spawn_blocking(move || refresh_and_collect_process_stats(plugin_pids))
            .await
            .map_err(|e| format!("Failed to collect process stats: {}", e))?;

    Ok(processes)
}

#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    tokio::task::spawn_blocking(refresh_and_collect_system_stats)
        .await
        .map_err(|e| format!("Failed to collect system stats: {}", e))
}

#[tauri::command]
pub async fn get_tabularis_children() -> Result<Vec<TabularisChildProcess>, String> {
    tokio::task::spawn_blocking(collect_tabularis_children)
        .await
        .map_err(|e| format!("Failed to collect tabularis children: {}", e))
}

#[tauri::command]
pub async fn kill_plugin_process(plugin_id: String) -> Result<(), String> {
    registry::unregister_driver(&plugin_id).await;
    Ok(())
}

#[tauri::command]
pub async fn restart_plugin_process(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<(), String> {
    registry::unregister_driver(&plugin_id).await;

    // Give the OS a moment to release process resources before respawning.
    sleep(Duration::from_millis(500)).await;

    let plugin_cfg = crate::config::load_config_internal(&app)
        .plugins
        .and_then(|mut m| m.remove(&plugin_id));
    let interpreter_override = plugin_cfg.as_ref().and_then(|c| c.interpreter.clone());
    let settings = plugin_cfg.map(|c| c.settings).unwrap_or_default();
    let plugins_dir = installer::get_plugins_dir()
        .map_err(|e| format!("Could not locate plugins directory: {}", e))?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    if !plugin_dir.exists() {
        return Err(format!("Plugin '{}' is not installed", plugin_id));
    }
    load_plugin_from_dir(&plugin_dir, interpreter_override, settings)
        .await
        .map_err(|e| format!("Failed to restart plugin '{}': {}", plugin_id, e))?;

    Ok(())
}

#[tauri::command]
pub async fn open_task_manager_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("task-manager") {
        existing
            .set_focus()
            .map_err(|e| format!("Failed to focus task manager window: {}", e))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "task-manager",
        WebviewUrl::App("/task-manager".into()),
    )
    .title("tabularis - Task Manager")
    .inner_size(900.0, 600.0)
    .min_inner_size(700.0, 450.0)
    .center()
    .build()
    .map_err(|e| format!("Failed to create task manager window: {}", e))?;

    Ok(())
}
