import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoRefresh } from "../../src/hooks/useAutoRefresh";
import { createAutoRefreshSchedule } from "../../src/utils/autoRefresh";

describe("useAutoRefresh", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it.each([5000, 10000, 30000, 60000])("waits the selected %i ms before polling", async (interval) => {
    const refresh = vi.fn();
    const schedule = createAutoRefreshSchedule();
    renderHook(() => useAutoRefresh(interval, true, refresh, schedule));
    await advance(interval - 1);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(interval);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not poll when Off or disabled and cleans up on unmount", async () => {
    const refresh = vi.fn();
    const schedule = createAutoRefreshSchedule();
    const { rerender, unmount } = renderHook(({ interval, enabled }) =>
      useAutoRefresh(interval, enabled, refresh, schedule), { initialProps: { interval: 0, enabled: true } });
    await advance(60000);
    rerender({ interval: 5000, enabled: false });
    await advance(60000);
    expect(refresh).not.toHaveBeenCalled();
    rerender({ interval: 5000, enabled: true });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the deadline through repeated switches and remounts", async () => {
    const refresh = vi.fn();
    const schedule = createAutoRefreshSchedule();
    const mount = () => renderHook(({ active }) => useAutoRefresh(30000, active, refresh, schedule),
      { initialProps: { active: true } });
    const first = mount();
    await advance(10000);
    first.rerender({ active: false });
    expect(vi.getTimerCount()).toBe(0);
    await advance(10000);
    first.rerender({ active: true });
    first.unmount();
    mount();
    await advance(9999);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes once immediately when reactivated overdue, without catch-up", async () => {
    const refresh = vi.fn();
    const schedule = createAutoRefreshSchedule();
    const { rerender } = renderHook(({ active }) => useAutoRefresh(5000, active, refresh, schedule),
      { initialProps: { active: true } });
    await advance(2000);
    rerender({ active: false });
    await advance(60000);
    rerender({ active: true });
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(4999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("uses the current callback without moving the deadline", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const schedule = createAutoRefreshSchedule();
    const { rerender } = renderHook(({ callback }) => useAutoRefresh(5000, true, callback, schedule),
      { initialProps: { callback: first } });
    await advance(4000);
    rerender({ callback: second });
    await advance(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("keeps independent schedules when switching between equal intervals", async () => {
    const first = createAutoRefreshSchedule();
    const second = createAutoRefreshSchedule();
    const refresh = vi.fn();
    const { rerender } = renderHook(({ schedule }) => useAutoRefresh(5000, true, refresh, schedule),
      { initialProps: { schedule: first } });
    await advance(2000);
    rerender({ schedule: second });
    await advance(2000);
    rerender({ schedule: first });
    await advance(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ schedule: second });
    await advance(2000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits for slow callbacks before scheduling the next attempt", async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const schedule = createAutoRefreshSchedule();
    renderHook(() => useAutoRefresh(5000, true, refresh, schedule));
    await advance(30000);
    expect(refresh).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    await advance(4999);
    expect(refresh).toHaveBeenCalledOnce();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("retains an overdue deadline while edits block refresh and resumes once safe", async () => {
    const schedule = createAutoRefreshSchedule();
    const refresh = vi.fn();
    const { rerender } = renderHook(({ blocked }) => useAutoRefresh(5000, true, refresh, schedule, blocked),
      { initialProps: { blocked: true } });
    await advance(60000);
    expect(vi.getTimerCount()).toBe(0);
    expect(schedule.getSnapshot().nextDueAt).toBe(5000);
    rerender({ blocked: false });
    await advance(0);
    expect(refresh).toHaveBeenCalledOnce();
    act(() => schedule.setEditing(true));
    await advance(60000);
    expect(refresh).toHaveBeenCalledOnce();
    act(() => schedule.setEditing(false));
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("recalculates an interval from the last completed request", async () => {
    const schedule = createAutoRefreshSchedule();
    act(() => schedule.complete());
    const refresh = vi.fn();
    const { rerender } = renderHook(({ interval }) => useAutoRefresh(interval, true, refresh, schedule),
      { initialProps: { interval: 30000 } });
    await advance(4000);
    rerender({ interval: 5000 });
    await advance(999);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("limits rejected callbacks to the selected retry interval", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refresh = vi.fn().mockRejectedValue(new Error("offline"));
    const schedule = createAutoRefreshSchedule();
    renderHook(() => useAutoRefresh(5000, true, refresh, schedule));
    await advance(5000);
    expect(refresh).toHaveBeenCalledOnce();
    await advance(4999);
    expect(refresh).toHaveBeenCalledOnce();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate requests under Strict Mode", async () => {
    const refresh = vi.fn();
    const schedule = createAutoRefreshSchedule();
    renderHook(() => useAutoRefresh(5000, true, refresh, schedule), { wrapper: StrictMode });
    expect(vi.getTimerCount()).toBe(1);
    await advance(5000);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
