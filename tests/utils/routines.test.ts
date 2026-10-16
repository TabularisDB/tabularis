import { describe, it, expect } from 'vitest';
import { groupRoutinesByType, routineLabel, type GroupedRoutines } from '../../src/utils/routines';
import type { RoutineInfo } from '../../src/contexts/DatabaseContext';

describe('groupRoutinesByType', () => {
  it('should group routines into procedures and functions', () => {
    const routines: RoutineInfo[] = [
      { name: 'proc1', routine_type: 'PROCEDURE' },
      { name: 'func1', routine_type: 'FUNCTION' },
      { name: 'proc2', routine_type: 'PROCEDURE' },
    ];

    const expected: GroupedRoutines = {
      procedures: [
        { name: 'proc1', routine_type: 'PROCEDURE' },
        { name: 'proc2', routine_type: 'PROCEDURE' },
      ],
      functions: [
        { name: 'func1', routine_type: 'FUNCTION' },
      ],
    };

    expect(groupRoutinesByType(routines)).toEqual(expected);
  });

  it('should handle empty input', () => {
    const routines: RoutineInfo[] = [];
    const expected: GroupedRoutines = {
      procedures: [],
      functions: [],
    };
    expect(groupRoutinesByType(routines)).toEqual(expected);
  });

  it('should be case insensitive for routine type', () => {
    const routines: RoutineInfo[] = [
      { name: 'proc1', routine_type: 'procedure' },
      { name: 'func1', routine_type: 'function' },
    ];
    const expected: GroupedRoutines = {
      procedures: [
        { name: 'proc1', routine_type: 'procedure' },
      ],
      functions: [
        { name: 'func1', routine_type: 'function' },
      ],
    };
    expect(groupRoutinesByType(routines)).toEqual(expected);
  });
});

describe('routineLabel', () => {
  it('shows a bare name when the signature is null', () => {
    // The host omits identity_args rather than sending null, so this guards
    // that staying true: a strict undefined check would render every routine
    // of a dialect without overloads as do_thing(null).
    expect(routineLabel('do_thing', null)).toBe('do_thing');
  });

  it('shows a bare name where the dialect cannot overload', () => {
    // MySQL and SQLite report no signature, and adding '()' there would claim a
    // distinction the dialect does not have.
    expect(routineLabel('do_thing', undefined)).toBe('do_thing');
  });

  it('shows empty parentheses for a routine that takes no arguments', () => {
    // The empty signature is a VALUE: it is what tells f() apart from f(a int).
    expect(routineLabel('f', '')).toBe('f()');
  });

  it('shows the signature so overloads are distinguishable', () => {
    expect(routineLabel('f', 'a integer')).toBe('f(a integer)');
    expect(routineLabel('f', 'a text')).toBe('f(a text)');
    expect(routineLabel('f', 'a integer, b integer')).toBe('f(a integer, b integer)');
  });

  it('gives four overloads of one name four different labels', () => {
    // The defect in one assertion: these four used to render identically.
    const labels = ['', 'a integer', 'a text', 'a integer, b integer'].map((args) =>
      routineLabel('f', args),
    );
    expect(new Set(labels).size).toBe(4);
  });

  it('keeps the argument modes PostgreSQL renders, rather than tidying them away', () => {
    // A procedure's signature carries an IN prefix and a function's can carry
    // OUT. Both are what DROP and ALTER accept, so the label shows what the
    // catalog said rather than a prettier version of it.
    expect(routineLabel('p', 'IN a integer')).toBe('p(IN a integer)');
    expect(routineLabel('g', 'a integer, OUT b integer')).toBe('g(a integer, OUT b integer)');
  });
});
