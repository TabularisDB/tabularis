import { describe, it, expect } from 'vitest';
import { groupRoutinesByType, type GroupedRoutines } from '../../src/utils/routines';
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
