import { describe, it, expect } from "vitest";
import { resolveRunTarget } from "./runTarget";

describe("resolveRunTarget", () => {
  it("runs the selection whenever one is active", () => {
    expect(
      resolveRunTarget({
        hasSelection: true,
        statementCount: 12,
        runStatementUnderCursor: true,
      }),
    ).toBe("selection");
  });

  it("prefers the selection over the statement under the cursor", () => {
    expect(
      resolveRunTarget({
        hasSelection: true,
        statementCount: 1,
        runStatementUnderCursor: false,
      }),
    ).toBe("selection");
  });

  it("runs the whole buffer when it holds a single statement", () => {
    expect(
      resolveRunTarget({
        hasSelection: false,
        statementCount: 1,
        runStatementUnderCursor: true,
      }),
    ).toBe("whole");
  });

  it("runs the whole buffer when it is empty", () => {
    expect(
      resolveRunTarget({
        hasSelection: false,
        statementCount: 0,
        runStatementUnderCursor: true,
      }),
    ).toBe("whole");
  });

  it("runs only the statement under the cursor for a multi-statement script", () => {
    expect(
      resolveRunTarget({
        hasSelection: false,
        statementCount: 21,
        runStatementUnderCursor: true,
      }),
    ).toBe("statement");
  });

  it("asks which statement to run when cursor execution is disabled", () => {
    expect(
      resolveRunTarget({
        hasSelection: false,
        statementCount: 21,
        runStatementUnderCursor: false,
      }),
    ).toBe("pick");
  });
});
