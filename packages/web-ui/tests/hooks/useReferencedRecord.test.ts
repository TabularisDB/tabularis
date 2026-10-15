import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { ForeignKey } from '../../src/types/schema';
import { fetchReferencedRecord } from '../../src/hooks/useReferencedRecord';
import { TabularisClient } from '../../src/api/client';
import { TauriTransport } from '../../src/api/transports/tauriTransport';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const client = new TabularisClient(new TauriTransport());

const fk = (
  name: string,
  column_name: string,
  ref_table: string,
  ref_column: string,
): ForeignKey => ({ name, column_name, ref_table, ref_column });

describe('useReferencedRecord hook integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchReferencedRecord', () => {
    it('calls execute_query with correct SQL filter for mysql driver', async () => {
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValueOnce({
        columns: ['id', 'name'],
        rows: [[42, 'Acme Corp']],
        affected_rows: 1,
      });

      const res = await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: fk('fk_org', 'org_id', 'organizations', 'id'),
        value: 42,
        driver: 'mysql',
      }, client);

      expect(mockInvoke).toHaveBeenCalledWith('execute_query', {
        connectionId: 'conn-123',
        query: 'SELECT * FROM `organizations` WHERE `id` = 42',
        limit: 100,
        page: 1,
      });
      expect(res.rows).toEqual([[42, 'Acme Corp']]);
    });

    it('calls execute_query with correct SQL filter for postgres driver with schema prefixing', async () => {
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValueOnce({
        columns: ['id', 'name'],
        rows: [[42, 'Acme Corp']],
        affected_rows: 1,
      });

      await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: fk('fk_org', 'org_id', 'organizations', 'id'),
        value: 42,
        driver: 'postgres',
        schema: 'public',
      }, client);

      expect(mockInvoke).toHaveBeenCalledWith('execute_query', {
        connectionId: 'conn-123',
        query: 'SELECT * FROM "public"."organizations" WHERE "id" = 42',
        limit: 100,
        page: 1,
        schema: 'public',
      });
    });

    it('handles missing value by returning empty QueryResult without executing query', async () => {
      const mockInvoke = vi.mocked(invoke);
      const res = await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: fk('fk_org', 'org_id', 'organizations', 'id'),
        value: null,
      }, client);

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(res).toEqual({ columns: [], rows: [], affected_rows: 0 });
    });
  });
});

const baseParams = { connectionId: "conn-1", fk: fk("fk_users", "user_id", "users", "id"), value: 42, driver: "postgres", schema: "public", sourceColumnType: "integer" };

describe("fetchReferencedRecord database threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue({ columns: [], rows: [], affected_rows: 0 });
  });

  it("passes the database override to execute_query when set", async () => {
    await fetchReferencedRecord({ ...baseParams, database: "analytics" }, client);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "execute_query",
      expect.objectContaining({ database: "analytics" }),
    );
  });

  it("omits database from execute_query when not set (backward-compatible)", async () => {
    await fetchReferencedRecord({ ...baseParams }, client);

    const callArgs = vi.mocked(invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("database");
  });

  it("omits database when set to null", async () => {
    await fetchReferencedRecord({ ...baseParams, database: null }, client);

    const callArgs = vi.mocked(invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("database");
  });

  it("omits database when set to empty string", async () => {
    await fetchReferencedRecord({ ...baseParams, database: "" }, client);

    const callArgs = vi.mocked(invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("database");
  });
});
