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

/**
 * The label a routine is listed under.
 *
 * A name is not an identity in every dialect. PostgreSQL overloads, so four
 * functions called `f` used to arrive in the sidebar as four identical rows
 * with nothing on screen to tell them apart, and clicking one of them was a
 * coin toss (#893). Where the listing reports a signature, it goes in the
 * label, which is what pgAdmin and psql's `\df` both do.
 *
 * An EMPTY signature is a value, not an absence: it is what a no-argument
 * routine has, and `f()` beside `f(a integer)` is exactly the distinction the
 * reader needs. Only an undefined signature means "this dialect does not
 * overload", and there the bare name is the whole truth.
 */
export const routineLabel = (name: string, identityArgs?: string): string =>
  identityArgs === undefined ? name : `${name}(${identityArgs})`;
