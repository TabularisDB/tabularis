import { describe, it, expect } from 'vitest';
import {
  findStatementAtOffset,
  splitStatements,
} from '../../../src/utils/sqlSplitter';

describe('findStatementAtOffset', () => {
  // "SELECT 1; SELECT 2; SELECT 3"
  //  0        9         19
  const sql = 'SELECT 1; SELECT 2; SELECT 3';
  const statements = splitStatements(sql, 'generic');

  it('splits into the three expected statements with the expected ranges', () => {
    expect(statements).toHaveLength(3);
    expect(statements[0].range).toEqual({ start: 0, end: 8 });
    expect(statements[1].range).toEqual({ start: 10, end: 18 });
    expect(statements[2].range).toEqual({ start: 20, end: 28 });
  });

  it('resolves an offset at the very start of a statement', () => {
    expect(findStatementAtOffset(statements, 0)).toBe(statements[0]);
  });

  it('resolves an offset in the middle of a statement', () => {
    expect(findStatementAtOffset(statements, 4)).toBe(statements[0]);
  });

  it('resolves an offset at the end of a statement (before its delimiter)', () => {
    expect(findStatementAtOffset(statements, 8)).toBe(statements[0]);
  });

  it('resolves an offset in the gap between two statements to the preceding one', () => {
    // offset 9 sits on the space between "SELECT 1;" and "SELECT 2"
    expect(findStatementAtOffset(statements, 9)).toBe(statements[0]);
  });

  it('resolves an offset at the start of the next statement to that statement', () => {
    expect(findStatementAtOffset(statements, 10)).toBe(statements[1]);
  });

  it('resolves an offset after the last statement (trailing whitespace/EOF) to the last statement', () => {
    expect(findStatementAtOffset(statements, 28)).toBe(statements[2]);
    expect(findStatementAtOffset(statements, 100)).toBe(statements[2]);
  });

  it('returns undefined for an offset before the first statement starts', () => {
    const leading = splitStatements('   SELECT 1', 'generic');
    expect(leading[0].range.start).toBe(3);
    expect(findStatementAtOffset(leading, 0)).toBeUndefined();
    expect(findStatementAtOffset(leading, 2)).toBeUndefined();
  });

  it('returns undefined for an empty statement list', () => {
    expect(findStatementAtOffset([], 0)).toBeUndefined();
  });

  it('always resolves to the single statement in a one-statement file, for any in-range offset', () => {
    const single = splitStatements('SELECT 1', 'generic');
    expect(findStatementAtOffset(single, 0)).toBe(single[0]);
    expect(findStatementAtOffset(single, 5)).toBe(single[0]);
    expect(findStatementAtOffset(single, 8)).toBe(single[0]);
    expect(findStatementAtOffset(single, 50)).toBe(single[0]);
  });
});
