export interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
  is_generated?: boolean;
  character_maximum_length?: number;
  /** Decimal precision (number of significant digits) for numeric/decimal types. */
  numeric_precision?: number;
  /** Decimal scale (digits after the decimal point) for numeric/decimal types. */
  numeric_scale?: number;
  comment?: string | null;
}

export interface ForeignKey {
  name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  /**
   * 1-based position of this column within its (possibly composite) foreign-key
   * constraint. The backend reports one row per column of a composite FK that
   * all share the same `name`; `seq_in_fk` preserves key order so the generator
   * can group rows into a single multi-column `FOREIGN KEY (a, b)` clause (#840).
   * Optional for backward compatibility — when absent, input row order is used.
   */
  seq_in_fk?: number;
}

export interface Index {
  name: string;
  column_name: string;
  is_unique: boolean;
  is_primary: boolean;
  seq_in_index?: number;
  is_expression?: boolean;
}
