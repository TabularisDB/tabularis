use crate::drivers::registry;
use crate::logger::{LogEntry, SharedLogBuffer};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Mutex;
use sysinfo::{get_current_pid, Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

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

#[derive(Debug)]
pub enum OperationalCommand {
    GetLogs(GetLogsRequest),
    ClearLogs,
    GetLogSettings,
    SetLogEnabled { enabled: bool },
    SetLogMaxSize { max_size: usize },
    GetProcessList,
    GetSystemStats,
    GetTabularisChildren,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GetLogsRequest {
    pub limit: Option<usize>,
    pub level_filter: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogSettings {
    pub enabled: bool,
    pub max_size: usize,
    pub current_count: usize,
}

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
    pub self_memory_bytes: u64,
    pub total_memory_bytes: u64,
    pub cpu_percent: f32,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub child_count: usize,
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

pub async fn execute(command: OperationalCommand) -> Result<Value, String> {
    match command {
        OperationalCommand::GetLogs(request) => json(get_logs(&log_buffer(), request)),
        OperationalCommand::ClearLogs => {
            clear_logs(&log_buffer())?;
            Ok(Value::Null)
        }
        OperationalCommand::GetLogSettings => json(get_log_settings(&log_buffer())),
        OperationalCommand::SetLogEnabled { enabled } => {
            set_log_enabled(&log_buffer(), enabled)?;
            Ok(Value::Null)
        }
        OperationalCommand::SetLogMaxSize { max_size } => {
            set_log_max_size(&log_buffer(), max_size)?;
            Ok(Value::Null)
        }
        OperationalCommand::GetProcessList => json(get_process_list().await?),
        OperationalCommand::GetSystemStats => json(get_system_stats().await?),
        OperationalCommand::GetTabularisChildren => json(get_tabularis_children().await?),
    }
}

fn log_buffer() -> SharedLogBuffer {
    crate::runtime::bootstrap::get_log_buffer()
}

pub fn get_logs(log_buffer: &SharedLogBuffer, request: GetLogsRequest) -> Vec<LogEntry> {
    let buffer = log_buffer.lock().unwrap_or_else(|error| error.into_inner());
    buffer.get_entries(request.limit, request.level_filter)
}

pub fn clear_logs(log_buffer: &SharedLogBuffer) -> Result<(), String> {
    let mut buffer = log_buffer
        .lock()
        .map_err(|_| "Log buffer is unavailable".to_string())?;
    buffer.clear();
    Ok(())
}

pub fn get_log_settings(log_buffer: &SharedLogBuffer) -> LogSettings {
    let buffer = log_buffer.lock().unwrap_or_else(|error| error.into_inner());
    LogSettings {
        enabled: buffer.is_enabled(),
        max_size: buffer.get_max_size(),
        current_count: buffer.get_entries(None, None).len(),
    }
}

pub fn set_log_enabled(log_buffer: &SharedLogBuffer, enabled: bool) -> Result<(), String> {
    let mut buffer = log_buffer
        .lock()
        .map_err(|_| "Log buffer is unavailable".to_string())?;
    buffer.set_enabled(enabled);
    Ok(())
}

pub fn set_log_max_size(log_buffer: &SharedLogBuffer, max_size: usize) -> Result<(), String> {
    if max_size == 0 || max_size > 10_000 {
        return Err("Max size must be between 1 and 10000".to_string());
    }
    let mut buffer = log_buffer
        .lock()
        .map_err(|_| "Log buffer is unavailable".to_string())?;
    buffer.set_max_size(max_size);
    Ok(())
}

pub async fn get_process_list() -> Result<Vec<ProcessInfo>, String> {
    let drivers = registry::list_drivers_with_pid().await;
    let plugin_pids = drivers
        .into_iter()
        .filter(|(manifest, _)| !manifest.is_builtin)
        .map(|(manifest, pid)| (manifest.id, manifest.name, pid))
        .collect();

    tokio::task::spawn_blocking(move || refresh_and_collect_process_stats(plugin_pids))
        .await
        .map_err(|error| format!("Failed to collect process stats: {error}"))
}

pub async fn get_system_stats() -> Result<SystemStats, String> {
    tokio::task::spawn_blocking(refresh_and_collect_system_stats)
        .await
        .map_err(|error| format!("Failed to collect system stats: {error}"))
}

pub async fn get_tabularis_children() -> Result<Vec<TabularisChildProcess>, String> {
    tokio::task::spawn_blocking(collect_tabularis_children)
        .await
        .map_err(|error| format!("Failed to collect tabularis children: {error}"))
}

fn refresh_and_collect_process_stats(
    plugin_pids: Vec<(String, String, Option<u32>)>,
) -> Vec<ProcessInfo> {
    let mut system = SYSTEM.lock().unwrap_or_else(|error| error.into_inner());
    refresh_processes(&mut system, true);

    let mut processes = plugin_pids
        .into_iter()
        .map(|(plugin_id, plugin_name, pid)| {
            let (cpu_percent, memory_bytes, disk_read_bytes, disk_write_bytes, status, children) =
                match pid {
                    Some(pid) => process_stats(&system, pid),
                    None => (0.0, 0, 0, 0, "stopped".to_string(), Vec::new()),
                };
            ProcessInfo {
                plugin_id,
                plugin_name,
                pid,
                cpu_percent,
                memory_bytes,
                disk_read_bytes,
                disk_write_bytes,
                status,
                children,
            }
        })
        .collect::<Vec<_>>();
    processes.sort_by(|left, right| left.plugin_name.cmp(&right.plugin_name));
    processes
}

fn process_stats(system: &System, pid: u32) -> (f32, u64, u64, u64, String, Vec<ChildProcessInfo>) {
    let system_pid = Pid::from(pid as usize);
    let Some(process) = system.process(system_pid) else {
        return (0.0, 0, 0, 0, "unknown".to_string(), Vec::new());
    };
    let disk = process.disk_usage();
    let mut children = system
        .processes()
        .iter()
        .filter(|(_, child)| child.parent() == Some(system_pid))
        .map(|(child_pid, child)| {
            let disk = child.disk_usage();
            ChildProcessInfo {
                pid: child_pid.as_u32(),
                cpu_percent: child.cpu_usage(),
                memory_bytes: child.memory(),
                disk_read_bytes: disk.read_bytes,
                disk_write_bytes: disk.written_bytes,
            }
        })
        .collect::<Vec<_>>();
    children.sort_by_key(|child| child.pid);
    (
        process.cpu_usage(),
        process.memory(),
        disk.read_bytes,
        disk.written_bytes,
        "running".to_string(),
        children,
    )
}

fn refresh_and_collect_system_stats() -> SystemStats {
    let mut system = SYSTEM.lock().unwrap_or_else(|error| error.into_inner());
    refresh_processes(&mut system, true);
    system.refresh_memory();

    let (disk_read_bytes, disk_write_bytes) =
        system
            .processes()
            .values()
            .fold((0_u64, 0_u64), |(read, write), process| {
                let disk = process.disk_usage();
                (
                    read.saturating_add(disk.read_bytes),
                    write.saturating_add(disk.written_bytes),
                )
            });

    SystemStats {
        cpu_percent: system.global_cpu_usage(),
        memory_used: system.used_memory(),
        memory_total: system.total_memory(),
        disk_read_bytes,
        disk_write_bytes,
        process_count: system.processes().len(),
        tabularis: get_current_pid()
            .ok()
            .map(|pid| collect_tabularis_stats(&system, pid)),
    }
}

fn collect_tabularis_stats(system: &System, self_pid: Pid) -> TabularisSelfStats {
    let descendants = descendants(system, self_pid);
    let self_memory_bytes = system
        .process(self_pid)
        .map(|process| process.memory())
        .unwrap_or(0);
    let mut total_memory_bytes = self_memory_bytes;
    let mut cpu_percent = 0.0;
    let mut disk_read_bytes = 0_u64;
    let mut disk_write_bytes = 0_u64;

    for pid in std::iter::once(&self_pid).chain(descendants.iter()) {
        if let Some(process) = system.process(*pid) {
            cpu_percent += process.cpu_usage();
            if *pid != self_pid {
                total_memory_bytes = total_memory_bytes.saturating_add(process.memory());
            }
            let disk = process.disk_usage();
            disk_read_bytes = disk_read_bytes.saturating_add(disk.read_bytes);
            disk_write_bytes = disk_write_bytes.saturating_add(disk.written_bytes);
        }
    }

    TabularisSelfStats {
        pid: self_pid.as_u32(),
        self_memory_bytes,
        total_memory_bytes,
        cpu_percent,
        disk_read_bytes,
        disk_write_bytes,
        child_count: descendants.len(),
    }
}

fn collect_tabularis_children() -> Vec<TabularisChildProcess> {
    let mut system = SYSTEM.lock().unwrap_or_else(|error| error.into_inner());
    refresh_processes(&mut system, false);
    let Ok(self_pid) = get_current_pid() else {
        return Vec::new();
    };
    let mut children = descendants(&system, self_pid)
        .into_iter()
        .filter_map(|pid| {
            system.process(pid).map(|process| TabularisChildProcess {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().to_string(),
                cpu_percent: process.cpu_usage(),
                memory_bytes: process.memory(),
            })
        })
        .collect::<Vec<_>>();
    children.sort_by_key(|child| child.pid);
    children
}

fn refresh_processes(system: &mut System, include_disk: bool) {
    let refresh = ProcessRefreshKind::new().with_cpu().with_memory();
    let refresh = if include_disk {
        refresh.with_disk_usage()
    } else {
        refresh
    };
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh);
    system.refresh_cpu_usage();
}

fn descendants(system: &System, root: Pid) -> HashSet<Pid> {
    let mut descendants = HashSet::new();
    let mut pending = vec![root];
    while let Some(parent) = pending.pop() {
        for (pid, process) in system.processes() {
            if process.parent() == Some(parent) && descendants.insert(*pid) {
                pending.push(*pid);
            }
        }
    }
    descendants
}

fn json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
