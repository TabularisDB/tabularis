/**
 * Types and helpers for the connection-test progress log.
 *
 * The backend emits "connection-test-progress" events while `test_connection`
 * runs (see `emit_test_progress` in commands.rs); the modal collects them into
 * a timestamped log rendered live and inside the diagnostics modal.
 */

export type ConnectionTestStepStatus = "start" | "ok" | "error" | "cancelled";

/** Payload of a "connection-test-progress" Tauri event. */
export interface ConnectionTestProgressPayload {
  id: string;
  step: string;
  status: "start" | "ok" | "error";
  detail?: string | null;
}

export interface ConnectionTestLogEntry {
  step: string;
  status: ConnectionTestStepStatus;
  detail: string | null;
  timestamp: number;
}

/** i18n key for a log entry's label; falls back to the raw step name. */
export function testStepLabelKey(entry: {
  step: string;
  status: ConnectionTestStepStatus;
}): string {
  if (entry.status === "cancelled") {
    return "connectionTest.steps.cancelled";
  }
  return `connectionTest.steps.${entry.step}.${entry.status}`;
}

export function formatTestLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });
}

/** Plain-text report for the "copy diagnostics" button. */
export function formatDiagnosticsReport(options: {
  summary: string;
  recovery: string | null;
  logLines: string[];
  detail: string | null;
}): string {
  const sections: string[] = [options.summary];
  if (options.recovery) {
    sections.push(options.recovery);
  }
  if (options.logLines.length > 0) {
    sections.push(options.logLines.join("\n"));
  }
  if (options.detail) {
    sections.push(options.detail);
  }
  return sections.join("\n\n");
}
