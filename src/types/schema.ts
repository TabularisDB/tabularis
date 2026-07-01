export interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
  character_maximum_length?: number;
}

export interface ForeignKey {
  name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  /**
   * Schema of the referenced table. Set for schema-based drivers (PostgreSQL)
   * so cross-schema references resolve correctly; absent for drivers without
   * schemas (consumers fall back to the current schema).
   */
  ref_schema?: string | null;
}

export interface Index {
  name: string;
  column_name: string;
  is_unique: boolean;
  is_primary: boolean;
}
