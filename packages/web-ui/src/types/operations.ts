export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  target?: string | null;
}

export interface LogSettings {
  enabled: boolean;
  max_size: number;
  current_count: number;
}

export interface ChildProcessInfo {
  pid: number;
  cpu_percent: number;
  memory_bytes: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
}

export interface ProcessInfo {
  plugin_id: string;
  plugin_name: string;
  pid: number | null;
  cpu_percent: number;
  memory_bytes: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
  status: "running" | "stopped" | "unknown";
  children: ChildProcessInfo[];
}

export interface TabularisChildProcess {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_bytes: number;
}

export interface TabularisSelfStats {
  pid: number;
  cpu_percent: number;
  self_memory_bytes: number;
  total_memory_bytes: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
  child_count: number;
}

export interface SystemStats {
  cpu_percent: number;
  memory_used: number;
  memory_total: number;
  disk_read_bytes: number;
  disk_write_bytes: number;
  process_count: number;
  tabularis: TabularisSelfStats | null;
}
