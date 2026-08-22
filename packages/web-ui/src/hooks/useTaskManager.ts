import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessInfo, SystemStats } from "../utils/taskManager";
import { buildProcessRows } from "../utils/taskManager";
import { useTabularisClient } from "./useTabularisClient";

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
  const client = useTabularisClient();
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
        client.call("get_process_list", undefined),
        client.call("get_system_stats", undefined),
      ]);
      setProcesses(buildProcessRows(procs));
      setSystemStats(stats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

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
        await client.call("kill_plugin_process", { pluginId });
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
    [client, fetchData],
  );

  const restartProcess = useCallback(
    async (pluginId: string) => {
      setRestarting((prev) => new Set(prev).add(pluginId));
      try {
        await client.call("restart_plugin_process", { pluginId });
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
    [client, fetchData],
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
