/**
 * What the Run button (and Ctrl/Cmd+Enter) will actually execute for the
 * current editor state.
 *
 * With no selection and a multi-statement script the button runs only the
 * statement under the cursor, which is easy to miss when a whole script was
 * just pasted in. Deriving both the label and the behaviour from this single
 * helper keeps the two from drifting apart.
 */
export type RunTarget =
  /** A non-empty selection: run the selected range. */
  | "selection"
  /** Multi-statement script: run only the statement under the cursor. */
  | "statement"
  /** Multi-statement script with cursor-execution off: ask which one to run. */
  | "pick"
  /** Single statement (or empty): run the whole buffer. */
  | "whole";

/** Editor state the run target is derived from, as reported by the editor. */
export interface RunContext {
  hasSelection: boolean;
  statementCount: number;
}

export function resolveRunTarget(options: RunContext & {
  runStatementUnderCursor: boolean;
}): RunTarget {
  if (options.hasSelection) return "selection";
  if (options.statementCount <= 1) return "whole";
  return options.runStatementUnderCursor ? "statement" : "pick";
}
