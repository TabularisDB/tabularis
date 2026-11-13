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
    /**
     * Full declared type with its modifiers (`varchar(255)`, `decimal(10,2)`,
     * `int unsigned`), for display. Sent only when it says more than
     * `data_type`; render it with `formatColumnType` (#1277).
     */
    full_type?: string;
    /**
     * Column default as SQL that can follow `DEFAULT` unchanged (`'new'`,
     * `CURRENT_TIMESTAMP`, `(uuid())`). `default_value` may be raw text (MySQL
     * reports `new`), so the column editor restates this one (#271).
     */
    default_sql?: string | null;
    /** `ON UPDATE` expression (MySQL `CURRENT_TIMESTAMP`), kept on ALTER (#271). */
    on_update?: string | null;
}

export interface ForeignKey {
    name: string;
    column_name: string;
    ref_table: string;
    ref_column: string;
    /**
     * Schema of the referenced table, reported by drivers with schemas
     * (PostgreSQL). It can differ from the source table's schema, so resolve
     * it with `getReferencedSchema` instead of reusing the source schema.
     * Absent means "same schema as the source table".
     */
    ref_schema?: string | null;
    on_delete?: string | null;
    on_update?: string | null;
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
