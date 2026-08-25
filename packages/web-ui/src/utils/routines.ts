import type { RoutineInfo } from "../contexts/DatabaseContext";

export interface GroupedRoutines {
  procedures: RoutineInfo[];
  functions: RoutineInfo[];
}

export const groupRoutinesByType = (routines: RoutineInfo[]): GroupedRoutines => {
  return routines.reduce(
    (acc, routine) => {
      if (routine.routine_type.toUpperCase() === "PROCEDURE") {
        acc.procedures.push(routine);
      } else {
        acc.functions.push(routine);
      }
      return acc;
    },
    { procedures: [], functions: [] } as GroupedRoutines
  );
};
