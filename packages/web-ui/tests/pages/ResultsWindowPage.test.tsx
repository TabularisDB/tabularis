import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsWindowPage } from "../../src/pages/ResultsWindowPage";
import { RESULTS_ACTION_EVENT, RESULTS_COPY_EVENT, RESULTS_SYNC_EVENT, singleResultToEntry, type ResultsSyncPayload } from "../../src/utils/resultsWindowSync";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  publish: vi.fn().mockResolvedValue(undefined),
  copy: vi.fn().mockResolvedValue(undefined),
  alert: vi.fn(), toast: vi.fn(),
  t: (key: string) => key,
}));
const platform = {
  publishRouteEvent: mocks.publish,
  subscribeRouteEvent: async (event: string, handler: (payload: unknown) => void) => {
    mocks.listeners.set(event, handler);
    return () => { mocks.listeners.delete(event); };
  },
};
vi.mock("../../src/hooks/usePlatformCapabilities", () => ({ usePlatformCapabilities: () => platform }));
vi.mock("../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.alert }) }));
vi.mock("../../src/hooks/useToast", () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock("../../src/utils/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams("session=session-1")] }));
vi.mock("../../src/components/ui/ResultEntryContent", () => ({
  ResultEntryContent: ({ onCopyAllRows }: { onCopyAllRows: () => void }) => <button onClick={onCopyAllRows}>Copy rows</button>,
}));
vi.mock("../../src/components/ui/MultiResultPanel", () => ({
  MultiResultPanel: ({ onCopyAllRows }: { onCopyAllRows: (entryId: string) => void }) => <button onClick={() => onCopyAllRows("entry-1")}>Copy entry</button>,
}));
const payload: ResultsSyncPayload = {
  tabId: "tab-1", tabTitle: "Query", query: "SELECT 1", result: { columns: ["id"], rows: [[1]], affected_rows: 0 },
  error: "", executionTime: 1, isLoading: false, activeTable: null, connectionId: "conn-1",
  copyFormat: "csv", csvDelimiter: ",", csvIncludeHeaders: true,
};

describe("detached result copy-all", () => {
  beforeEach(() => { mocks.listeners.clear(); vi.clearAllMocks(); });
  it.each([false, true])("forwards copy actions and writes results in the clicked window (multiple=%s)", async (multiple) => {
    const { unmount } = render(<ResultsWindowPage />);
    await waitFor(() => expect(mocks.listeners.has(RESULTS_SYNC_EVENT)).toBe(true));
    await act(async () => mocks.listeners.get(RESULTS_SYNC_EVENT)?.({ sessionId: "session-1", payload: {
      ...payload, ...(multiple ? { results: [{ ...singleResultToEntry(payload), id: "entry-1" }] } : {}),
    } }));
    fireEvent.click(screen.getByRole("button", { name: multiple ? "Copy entry" : "Copy rows" }));
    expect(mocks.publish).toHaveBeenCalledWith(RESULTS_ACTION_EVENT, {
      sessionId: "session-1", action: multiple ? { type: "copy-entry-all-rows", entryId: "entry-1" } : { type: "copy-all-rows" },
    });
    await act(async () => mocks.listeners.get(RESULTS_COPY_EVENT)?.({ tabId: "other-tab", text: "wrong", count: 1 }));
    expect(mocks.copy).not.toHaveBeenCalled();
    await act(async () => mocks.listeners.get(RESULTS_COPY_EVENT)?.({ tabId: "tab-1", text: "id\n1\n2", count: 2 }));
    expect(mocks.copy).toHaveBeenCalledWith("id\n1\n2");
    expect(mocks.toast).toHaveBeenCalledWith("dataGrid.copiedRows", { kind: "success" });
    unmount();
    await act(async () => {});
    expect(mocks.listeners.has(RESULTS_COPY_EVENT)).toBe(false);
  });
});
