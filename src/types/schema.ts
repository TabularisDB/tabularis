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
}

export interface Index {
  name: string;
  column_name: string;
  is_unique: boolean;
  is_primary: boolean;
  seq_in_index?: number;
}
