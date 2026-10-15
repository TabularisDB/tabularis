import type { ProcessInfo } from "../types/operations";

export type {
  ChildProcessInfo,
  ProcessInfo,
  SystemStats,
  TabularisChildProcess,
  TabularisSelfStats,
} from "../types/operations";

export type ProcessSortKey = keyof Pick<
  ProcessInfo,
  "plugin_name" | "cpu_percent" | "memory_bytes" | "status"
>;

const BYTES_IN_KB = 1024;
const BYTES_IN_MB = 1024 * 1024;
const BYTES_IN_GB = 1024 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";
  if (bytes < BYTES_IN_KB) return `${bytes} B`;
  if (bytes < BYTES_IN_MB) return `${(bytes / BYTES_IN_KB).toFixed(1)} KB`;
  if (bytes < BYTES_IN_GB) return `${(bytes / BYTES_IN_MB).toFixed(1)} MB`;
  return `${(bytes / BYTES_IN_GB).toFixed(2)} GB`;
}

export function formatCpuPercent(pct: number): string {
  if (pct <= 0) return "0.0%";
  if (pct >= 100) return "100.0%";
  return `${pct.toFixed(1)}%`;
}

export function formatMemoryBar(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

export function getStatusColor(status: ProcessInfo["status"]): string {
  switch (status) {
    case "running":
      return "text-accent-success";
    case "stopped":
      return "text-accent-error";
    case "unknown":
    default:
      return "text-accent-warning";
  }
}

export function getStatusBadgeColor(status: ProcessInfo["status"]): string {
  switch (status) {
    case "running":
      return "bg-accent-success/20 text-accent-success border border-accent-success/30";
    case "stopped":
      return "bg-accent-error/20 text-accent-error border border-accent-error/30";
    case "unknown":
    default:
      return "bg-accent-warning/20 text-accent-warning border border-accent-warning/30";
  }
}

export function sortProcesses(
  processes: ProcessInfo[],
  key: ProcessSortKey,
  ascending: boolean,
): ProcessInfo[] {
  return [...processes].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];

    let cmp: number;
    if (typeof aVal === "string" && typeof bVal === "string") {
      cmp = aVal.localeCompare(bVal);
    } else {
      cmp = (aVal as number) - (bVal as number);
    }

    return ascending ? cmp : -cmp;
  });
}

export function buildProcessRows(processes: ProcessInfo[]): ProcessInfo[] {
  return processes.map((p) => ({
    ...p,
    cpu_percent: Math.max(0, p.cpu_percent),
    memory_bytes: Math.max(0, p.memory_bytes),
    children: p.children.map((c) => ({
      ...c,
      cpu_percent: Math.max(0, c.cpu_percent),
      memory_bytes: Math.max(0, c.memory_bytes),
    })),
  }));
}
