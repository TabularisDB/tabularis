import { describe, expect, it, vi } from "vitest";

import { createActiveEditorCommands } from "../../src/utils/editorCommands";

const labels = {
  run: "Run statement",
  runAll: "Run all",
  saveSqlFile: "Save SQL file",
  closeTab: "Close tab",
};

const actions = () => ({
  run: vi.fn(),
  runAll: vi.fn(),
  saveSqlFile: vi.fn(),
  closeTab: vi.fn(),
});

describe("createActiveEditorCommands", () => {
  it("should expose all applicable commands for a multi-statement console", () => {
    const commands = createActiveEditorCommands({
      tabType: "console",
      hasConnection: true,
      hasRunnableQuery: true,
      isReadOnly: false,
      isLoading: false,
      canSaveSqlFile: true,
      statementCount: 2,
      labels,
      actions: actions(),
    });

    expect(Object.keys(commands)).toEqual([
      "closeTab",
      "saveSqlFile",
      "run",
      "runAll",
    ]);
    expect(commands.run?.label).toBe("Run statement");
  });

  it("should keep close tab available when the console cannot run", () => {
    const commands = createActiveEditorCommands({
      tabType: "console",
      hasConnection: false,
      hasRunnableQuery: false,
      isReadOnly: false,
      isLoading: false,
      canSaveSqlFile: false,
      statementCount: 0,
      labels,
      actions: actions(),
    });

    expect(Object.keys(commands)).toEqual(["closeTab"]);
  });

  it("should run table tabs without SQL text but omit console-only commands", () => {
    const commands = createActiveEditorCommands({
      tabType: "table",
      hasConnection: true,
      hasRunnableQuery: true,
      isReadOnly: false,
      isLoading: false,
      canSaveSqlFile: false,
      statementCount: 0,
      labels,
      actions: actions(),
    });

    expect(Object.keys(commands)).toEqual(["closeTab", "run"]);
  });

  it("should not offer run commands while a query is loading", () => {
    const commands = createActiveEditorCommands({
      tabType: "console",
      hasConnection: true,
      hasRunnableQuery: true,
      isReadOnly: false,
      isLoading: true,
      canSaveSqlFile: false,
      statementCount: 2,
      labels,
      actions: actions(),
    });

    expect(Object.keys(commands)).toEqual(["closeTab"]);
  });
});
