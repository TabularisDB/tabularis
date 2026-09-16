import type { TableTarget } from "./databaseObjects";
import type { EditorNavigationRequest } from "./editor";

export type CommandPaletteMode = "actions" | "objects";

export interface CommandRuntime {
  navigate: (path: string) => void;
  openEditor: (request: EditorNavigationRequest) => void;
}

export interface ResultCommand {
  execute: () => void | Promise<void>;
}

interface CountedResultCommand extends ResultCommand {
  count: number;
}

export interface ResultCommands {
  copySelectedCells?: CountedResultCommand;
  copySelectedRows?: CountedResultCommand;
  copySelectedColumns?: CountedResultCommand;
  copyColumnValuesAsSqlIn?: ResultCommand & { columnName: string };
  copyAllRows?: ResultCommand & { count?: number };
}

export interface CommandScope {
  connectionId: string | null;
  /** Needed to quote identifiers in the SQL built-in commands generate. */
  driver: string | null;
  /** The table the user is looking at, if any — pins table commands to it. */
  table: TableTarget | null;
  /** Reads the active grid selection when the action palette opens. */
  getResultCommands?: () => ResultCommands | null;
  runtime: CommandRuntime;
}
