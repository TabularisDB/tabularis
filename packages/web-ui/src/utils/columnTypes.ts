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
  const match = fullType.match(/^([a-zA-Z0-9_[\] ]+)(?:\((.+)\))?$/);
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
 * Extracts the single-quoted, comma-separated values from the inner body of an
 * ENUM/SET type definition, handling escaped single quotes ('').
 */
function parseQuotedValues(inner: string): string[] {
  const values: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    values.push(m[1].replace(/''/g, "'"));
  }
  return values;
}

/**
 * Checks whether a column type string represents an ENUM type
 * (e.g. "enum('pending','approved','rejected')").
 */
export function isEnumType(dataType: string): boolean {
  return /^enum\s*\(/i.test(dataType);
}

/**
 * Extracts the allowed values from an ENUM type definition.
 * Returns the values unquoted, e.g. ["pending", "approved", "rejected"].
 */
export function parseEnumValues(dataType: string): string[] {
  const match = dataType.match(/^enum\s*\((.+)\)$/i);
  if (!match) return [];
  return parseQuotedValues(match[1]);
}

/**
 * Checks whether a column type string represents a SET type
 * (e.g. "set('news','sport','tech')"). Unlike ENUM, a SET column may hold
 * zero or more of its allowed values at once, stored comma-separated.
 */
export function isSetType(dataType: string): boolean {
  return /^set\s*\(/i.test(dataType);
}

/**
 * Extracts the allowed values from a SET type definition.
 * Returns the values unquoted, e.g. ["news", "sport", "tech"].
 */
export function parseSetValues(dataType: string): string[] {
  const match = dataType.match(/^set\s*\((.+)\)$/i);
  if (!match) return [];
  return parseQuotedValues(match[1]);
}

/**
 * Splits a stored SET value (MySQL returns members comma-joined, e.g.
 * "news,tech"; empty set is "") into an array of members.
 */
export function parseSetMembers(value: string): string[] {
  return value ? value.split(",").filter((v) => v.length > 0) : [];
}

/**
 * Serializes SET members back into MySQL's comma-joined storage format,
 * preserving the order the allowed values are declared in.
 */
export function serializeSetMembers(
  members: Iterable<string>,
  allowedOrder: string[],
): string {
  const selected = new Set(members);
  return allowedOrder.filter((v) => selected.has(v)).join(",");
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
