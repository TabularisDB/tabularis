import type { EditorCommands } from "../types/commands";
import type { Tab } from "../types/editor";

interface CreateActiveEditorCommandsOptions {
  tabType: Tab["type"];
  hasConnection: boolean;
  hasRunnableQuery: boolean;
  isReadOnly: boolean;
  isLoading: boolean;
  canSaveSqlFile: boolean;
  statementCount: number;
  labels: {
    run: string;
    runAll: string;
    saveSqlFile: string;
    closeTab: string;
  };
  actions: {
    run: () => void | Promise<void>;
    runAll: () => void | Promise<void>;
    saveSqlFile: () => void | Promise<void>;
    closeTab: () => void | Promise<void>;
  };
}

export function createActiveEditorCommands({
  tabType,
  hasConnection,
  hasRunnableQuery,
  isReadOnly,
  isLoading,
  canSaveSqlFile,
  statementCount,
  labels,
  actions,
}: CreateActiveEditorCommandsOptions): EditorCommands {
  const commands: EditorCommands = {
    closeTab: { label: labels.closeTab, execute: actions.closeTab },
  };

  if (tabType === "console" && canSaveSqlFile) {
    commands.saveSqlFile = {
      label: labels.saveSqlFile,
      execute: actions.saveSqlFile,
    };
  }

  const canRun =
    hasConnection &&
    hasRunnableQuery &&
    !isReadOnly &&
    !isLoading &&
    tabType !== "notebook" &&
    tabType !== "users";

  if (!canRun) return commands;

  commands.run = { label: labels.run, execute: actions.run };
  if (tabType === "console" && statementCount > 1) {
    commands.runAll = { label: labels.runAll, execute: actions.runAll };
  }

  return commands;
}
