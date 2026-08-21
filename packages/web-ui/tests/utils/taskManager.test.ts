import { describe, expect, it } from "vitest";
import {
  buildProcessRows,
  formatBytes,
  formatCpuPercent,
  formatMemoryBar,
  getStatusBadgeColor,
  getStatusColor,
  sortProcesses,
} from "../../src/utils/taskManager";
import type { ProcessInfo } from "../../src/utils/taskManager";

const makeProcess = (overrides: Partial<ProcessInfo> = {}): ProcessInfo => ({
  plugin_id: "test-plugin",
  plugin_name: "Test Plugin",
  pid: 1234,
  cpu_percent: 5.0,
  memory_bytes: 1024 * 1024,
  disk_read_bytes: 0,
  disk_write_bytes: 0,
  status: "running",
  children: [],
  ...overrides,
});

describe("taskManager utils", () => {
  describe("formatBytes", () => {
    it("returns '0 B' for zero", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    it("returns '0 B' for negative values", () => {
      expect(formatBytes(-100)).toBe("0 B");
    });

    it("formats bytes under 1 KB", () => {
      expect(formatBytes(512)).toBe("512 B");
    });

    it("formats KB correctly", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("formats MB correctly", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
    });

    it("formats GB correctly", () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
      expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe("2.00 GB");
    });
  });

  describe("formatCpuPercent", () => {
    it("returns '0.0%' for zero", () => {
      expect(formatCpuPercent(0)).toBe("0.0%");
    });

    it("returns '0.0%' for negative values", () => {
      expect(formatCpuPercent(-5)).toBe("0.0%");
    });

    it("returns '100.0%' for values >= 100", () => {
      expect(formatCpuPercent(100)).toBe("100.0%");
      expect(formatCpuPercent(150)).toBe("100.0%");
    });

    it("formats decimal values correctly", () => {
      expect(formatCpuPercent(5.678)).toBe("5.7%");
      expect(formatCpuPercent(33.3)).toBe("33.3%");
      expect(formatCpuPercent(99.99)).toBe("100.0%");
    });
  });

  describe("formatMemoryBar", () => {
    it("returns 0 for total <= 0", () => {
      expect(formatMemoryBar(0, 0)).toBe(0);
      expect(formatMemoryBar(100, 0)).toBe(0);
    });

    it("returns correct percentage", () => {
      expect(formatMemoryBar(512, 1024)).toBe(50);
      expect(formatMemoryBar(256, 1024)).toBe(25);
    });

    it("caps at 100", () => {
      expect(formatMemoryBar(2048, 1024)).toBe(100);
    });

    it("rounds to nearest integer", () => {
      expect(formatMemoryBar(333, 1000)).toBe(33);
    });
  });

  describe("getStatusColor", () => {
    it("returns green for running", () => {
      expect(getStatusColor("running")).toContain("green");
    });

    it("returns red for stopped", () => {
      expect(getStatusColor("stopped")).toContain("red");
    });

    it("returns yellow for unknown", () => {
      expect(getStatusColor("unknown")).toContain("yellow");
    });
  });

  describe("getStatusBadgeColor", () => {
    it("returns green badge for running", () => {
      const cls = getStatusBadgeColor("running");
      expect(cls).toContain("green");
    });

    it("returns red badge for stopped", () => {
      const cls = getStatusBadgeColor("stopped");
      expect(cls).toContain("red");
    });

    it("returns yellow badge for unknown", () => {
      const cls = getStatusBadgeColor("unknown");
      expect(cls).toContain("yellow");
    });
  });

  describe("sortProcesses", () => {
    const alpha = makeProcess({ plugin_id: "a", plugin_name: "Alpha", cpu_percent: 80, memory_bytes: 100 });
    const beta = makeProcess({ plugin_id: "b", plugin_name: "Beta", cpu_percent: 20, memory_bytes: 300 });
    const gamma = makeProcess({ plugin_id: "c", plugin_name: "Gamma", cpu_percent: 50, memory_bytes: 200 });
    const items = [gamma, alpha, beta];

    it("sorts by plugin_name ascending", () => {
      const result = sortProcesses(items, "plugin_name", true);
      expect(result.map((p) => p.plugin_name)).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("sorts by plugin_name descending", () => {
      const result = sortProcesses(items, "plugin_name", false);
      expect(result.map((p) => p.plugin_name)).toEqual(["Gamma", "Beta", "Alpha"]);
    });

    it("sorts by cpu_percent ascending", () => {
      const result = sortProcesses(items, "cpu_percent", true);
      expect(result.map((p) => p.cpu_percent)).toEqual([20, 50, 80]);
    });

    it("sorts by cpu_percent descending", () => {
      const result = sortProcesses(items, "cpu_percent", false);
      expect(result.map((p) => p.cpu_percent)).toEqual([80, 50, 20]);
    });

    it("sorts by memory_bytes ascending", () => {
      const result = sortProcesses(items, "memory_bytes", true);
      expect(result.map((p) => p.memory_bytes)).toEqual([100, 200, 300]);
    });

    it("does not mutate the original array", () => {
      const original = [...items];
      sortProcesses(items, "plugin_name", true);
      expect(items).toEqual(original);
    });

    it("handles empty array", () => {
      expect(sortProcesses([], "plugin_name", true)).toEqual([]);
    });

    it("handles single-element array", () => {
      const single = [makeProcess()];
      expect(sortProcesses(single, "plugin_name", true)).toEqual(single);
    });
  });

  describe("buildProcessRows", () => {
    it("returns empty array for empty input", () => {
      expect(buildProcessRows([])).toEqual([]);
    });

    it("clamps negative cpu_percent to 0", () => {
      const proc = makeProcess({ cpu_percent: -10 });
      const result = buildProcessRows([proc]);
      expect(result[0].cpu_percent).toBe(0);
    });

    it("clamps negative memory_bytes to 0", () => {
      const proc = makeProcess({ memory_bytes: -500 });
      const result = buildProcessRows([proc]);
      expect(result[0].memory_bytes).toBe(0);
    });

    it("preserves valid positive values", () => {
      const proc = makeProcess({ cpu_percent: 42.5, memory_bytes: 8 * 1024 * 1024 });
      const result = buildProcessRows([proc]);
      expect(result[0].cpu_percent).toBe(42.5);
      expect(result[0].memory_bytes).toBe(8 * 1024 * 1024);
    });

    it("does not mutate the original array", () => {
      const proc = makeProcess({ cpu_percent: -5 });
      buildProcessRows([proc]);
      expect(proc.cpu_percent).toBe(-5);
    });
  });
});
