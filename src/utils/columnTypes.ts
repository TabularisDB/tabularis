import type { DataTypeInfo } from "../types/dataTypes";

export interface ParsedType {
  type: string;
  length: string;
}

export interface ColumnDefinition {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_pk: boolean;
  is_auto_increment: boolean;
  default_value: string | null;
}

export interface ColumnFormData {
  name: string;
  type: string;
  length?: string;
  isNullable: boolean;
  defaultValue?: string;
  isPk: boolean;
  isAutoInc: boolean;
}

/**
 * Parse a full data type string into its base type and length/precision components.
 * If the full type name matches a known type (e.g. "GEOMETRY(Point, 4326)"),
 * it is kept intact with no length extraction.
 */
export function parseColumnType(
  fullType: string,
  availableTypes: DataTypeInfo[],
): ParsedType {
  const upperFull = fullType.toUpperCase().trim();
  const exactMatch = availableTypes.find(
    (t) => t.name.toUpperCase() === upperFull,
  );
  if (exactMatch) {
    return { type: exactMatch.name, length: "" };
  }
  const match = fullType.match(/^([a-zA-Z0-9_\[\] ]+)(?:\((.+)\))?$/);
  if (match) {
    return { type: match[1].toUpperCase().trim(), length: match[2] || "" };
  }
  return { type: upperFull, length: "" };
}

/**
 * Build a ColumnDefinition (backend-compatible) from a form data object.
 */
export function buildColumnDefinition(form: ColumnFormData): ColumnDefinition {
  const typeDef = `${form.type}${form.length ? `(${form.length})` : ""}`;
  return {
    name: form.name,
    data_type: typeDef,
    is_nullable: form.isNullable,
    is_pk: form.isPk,
    is_auto_increment: form.isAutoInc,
    default_value: form.defaultValue || null,
  };
}

/**
 * Returns the list of unique extension names required by the given column types.
 */
export function getRequiredExtensions(
  columnTypes: string[],
  availableTypes: DataTypeInfo[],
): string[] {
  const exts = columnTypes
    .map((t) => availableTypes.find((at) => at.name === t)?.requires_extension)
    .filter((e): e is string => !!e);
  return [...new Set(exts)];
}
