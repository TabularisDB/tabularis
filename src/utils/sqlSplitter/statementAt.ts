import type { Statement } from './index';

/**
 * Resolves which statement a cursor offset falls inside. An offset in the
 * gap between two statements (delimiter/whitespace/comment) resolves to the
 * preceding statement, matching TablePlus/DataGrip's "run statement at
 * cursor" behavior. An offset before the first statement's start (leading
 * comment or blank lines) resolves to the first statement, so every offset
 * in a non-empty buffer maps to a statement — the cursor-statement
 * highlight, the Run button label and the run/explain actions all rely on
 * this resolution being total. Only an empty statement list returns
 * undefined.
 */
export function findStatementAtOffset(
  statements: readonly Statement[],
  offset: number,
): Statement | undefined {
  if (statements.length === 0) {
    return undefined;
  }
  let result = statements[0];
  for (const statement of statements) {
    if (offset < statement.range.start) break;
    result = statement;
  }
  return result;
}
