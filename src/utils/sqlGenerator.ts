/**
 * SQL Generation utilities for CREATE TABLE statements
 * Supports multiple database drivers with driver-specific syntax,
 * via either legacy string driver IDs or DriverCapabilities objects.
 */

import type { DriverCapabilities } from "../types/plugins";
import type { ForeignKey, Index } from "../types/schema";
import type { DatabaseDriver } from "./connections";

export type { ForeignKey, Index, DatabaseDriver };

export interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
  is_generated?: boolean;
  default_value: string | null;
  character_maximum_length?: number;
  numeric_precision?: number;
  numeric_scale?: number;
  comment?: string | null;
}

interface ResolvedSqlCapabilities {
  quote: string;
  auto_increment_keyword: string;
  serial_type: string;
  inline_pk: boolean;
  comment_syntax: 'mysql' | 'comment-on' | 'none';
}

/**
 * Resolves SQL generation capabilities from either a DriverCapabilities object
 * or a legacy string driver ID.
 */
function resolveSqlCapabilities(
  driver: DriverCapabilities | DatabaseDriver,
): ResolvedSqlCapabilities {
  if (typeof driver === 'object') {
    return {
      quote: driver.identifier_quote || '"',
      auto_increment_keyword: driver.auto_increment_keyword || '',
      serial_type: driver.serial_type || '',
      inline_pk: driver.inline_pk ?? false,
      comment_syntax:
        driver.sql_dialect === 'mysql'
          ? 'mysql'
          : driver.sql_dialect === 'postgres' || driver.sql_dialect === 'oracle'
            ? 'comment-on'
            : 'none',
    };
  }
  // Legacy string driver IDs
  switch (driver) {
    case 'mysql':
    case 'mariadb':
      return { quote: '`', auto_increment_keyword: 'AUTO_INCREMENT', serial_type: '', inline_pk: false, comment_syntax: 'mysql' };
    case 'postgres':
    case 'postgresql':
      return { quote: '"', auto_increment_keyword: '', serial_type: 'SERIAL', inline_pk: false, comment_syntax: 'comment-on' };
    case 'sqlite':
      return { quote: '"', auto_increment_keyword: 'AUTOINCREMENT', serial_type: '', inline_pk: true, comment_syntax: 'none' };
    default:
      return { quote: '"', auto_increment_keyword: '', serial_type: '', inline_pk: false, comment_syntax: 'none' };
  }
}

/**
 * Gets the quote character for identifiers based on driver.
 * Accepts either a DriverCapabilities object (uses identifier_quote) or
 * a legacy string driver ID (MySQL/MariaDB use backticks, others use double quotes).
 */
export function getIdentifierQuote(driver: DriverCapabilities | DatabaseDriver): string {
  if (typeof driver === 'object') {
    return driver.identifier_quote || '"';
  }
  return driver === 'mysql' || driver === 'mariadb' ? '`' : '"';
}

/**
 * Generates column definition SQL for a single column.
 * Accepts either a DriverCapabilities object or a legacy string driver ID.
 * The identifier quote character is derived internally from the driver.
 */
function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function appendInlineComment(
  definition: string,
  comment: string | null | undefined,
  syntax: ResolvedSqlCapabilities['comment_syntax'],
): string {
  if (!comment || syntax !== 'mysql') return definition;
  return `${definition} COMMENT '${escapeSqlString(comment)}'`;
}

/**
 * Resolves a width-aware serial type for the PostgreSQL SERIAL family.
 *
 * PostgreSQL's SERIAL/BIGSERIAL/SMALLSERIAL are syntactic sugar that create a
 * sequence and set a `nextval()` default, but each is tied to a specific integer
 * width: SMALLSERIAL → smallint (2 bytes), SERIAL → integer (4 bytes),
 * BIGSERIAL → bigint (8 bytes). A driver that advertises `serial_type: 'SERIAL'`
 * as a *default* must still pick the matching width for the actual column, or
 * the generated DDL silently narrows a bigint column to a 4-byte integer (#840).
 *
 * Drivers whose `serial_type` is a non-widthed literal (or whose column type is
 * not a recognized integer width) keep the configured `serial_type` verbatim so
 * plugin drivers with their own serial syntax are unaffected.
 */
function resolveSerialType(serialType: string, dataType: string | undefined): string {
  if (!dataType) return serialType;
  const width = dataType.toLowerCase();
  if (serialType.toUpperCase() === 'SERIAL') {
    if (width === 'bigint' || width === 'int8') return 'BIGSERIAL';
    if (width === 'smallint' || width === 'int2') return 'SMALLSERIAL';
    // 'integer' / 'int' / 'int4' (and anything unrecognised) stay as SERIAL.
    return 'SERIAL';
  }
  return serialType;
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
 * for drivers (e.g. MySQL) whose `data_type` already embeds the precision/length.
 */
function resolveTypeModifiers(column: TableColumn): string {
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

export function generateColumnDefinition(
  column: TableColumn,
  driver: DriverCapabilities | DatabaseDriver,
): string {
  const caps = resolveSqlCapabilities(driver);
  const q = caps.quote;

  if (column.is_auto_increment) {
    if (caps.inline_pk) {
      // Inline PK style (e.g. SQLite): "id" INTEGER PRIMARY KEY AUTOINCREMENT
      // The data type is replaced by INTEGER and the PK constraint is inline.
      return appendInlineComment(
        `  ${q}${column.name}${q} INTEGER PRIMARY KEY ${caps.auto_increment_keyword}`.trimEnd(),
        column.comment,
        caps.comment_syntax,
      );
    }

    if (caps.serial_type) {
      // Type replacement style (e.g. PostgreSQL SERIAL): rebuild with a
      // width-aware replacement type. PostgreSQL's SERIAL family is width-tied:
      // smallint → SMALLSERIAL, integer → SERIAL, bigint → BIGSERIAL (#840).
      // Drivers that set serial_type to a fixed literal keep using it verbatim.
      const serialType = resolveSerialType(caps.serial_type, column.data_type);
      let def = `  ${q}${column.name}${q} ${serialType}`;
      if (!column.is_nullable) def += ' NOT NULL';
      if (column.default_value !== null && column.default_value !== undefined) {
        def += ` DEFAULT ${column.default_value}`;
      }
      return appendInlineComment(def, column.comment, caps.comment_syntax);
    }
  }

  let def = `  ${q}${column.name}${q} ${resolveTypeModifiers(column)}`;

  if (!column.is_nullable) {
    def += ' NOT NULL';
  }

  if (column.default_value !== null && column.default_value !== undefined) {
    def += ` DEFAULT ${column.default_value}`;
  }

  if (column.is_auto_increment && caps.auto_increment_keyword) {
    // Keyword append style (e.g. MySQL AUTO_INCREMENT)
    def += ` ${caps.auto_increment_keyword}`;
  }

  return appendInlineComment(def, column.comment, caps.comment_syntax);
}

/**
 * Generates the PRIMARY KEY constraint clause.
 * When inline_pk is true (e.g. SQLite), returns null because the PK is in the column def.
 * Accepts either a DriverCapabilities object or a legacy string driver ID.
 * The identifier quote character is derived internally from the driver.
 */
export function generatePrimaryKeyConstraint(
  columns: TableColumn[],
  driver: DriverCapabilities | DatabaseDriver,
): string | null {
  const caps = resolveSqlCapabilities(driver);
  const q = caps.quote;
  const pkColumns = columns.filter(c => c.is_pk).map(c => `${q}${c.name}${q}`);

  if (pkColumns.length === 0) return null;
  if (caps.inline_pk) return null;

  return `  PRIMARY KEY (${pkColumns.join(', ')})`;
}

/**
 * Generates FOREIGN KEY constraint clauses.
 *
 * The backend reports one row per *column* of a (possibly composite) foreign
 * key — rows that share the same `name` belong to the same constraint. Grouping
 * by `name` (and ordering each group's columns by `seq_in_fk`, falling back to
 * input row order) emits one multi-column `CONSTRAINT` clause per unique name,
 * instead of one duplicate-named single-column clause per row (#840).
 */
export function generateForeignKeyConstraints(
  foreignKeys: ForeignKey[],
  quote: string
): string[] {
  const grouped = new Map<string, {
    columns: Array<{ name: string; ref_column: string; seq_in_fk?: number; position: number }>;
    ref_table: string;
  }>();

  foreignKeys.forEach((fk, position) => {
    const existing = grouped.get(fk.name);
    if (existing) {
      existing.columns.push({
        name: fk.column_name,
        ref_column: fk.ref_column,
        seq_in_fk: fk.seq_in_fk,
        position,
      });
      return;
    }
    grouped.set(fk.name, {
      ref_table: fk.ref_table,
      columns: [{
        name: fk.column_name,
        ref_column: fk.ref_column,
        seq_in_fk: fk.seq_in_fk,
        position,
      }],
    });
  });

  const renderIdentifiers = (names: string[]) =>
    names.map(n => `${quote}${n}${quote}`).join(', ');

  return [...grouped.entries()].map(([name, group]) => {
    const ordered = [...group.columns].sort((a, b) => {
      const aSeq = a.seq_in_fk ?? Number.MAX_SAFE_INTEGER;
      const bSeq = b.seq_in_fk ?? Number.MAX_SAFE_INTEGER;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.position - b.position;
    });
    const columns = renderIdentifiers(ordered.map(c => c.name));
    const refColumns = renderIdentifiers(ordered.map(c => c.ref_column));
    return `  CONSTRAINT ${quote}${name}${quote} FOREIGN KEY (${columns}) ` +
      `REFERENCES ${quote}${group.ref_table}${quote} (${refColumns})`;
  });
}

/**
 * Generates CREATE INDEX statements
 */
export function generateIndexStatements(
  indexes: Index[],
  tableName: string,
  quote: string
): string[] {
  const statements: string[] = [];
  const groupedIndexes = new Map<string, {
    name: string;
    is_unique: boolean;
    is_primary: boolean;
    columns: Array<{ name: string; seq_in_index?: number; position: number; is_expression?: boolean }>;
  }>();

  indexes.forEach((idx, position) => {
    const existing = groupedIndexes.get(idx.name);
    if (existing) {
      existing.columns.push({
        name: idx.column_name,
        seq_in_index: idx.seq_in_index,
        position,
        is_expression: idx.is_expression,
      });
      return;
    }

    groupedIndexes.set(idx.name, {
      name: idx.name,
      is_unique: idx.is_unique,
      is_primary: idx.is_primary,
      columns: [{
        name: idx.column_name,
        seq_in_index: idx.seq_in_index,
        position,
        is_expression: idx.is_expression,
      }],
    });
  });

  const renderColumns = (columns: Array<{ name: string; seq_in_index?: number; position: number; is_expression?: boolean }>) =>
    [...columns]
      .sort((a, b) => {
        const aSeq = a.seq_in_index ?? Number.MAX_SAFE_INTEGER;
        const bSeq = b.seq_in_index ?? Number.MAX_SAFE_INTEGER;
        if (aSeq !== bSeq) return aSeq - bSeq;
        return a.position - b.position;
      })
      .map(col => (col.is_expression ? col.name : `${quote}${col.name}${quote}`))
      .join(', ');

  const indexGroups = [...groupedIndexes.values()];

  // Unique indexes (excluding primary keys)
  const uniqueIndexes = indexGroups.filter(idx => idx.is_unique && !idx.is_primary);
  uniqueIndexes.forEach(idx => {
    statements.push(
      `CREATE UNIQUE INDEX ${quote}${idx.name}${quote} ON ${quote}${tableName}${quote} (${renderColumns(idx.columns)});`
    );
  });

  // Non-unique indexes (excluding primary keys)
  const nonUniqueIndexes = indexGroups.filter(idx => !idx.is_unique && !idx.is_primary);
  nonUniqueIndexes.forEach(idx => {
    statements.push(
      `CREATE INDEX ${quote}${idx.name}${quote} ON ${quote}${tableName}${quote} (${renderColumns(idx.columns)});`
    );
  });

  return statements;
}

/**
 * Generates complete CREATE TABLE SQL statement.
 * Accepts either a DriverCapabilities object (preferred, driver-agnostic) or
 * a legacy string driver ID (for backward compatibility).
 */
export function generateCreateTableSQL(
  tableName: string,
  columns: TableColumn[],
  foreignKeys: ForeignKey[],
  indexes: Index[],
  driver: DriverCapabilities | DatabaseDriver,
  tableComment?: string | null,
): string {
  const caps = resolveSqlCapabilities(driver);
  const quote = caps.quote;
  const lines: string[] = [];

  // Start CREATE TABLE
  lines.push(`CREATE TABLE ${quote}${tableName}${quote} (`);

  // Column definitions
  const columnDefs = columns.map(col => generateColumnDefinition(col, driver));

  // Primary key constraint (if not handled in column def)
  const pkConstraint = generatePrimaryKeyConstraint(columns, driver);
  if (pkConstraint) {
    columnDefs.push(pkConstraint);
  }

  // Foreign key constraints
  const fkConstraints = generateForeignKeyConstraints(foreignKeys, quote);
  columnDefs.push(...fkConstraints);

  // Close column definitions
  lines.push(columnDefs.join(',\n'));
  const tableCommentSuffix =
    caps.comment_syntax === 'mysql' && tableComment
      ? ` COMMENT='${escapeSqlString(tableComment)}'`
      : '';
  lines.push(`)${tableCommentSuffix};`);

  // Index statements
  const indexStatements = generateIndexStatements(indexes, tableName, quote);
  if (indexStatements.length > 0) {
    lines.push('');
    lines.push(...indexStatements);
  }

  if (caps.comment_syntax === 'comment-on') {
    const commentStatements: string[] = [];
    if (tableComment) {
      commentStatements.push(
        `COMMENT ON TABLE ${quote}${tableName}${quote} IS '${escapeSqlString(tableComment)}';`,
      );
    }
    columns.forEach((column) => {
      if (column.comment) {
        commentStatements.push(
          `COMMENT ON COLUMN ${quote}${tableName}${quote}.${quote}${column.name}${quote} IS '${escapeSqlString(column.comment)}';`,
        );
      }
    });
    if (commentStatements.length > 0) {
      lines.push('');
      lines.push(...commentStatements);
    }
  }

  return lines.join('\n');
}
