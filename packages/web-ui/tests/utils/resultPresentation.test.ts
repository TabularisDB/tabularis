import { describe, expect, it } from "vitest";
import type { Tab } from "../../src/types/editor";
import { shouldShowStatementSuccess } from "../../src/utils/resultPresentation";

function resultTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    title: "Result",
    type: "console",
    query: "",
    result: {
      columns: [],
      rows: [],
      affected_rows: 0,
    },
    error: "",
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumns: null,
    connectionId: "connection-1",
    ...overrides,
  };
}

describe("resultPresentation", () => {
  describe("shouldShowStatementSuccess", () => {
    it("shows success for a command without a result set", () => {
      expect(shouldShowStatementSuccess(resultTab())).toBe(true);
    });

    it("keeps an empty table tab in data mode so the first row can be added", () => {
      expect(
        shouldShowStatementSuccess(
          resultTab({ type: "table", activeTable: "users" }),
        ),
      ).toBe(false);
    });

    it("keeps rendering pending insertions", () => {
      expect(
        shouldShowStatementSuccess(
          resultTab({
            pendingInsertions: {
              temporary: {
                tempId: "temporary",
                data: {},
                displayIndex: 0,
              },
            },
          }),
        ),
      ).toBe(false);
    });

    it("does not show success before a result exists", () => {
      expect(shouldShowStatementSuccess(resultTab({ result: null }))).toBe(
        false,
      );
    });
  });
});
