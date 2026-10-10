import type { TableTarget } from "./databaseObjects";
import type { EditorNavigationRequest } from "./editor";

export type CommandPaletteMode = "all" | "actions" | "objects";

export interface CommandRuntime {
  navigate: (path: string) => void;
  openEditor: (request: EditorNavigationRequest) => void;
  switchConnection?: (connectionId: string) => void | Promise<void>;
}

export interface CommandConnection {
  id: string;
  name: string;
  driver: string;
  database: string;
  host?: string;
}

export interface ResultCommand {
  execute: () => void | Promise<void>;
}

export interface EditorCommand extends ResultCommand {
  label: string;
}

export interface EditorCommands {
  run?: EditorCommand;
  runAll?: EditorCommand;
  saveSqlFile?: EditorCommand;
  closeTab?: EditorCommand;
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
  /** Saved connections available as direct activation targets. */
  connections?: CommandConnection[];
  /** Needed to quote identifiers in the SQL built-in commands generate. */
  driver: string | null;
  /** The table the user is looking at, if any — pins table commands to it. */
  table: TableTarget | null;
  /** Reads the active grid selection when the action palette opens. */
  getResultCommands?: () => ResultCommands | null;
  /** Reads commands for the active editor tab when the palette opens. */
  getEditorCommands?: () => EditorCommands | null;
  runtime: CommandRuntime;
}
