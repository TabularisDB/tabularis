export interface DataTypeInfo {
  name: string;
  category: string;
  requires_length: boolean;
  requires_precision: boolean;
  default_length?: string;
  supports_auto_increment: boolean;
  requires_extension?: string;
}

export interface DataTypeRegistry {
  driver: string;
  types: DataTypeInfo[];
}
