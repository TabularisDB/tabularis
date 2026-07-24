import type { Statement } from './index';

/**
 * Resolves which statement a cursor offset falls inside. An offset in the
 * gap between two statements (delimiter/whitespace/comment) resolves to the
 * preceding statement, matching TablePlus/DataGrip's "run statement at
 * cursor" behavior. An offset before the first statement's start — or an
 * empty statement list — returns undefined since there is no statement to
 * fall back to.
 */
export function findStatementAtOffset(
  statements: readonly Statement[],
  offset: number,
): Statement | undefined {
  if (statements.length === 0 || offset < statements[0].range.start) {
    return undefined;
  }
  let result = statements[0];
  for (const statement of statements) {
    if (offset < statement.range.start) break;
    result = statement;
  }
  return result;
}
