import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProcessInfo, SystemStats } from "../utils/taskManager";
import { buildProcessRows } from "../utils/taskManager";

const POLL_INTERVAL_MS = 2000;

interface UseTaskManagerResult {
  processes: ProcessInfo[];
  systemStats: SystemStats | null;
  loading: boolean;
  error: string | null;
  killing: Set<string>;
  restarting: Set<string>;
  refresh: () => Promise<void>;
  killProcess: (pluginId: string) => Promise<void>;
  restartProcess: (pluginId: string) => Promise<void>;
}

export function useTaskManager(): UseTaskManagerResult {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<Set<string>>(new Set());
  const [restarting, setRestarting] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [procs, stats] = await Promise.all([
        invoke<ProcessInfo[]>("get_process_list"),
        invoke<SystemStats>("get_system_stats"),
      ]);
      setProcesses(buildProcessRows(procs));
      setSystemStats(stats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData]);

  const killProcess = useCallback(
    async (pluginId: string) => {
      setKilling((prev) => new Set(prev).add(pluginId));
      try {
        await invoke("kill_plugin_process", { pluginId });
        await fetchData();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setKilling((prev) => {
          const next = new Set(prev);
          next.delete(pluginId);
          return next;
        });
      }
    },
    [fetchData],
  );

  const restartProcess = useCallback(
    async (pluginId: string) => {
      setRestarting((prev) => new Set(prev).add(pluginId));
      try {
        await invoke("disable_plugin", { pluginId });
        await invoke("enable_plugin", { pluginId });
        await fetchData();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRestarting((prev) => {
          const next = new Set(prev);
          next.delete(pluginId);
          return next;
        });
      }
    },
    [fetchData],
  );

  return {
    processes,
    systemStats,
    loading,
    error,
    killing,
    restarting,
    refresh,
    killProcess,
    restartProcess,
  };
}
