import { describe, expect, it } from "vitest";
import { createAutoRefreshSchedule, hasPendingTableEdits, normalizeAutoRefreshInterval, tableRefreshIdentity } from "../../src/utils/autoRefresh";
import { restoreTabFromStorage } from "../../src/utils/tabCleaner";

describe("auto-refresh schedule", () => {
  it("normalizes saved intervals to supported presets", () => {
    for (const value of [undefined, null, -1, 1, "5000", NaN]) expect(normalizeAutoRefreshInterval(value)).toBe(0);
    for (const value of [0, 5000, 10000, 30000, 60000]) expect(normalizeAutoRefreshInterval(value)).toBe(value);
  });

  it("recognizes every pending edit type independently", () => {
    expect(hasPendingTableEdits({})).toBe(false);
    expect(hasPendingTableEdits({ pendingChanges: {}, pendingInsertions: {}, pendingDeletions: {} })).toBe(false);
    expect(hasPendingTableEdits({ pendingChanges: { id: { pkOriginalValue: 1, changes: { name: "changed" } } } })).toBe(true);
    expect(hasPendingTableEdits({ pendingInsertions: { id: { tempId: "id", data: {}, displayIndex: 0 } } })).toBe(true);
    expect(hasPendingTableEdits({ pendingDeletions: { id: 1 } })).toBe(true);
  });

  it("identifies navigation independently of refreshed result data", () => {
    const tab = restoreTabFromStorage({ type: "table", query: "SELECT * FROM jobs", page: 2 });
    const identity = tableRefreshIdentity(tab);
    expect(tableRefreshIdentity({ ...tab, isLoading: true, executionTime: 20 })).toBe(identity);
    expect(tableRefreshIdentity({ ...tab, page: 3 })).not.toBe(identity);
    expect(tableRefreshIdentity({ ...tab, connectionId: "another-connection" })).not.toBe(identity);
    expect(tableRefreshIdentity({ ...tab, filterClause: "id > 100" })).not.toBe(identity);
  });

  it("reserves a query synchronously, skips automatic requests, and queues explicit requests", async () => {
    const schedule = createAutoRefreshSchedule();
    let finish!: () => void;
    const order: string[] = [];
    const first = schedule.run(async () => {
      order.push("first");
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    expect(schedule.getSnapshot().busy).toBe(true);
    const skipped = schedule.run(async () => { order.push("automatic"); }, true);
    const second = schedule.run(async () => { order.push("second"); });
    await skipped;
    expect(order).toEqual(["first"]);
    finish();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    expect(schedule.getSnapshot().busy).toBe(false);
  });

  it("releases failed requests and invalidates results when editing changes", async () => {
    const schedule = createAutoRefreshSchedule();
    await expect(schedule.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(schedule.getSnapshot().busy).toBe(false);
    const revision = schedule.getSnapshot().revision;
    schedule.setEditing(true);
    schedule.setEditing(false);
    expect(schedule.getSnapshot().revision).toBeGreaterThan(revision);
    expect(await schedule.run(async () => "next")).toBe("next");
  });
});
