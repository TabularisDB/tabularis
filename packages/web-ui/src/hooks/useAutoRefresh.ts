import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AutoRefreshSchedule } from "../utils/autoRefresh";

/** A false callback result leaves an overdue deadline intact until unblocked. */
export function useAutoRefresh(
  intervalMs: number,
  enabled: boolean,
  callback: () => void | boolean | Promise<void | boolean>,
  schedule: AutoRefreshSchedule,
  blocked = false,
) {
  const snapshot = useSyncExternalStore(schedule.subscribe, schedule.getSnapshot);
  const latestCallback = useRef(callback);
  const running = useRef(new Set<AutoRefreshSchedule>());

  useEffect(() => { latestCallback.current = callback; }, [callback]);
  useEffect(() => { schedule.configure(intervalMs); }, [intervalMs, schedule]);
  useEffect(() => () => { schedule.invalidate(); }, [enabled, schedule]);

  useEffect(() => {
    if (!enabled || blocked || snapshot.busy || snapshot.editing || snapshot.nextDueAt === null) return;
    const timer = setTimeout(async () => {
      if (running.current.has(schedule)) return;
      running.current.add(schedule);
      let attempted = true;
      try {
        attempted = (await latestCallback.current()) !== false;
      } catch (error) {
        console.error("Auto-refresh failed:", error);
      } finally {
        running.current.delete(schedule);
        if (attempted) schedule.complete();
      }
    }, Math.max(0, snapshot.nextDueAt - Date.now()));
    return () => clearTimeout(timer);
  }, [enabled, blocked, snapshot, schedule]);

  return snapshot;
}
