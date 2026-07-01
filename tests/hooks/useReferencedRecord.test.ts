import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { ForeignKey } from '../../src/types/schema';
import { fetchReferencedRecord } from '../../src/hooks/useReferencedRecord';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

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
      });

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
      });

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
      });

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(res).toEqual({ columns: [], rows: [], affected_rows: 0 });
    });

    it("qualifies with the referenced table's schema for a cross-schema FK", async () => {
      // Source tab lives in `sales`, but the FK points at inventory.products.
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValueOnce({ columns: [], rows: [], affected_rows: 0 });

      await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: { ...fk('fk_prod', 'product_id', 'products', 'id'), ref_schema: 'inventory' },
        value: 5,
        driver: 'postgres',
        schema: 'sales',
        database: 'erp_demo',
      });

      expect(mockInvoke).toHaveBeenCalledWith('execute_query', {
        connectionId: 'conn-123',
        query: 'SELECT * FROM "inventory"."products" WHERE "id" = 5',
        limit: 100,
        page: 1,
        schema: 'inventory',
        database: 'erp_demo',
      });
    });

    it("routes the related-records query to the tab's database (regression)", async () => {
      // Without `database`, execute_query hit the connection's primary
      // database and PostgreSQL reported `relation "inventory.products"
      // does not exist`.
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValueOnce({ columns: [], rows: [], affected_rows: 0 });

      await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: { ...fk('fk_prod', 'product_id', 'products', 'id'), ref_schema: 'inventory' },
        value: 1,
        driver: 'postgres',
        schema: 'inventory',
        database: 'erp_demo',
      });

      const [, args] = mockInvoke.mock.calls[0];
      expect(args).toHaveProperty('database', 'erp_demo');
    });

    it('falls back to the source schema when the FK reports no ref_schema', async () => {
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValueOnce({ columns: [], rows: [], affected_rows: 0 });

      await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: fk('fk_prod', 'product_id', 'products', 'id'),
        value: 7,
        driver: 'postgres',
        schema: 'public',
        database: 'erp_demo',
      });

      expect(mockInvoke).toHaveBeenCalledWith('execute_query', {
        connectionId: 'conn-123',
        query: 'SELECT * FROM "public"."products" WHERE "id" = 7',
        limit: 100,
        page: 1,
        schema: 'public',
        database: 'erp_demo',
      });
    });

    it('omits database for single-database connections', async () => {
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValueOnce({ columns: [], rows: [], affected_rows: 0 });

      await fetchReferencedRecord({
        connectionId: 'conn-123',
        fk: { ...fk('fk_prod', 'product_id', 'products', 'id'), ref_schema: 'inventory' },
        value: 3,
        driver: 'postgres',
        schema: 'inventory',
      });

      const [, args] = mockInvoke.mock.calls[0];
      expect(args).not.toHaveProperty('database');
    });
  });
});
