import type * as Monaco from "monaco-editor";
import {
  splitStatements,
  type Dialect,
} from "./sqlSplitter";

export interface SqlFoldingRange {
  readonly start: number;
  readonly end: number;
}

const MAX_FOLDABLE_CHARACTERS = 2_000_000;
const registeredMonacoInstances = new WeakSet<object>();
const modelDialects = new WeakMap<
  Monaco.editor.ITextModel,
  Dialect | string | undefined
>();
const foldingChangeListeners = new Set<() => void>();

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAtOffset(starts: ReadonlyArray<number>, offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Returns one fold for each SQL statement that spans multiple lines. */
export function getSqlFoldingRanges(
  source: string,
  dialect?: Dialect | string,
): SqlFoldingRange[] {
  const starts = lineStarts(source);
  return splitStatements(source, dialect).flatMap((statement) => {
    const start = lineAtOffset(starts, statement.range.start);
    const end = lineAtOffset(starts, Math.max(statement.range.start, statement.range.end - 1));
    return end > start ? [{ start, end }] : [];
  });
}

/** Returns the complete query whose fold starts on the given line. */
export function getSqlQueryAtFoldLine(
  source: string,
  line: number,
  dialect?: Dialect | string,
): string | null {
  const starts = lineStarts(source);
  const statement = splitStatements(source, dialect).find((candidate) => {
    const start = lineAtOffset(starts, candidate.range.start);
    const end = lineAtOffset(
      starts,
      Math.max(candidate.range.start, candidate.range.end - 1),
    );
    return start === line && end > start;
  });
  return statement
    ? source.slice(statement.range.start, statement.range.end)
    : null;
}

export function setSqlFoldingDialect(
  model: Monaco.editor.ITextModel | null,
  dialect?: Dialect | string,
): void {
  if (!model || modelDialects.get(model) === dialect) return;
  modelDialects.set(model, dialect);
  foldingChangeListeners.forEach((notify) => notify());
}

/** Registers the query folding provider once for each Monaco instance. */
export function registerSqlFoldingProvider(monaco: typeof Monaco): void {
  if (registeredMonacoInstances.has(monaco)) return;
  registeredMonacoInstances.add(monaco);

  const provider: Monaco.languages.FoldingRangeProvider = {
    onDidChange(listener) {
      const notify = (): void => listener(provider);
      foldingChangeListeners.add(notify);
      return { dispose: () => foldingChangeListeners.delete(notify) };
    },
    provideFoldingRanges(model) {
      if (model.getValueLength() > MAX_FOLDABLE_CHARACTERS) return [];
      return getSqlFoldingRanges(model.getValue(), modelDialects.get(model)).map(
        (range) => ({
          ...range,
          kind: monaco.languages.FoldingRangeKind.Region,
        }),
      );
    },
  };
  monaco.languages.registerFoldingRangeProvider("sql", provider);
}
