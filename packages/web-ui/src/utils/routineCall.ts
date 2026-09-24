/**
 * Pure helpers behind the Run Routine modal: parameter classification and
 * assembly of the argument list sent to the `build_routine_call_sql`
 * backend command.
 */

export interface RoutineParameterInfo {
  name: string;
  data_type: string;
  mode: string; // "IN" | "OUT" | "INOUT"
  ordinal_position: number;
}

/** One parameter's UI state in the Run Routine modal. */
export interface RoutineArgInput {
  value: string;
  isNull: boolean;
  isRaw: boolean;
}

/** Mirror of `src-tauri/src/models.rs::RoutineCallArg`. */
export interface RoutineCallArg {
  name: string;
  mode: string;
  value: string | null;
  is_raw: boolean;
}

/**
 * information_schema reports a routine's return value as a pseudo-parameter
 * at ordinal position 0 (empty name, OUT mode). Only positions >= 1 are
 * actual call arguments.
 */
export function isCallParameter(param: RoutineParameterInfo): boolean {
  return param.ordinal_position >= 1;
}

/** OUT parameters receive no input value: the invocation script surfaces
 * them as a result (session variable or procedure result row). */
export function isOutputOnly(param: RoutineParameterInfo): boolean {
  return param.mode.toUpperCase() === "OUT";
}

const NUMERIC_TYPE_PATTERN =
  /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|double precision|bit|boolean|bool|serial|smallserial|bigserial|money)\b/i;

/**
 * True for data types whose values read naturally without string quoting;
 * used as the default for the per-parameter "raw" toggle.
 */
export function isNumericDataType(dataType: string): boolean {
  return NUMERIC_TYPE_PATTERN.test(dataType.trim());
}

/**
 * Assembles the ordered argument list for `build_routine_call_sql` from the
 * modal's per-parameter inputs. Output-only parameters and NULL-checked
 * inputs are sent without a value (SQL `NULL` / dialect placeholder).
 */
export function buildRoutineCallArgs(
  parameters: RoutineParameterInfo[],
  inputs: Record<number, RoutineArgInput>,
): RoutineCallArg[] {
  return [...parameters]
    .filter(isCallParameter)
    .sort((a, b) => a.ordinal_position - b.ordinal_position)
    .map((param) => {
      const input = inputs[param.ordinal_position];
      const omitValue = isOutputOnly(param) || !input || input.isNull;
      return {
        name: param.name,
        mode: param.mode,
        value: omitValue ? null : input.value,
        is_raw: input?.isRaw ?? false,
      };
    });
}
