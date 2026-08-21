import { useCallback, useState } from 'react';
import type { TableSchema, ForeignKey } from '../types/editor';

interface SchemaMetadata {
  schema: TableSchema[] | null;
  getForeignKeys: (tableName: string) => ForeignKey[];
  getTableColumns: (tableName: string) => { name: string; type: string }[];
  loadSchema: (fetcher: () => Promise<TableSchema[]>) => Promise<void>;
  isLoaded: boolean;
}

/**
 * Hook to cache and query schema metadata for the query builder.
 */
export function useSchemaMetadata(): SchemaMetadata {
  const [schema, setSchema] = useState<TableSchema[] | null>(null);

  const loadSchema = useCallback(async (fetcher: () => Promise<TableSchema[]>) => {
    if (schema) return;
    const data = await fetcher();
    setSchema(data);
  }, [schema]);

  const getForeignKeys = useCallback((tableName: string): ForeignKey[] => {
    const table = schema?.find((t) => t.name === tableName);
    return table?.foreign_keys ?? [];
  }, [schema]);

  const getTableColumns = useCallback((tableName: string): { name: string; type: string }[] => {
    const table = schema?.find((t) => t.name === tableName);
    return table?.columns.map((c) => ({ name: c.name, type: c.data_type })) ?? [];
  }, [schema]);

  return {
    schema,
    getForeignKeys,
    getTableColumns,
    loadSchema,
    isLoaded: schema !== null,
  };
}
