import { describe, it, expect } from "vitest";
import {
  formatDiagnosticsReport,
  testStepLabelKey,
} from "../../src/utils/connectionTest";

describe("testStepLabelKey", () => {
  it("builds the key from step and status", () => {
    expect(testStepLabelKey({ step: "sshTunnel", status: "start" })).toBe(
      "connectionTest.steps.sshTunnel.start",
    );
    expect(testStepLabelKey({ step: "dbConnect", status: "error" })).toBe(
      "connectionTest.steps.dbConnect.error",
    );
  });

  it("uses the flat cancelled key regardless of step", () => {
    expect(testStepLabelKey({ step: "cancelled", status: "cancelled" })).toBe(
      "connectionTest.steps.cancelled",
    );
  });
});

describe("formatDiagnosticsReport", () => {
  it("joins all sections with blank lines", () => {
    const report = formatDiagnosticsReport({
      summary: "SSH tunnel failed",
      recovery: "Check the SSH tab.",
      logLines: ["10:00:00  Opening SSH tunnel", "10:00:05  SSH tunnel failed"],
      detail: "Connection refused",
    });
    expect(report).toBe(
      "SSH tunnel failed\n\nCheck the SSH tab.\n\n10:00:00  Opening SSH tunnel\n10:00:05  SSH tunnel failed\n\nConnection refused",
    );
  });

  it("omits empty sections", () => {
    const report = formatDiagnosticsReport({
      summary: "Connection failed",
      recovery: null,
      logLines: [],
      detail: null,
    });
    expect(report).toBe("Connection failed");
  });
});
