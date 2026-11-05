import type {DataTypeInfo} from '@/types/dataTypes';
import {formatColumnType} from './columnType';
import type {ColumnTypeParts} from './columnType';

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
    /** Column description; omitted when blank so legacy payloads are unchanged. */
    comment?: string | null;
    /** `ON UPDATE` expression to keep when the column is restated; omitted when unset. */
    on_update?: string | null;
}

export interface ColumnFormData {
    name: string;
    type: string;
    length?: string;
    isNullable: boolean;
    defaultValue?: string;
    isPk: boolean;
    isAutoInc: boolean;
    comment?: string;
    /** `ON UPDATE` expression of an existing column, passed through unchanged. */
    onUpdate?: string;
}

/**
 * Parse a full data type string into its base type and length/precision components.
 * If the full type name matches a known type (e.g. "GEOMETRY(Point, 4326)"),
 * it is kept intact with no length extraction.
 */
export function parseColumnType(fullType: string, availableTypes: DataTypeInfo[]): ParsedType {
    const upperFull = fullType.toUpperCase().trim();
    const exactMatch = availableTypes.find((t) => t.name.toUpperCase() === upperFull);
    if (exactMatch) {
        return {type: exactMatch.name, length: ''};
    }
    const match = fullType.match(/^([a-zA-Z0-9_[\] ]+)(?:\((.+)\))?$/);
    if (match) {
        return {type: match[1].toUpperCase().trim(), length: match[2] || ''};
    }
    return {type: upperFull, length: ''};
}

/**
 * Parse an existing column's type for editing. Drivers report the length or
 * precision apart from `data_type` (`full_type`, `character_maximum_length`,
 * ...), so parsing `data_type` alone turns `varchar(255)` into a bare
 * `VARCHAR` and the ALTER statement loses the size (#271).
 */
export function parseExistingColumnType(
    column: ColumnTypeParts,
    availableTypes: DataTypeInfo[],
): ParsedType {
    return parseColumnType(formatColumnType(column), availableTypes);
}

/** The parts of an existing column the column editor starts from. */
export interface ExistingColumn extends ColumnTypeParts {
    name: string;
    is_nullable: boolean;
    is_pk: boolean;
    is_auto_increment: boolean;
    comment?: string | null;
    default_sql?: string | null;
    on_update?: string | null;
}

/**
 * The column editor's form for an existing column. It is both what the dialog
 * starts with and the "old column" sent with the ALTER, so a field the user
 * leaves alone is restated unchanged: the length (#271), the default as SQL
 * (`default_sql`, empty when the driver doesn't send it) and `ON UPDATE`.
 */
export function existingColumnForm(
    column: ExistingColumn,
    availableTypes: DataTypeInfo[],
    withComment: boolean,
): ColumnFormData {
    const {type, length} = parseExistingColumnType(column, availableTypes);
    return {
        name: column.name,
        type,
        length,
        isNullable: column.is_nullable,
        defaultValue: column.is_auto_increment ? '' : (column.default_sql ?? ''),
        isPk: column.is_pk || false,
        isAutoInc: column.is_auto_increment || false,
        comment: withComment ? (column.comment ?? '') : undefined,
        ...(column.on_update ? {onUpdate: column.on_update} : {}),
    };
}

/**
 * Build a ColumnDefinition (backend-compatible) from a form data object.
 */
export function buildColumnDefinition(form: ColumnFormData): ColumnDefinition {
    const typeDef = `${form.type}${form.length ? `(${form.length})` : ''}`;
    return {
        name: form.name,
        data_type: typeDef,
        is_nullable: form.isNullable,
        is_pk: form.isPk,
        is_auto_increment: form.isAutoInc,
        // The default field is disabled for auto-increment columns, which can't have one.
        default_value: (!form.isAutoInc && form.defaultValue) || null,
        ...(form.comment?.trim() ? {comment: form.comment.trim()} : {}),
        // ON UPDATE only applies to TIMESTAMP / DATETIME; drop it if the type changed.
        ...(form.onUpdate && /^(timestamp|datetime)\b/i.test(form.type)
            ? {on_update: form.onUpdate}
            : {}),
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
    return value ? value.split(',').filter((v) => v.length > 0) : [];
}

/**
 * Serializes SET members back into MySQL's comma-joined storage format,
 * preserving the order the allowed values are declared in.
 */
export function serializeSetMembers(members: Iterable<string>, allowedOrder: string[]): string {
    const selected = new Set(members);
    return allowedOrder.filter((v) => selected.has(v)).join(',');
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
