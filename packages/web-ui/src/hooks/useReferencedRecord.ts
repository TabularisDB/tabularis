import { useState, useEffect, useCallback } from 'react';
import type { ForeignKey, QueryResult } from '../types/editor';
import type { DriverCapabilities, PluginManifest } from '../types/plugins';
import { quoteTableRef } from '../utils/identifiers';
import {
  isForeignKeyValueNavigable,
  buildForeignKeyFilterClause,
} from '../utils/foreignKeys';
import type { TypedCommandCaller } from '../api/contract';
import { useTabularisClient } from './useTabularisClient';

type DriverArg = string | PluginManifest | DriverCapabilities | null | undefined;

export interface FetchReferencedRecordParams {
  connectionId: string;
  fk: ForeignKey;
  value: unknown;
  driver?: DriverArg;
  schema?: string | null;
  sourceColumnType?: string;
}

/**
 * Fetches rows from the referenced table that match the foreign key value.
 */
export async function fetchReferencedRecord(
  {
    connectionId,
    fk,
    value,
    driver,
    schema,
    sourceColumnType,
  }: FetchReferencedRecordParams,
  client: TypedCommandCaller,
): Promise<QueryResult> {
  if (!isForeignKeyValueNavigable(value)) {
    return { columns: [], rows: [], affected_rows: 0 };
  }
  const quotedTable = quoteTableRef(fk.ref_table, driver, schema);
  const filterClause = buildForeignKeyFilterClause(
    fk,
    value,
    driver,
    sourceColumnType,
  );

  const query = `SELECT * FROM ${quotedTable} WHERE ${filterClause}`;

  return client.call('execute_query', {
    connectionId,
    query,
    limit: 100,
    page: 1,
    ...(schema ? { schema } : {}),
  });
}

export interface UseReferencedRecordParams {
  connectionId: string;
  fk: ForeignKey | null | undefined;
  value: unknown;
  driver?: DriverArg;
  schema?: string | null;
  sourceColumnType?: string;
}

export function useReferencedRecord({
  connectionId,
  fk,
  value,
  driver,
  schema,
  sourceColumnType,
}: UseReferencedRecordParams) {
  const client = useTabularisClient();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loadRecord = useCallback(async () => {
    if (!fk) {
      setResult(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchReferencedRecord(
        {
          connectionId,
          fk,
          value,
          driver,
          schema,
          sourceColumnType,
        },
        client,
      );
      setResult(res);
    } catch (err) {
      console.error('Failed to fetch referenced record:', err);
      setError(typeof err === 'string' ? err : String(err));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [client, connectionId, fk, value, driver, schema, sourceColumnType]);

  useEffect(() => {
    loadRecord();
  }, [loadRecord]);

  return {
    result,
    error,
    isLoading,
    loadRecord,
  };
}
