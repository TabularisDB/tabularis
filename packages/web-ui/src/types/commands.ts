import type { TableTarget } from "./databaseObjects";
import type { EditorNavigationRequest } from "./editor";

export type CommandPaletteMode = "actions" | "objects";

export interface CommandRuntime {
  navigate: (path: string) => void;
  openEditor: (request: EditorNavigationRequest) => void;
}

export interface CommandScope {
  connectionId: string | null;
  /** Needed to quote identifiers in the SQL built-in commands generate. */
  driver: string | null;
  /** The table the user is looking at, if any — pins table commands to it. */
  table: TableTarget | null;
  runtime: CommandRuntime;
}
