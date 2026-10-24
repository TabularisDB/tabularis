/**
 * Column type formatting shared by the schema views and SQL generation.
 */

/** The parts of a column's metadata that describe its type. */
export interface ColumnTypeParts {
    data_type: string;
    /**
     * Full declared type with its modifiers (`varchar(255)`, `decimal(10,2)`,
     * `int unsigned`), when the driver reports one that says more than
     * `data_type` (#1277).
     */
    full_type?: string | null;
    character_maximum_length?: number | null;
    numeric_precision?: number | null;
    numeric_scale?: number | null;
}

/**
 * Appends type modifiers to a bare column type when the backend reports them
 * as separate fields rather than embedding them in `data_type`.
 *
 * - `numeric`/`decimal` → `numeric(precision, scale)` when precision is present
 *   and the type string doesn't already carry a parenthesised modifier (#840).
 * - `varchar`/`character varying`/`char`/`character` → `type(length)` when
 *   `character_maximum_length` is present and the type isn't already sized.
 *
 * The "already carries a modifier" guard avoids producing `numeric(10,2)(10,2)`
 * for drivers (e.g. SQLite, whose `PRAGMA table_xinfo` returns the full type
 * declaration) whose `data_type` already embeds the precision/length. MySQL and
 * Postgres send the bare type name with precision/length as separate fields.
 */
export function resolveTypeModifiers(column: ColumnTypeParts): string {
    const type = column.data_type;
    const lower = type.toLowerCase();
    const hasModifier = /\(\d+\s*,\s*\d+\)|\(\d+\)/.test(type);

    // Numeric/decimal precision+scale. Scale defaults to 0 when precision is set
    // but scale is absent (e.g. `numeric(38)`), matching PostgreSQL semantics.
    if (!hasModifier && column.numeric_precision != null) {
        if (lower === 'numeric' || lower === 'decimal') {
            const scale = column.numeric_scale ?? 0;
            return `${type}(${column.numeric_precision},${scale})`;
        }
    }

    // Character-type length.
    if (!hasModifier && column.character_maximum_length != null) {
        if (
            lower === 'varchar' ||
            lower === 'character varying' ||
            lower === 'char' ||
            lower === 'character'
        ) {
            return `${type}(${column.character_maximum_length})`;
        }
    }

    return type;
}

/**
 * The column type to show to the user: the driver's full declared type when it
 * reports one, otherwise `data_type` with any length or precision the driver
 * reports separately (so a plugin that only sends `numeric_precision` and
 * `numeric_scale` still shows `numeric(10,2)`).
 */
export function formatColumnType(column: ColumnTypeParts): string {
    const fullType = column.full_type?.trim();
    return fullType ? fullType : resolveTypeModifiers(column);
}
