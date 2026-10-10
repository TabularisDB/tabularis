import { describe, it, expect } from "vitest";
import {
  getNavigatorItems,
  toDatabaseObject,
  type NavigatorItemParams,
} from "../../src/utils/quickNavigator";
import type { SchemaData } from "../../src/contexts/DatabaseContext";

describe("quickNavigator utility", () => {
  describe("getNavigatorItems", () => {
    it("should return empty list if activeConnectionId is null", () => {
      const params: NavigatorItemParams = {
        activeConnectionId: null,
        hasSchemas: false,
        isMultiDb: false,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: [],
        databaseDataMap: {},
        tables: [{ name: "users" }],
        views: [],
        routines: [],
        triggers: [],
        activeSchema: null,
      };
      expect(getNavigatorItems(params)).toEqual([]);
    });

    it("should extract items in standard mode", () => {
      const params: NavigatorItemParams = {
        activeConnectionId: "conn-1",
        hasSchemas: false,
        isMultiDb: false,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: [],
        databaseDataMap: {},
        tables: [{ name: "users" }],
        views: [{ name: "active_users" }],
        routines: [{ name: "get_users", routine_type: "FUNCTION" }],
        triggers: [{ name: "on_users_insert", table_name: "users", event: "INSERT", timing: "BEFORE" }],
        activeSchema: "default_db",
      };

      const result = getNavigatorItems(params);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ name: "users", type: "table", schema: "default_db", item: params.tables[0] });
      expect(result[1]).toEqual({ name: "active_users", type: "view", schema: "default_db", item: params.views[0] });
      expect(result[2]).toEqual({ name: "get_users", type: "routine", schema: "default_db", detail: "FUNCTION", item: params.routines[0] });
      expect(result[3]).toEqual({ name: "on_users_insert", type: "trigger", schema: "default_db", detail: "on users", item: params.triggers[0] });
    });

    it('labels overloaded routines by signature so the palette entries differ (#893)', () => {
      // Four overloads of one name were four identical palette entries, and
      // picking one of them opened whichever the catalog returned first.
      const params: NavigatorItemParams = {
        activeConnectionId: 'conn-1',
        hasSchemas: false,
        isMultiDb: false,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: [],
        databaseDataMap: {},
        tables: [],
        views: [],
        routines: [
          { name: 'f', routine_type: 'FUNCTION', identity_args: '' },
          { name: 'f', routine_type: 'FUNCTION', identity_args: 'a integer' },
          { name: 'f', routine_type: 'FUNCTION', identity_args: 'a text' },
        ],
        triggers: [],
        activeSchema: 'default_db',
      };

      const names = getNavigatorItems(params).map((i) => i.name);
      expect(names).toEqual(['f()', 'f(a integer)', 'f(a text)']);
      expect(new Set(names).size).toBe(3);
    });

    it('carries the signature into the object descriptor the palette opens (#893)', () => {
      // Without this the palette kept opening an arbitrary overload while the
      // sidebar opened the right one, which is worse than both being wrong.
      const item = {
        name: 'f(a text)',
        type: 'routine' as const,
        schema: 'default_db',
        detail: 'FUNCTION',
        item: { name: 'f', routine_type: 'FUNCTION', identity_args: 'a text' },
      };

      const descriptor = toDatabaseObject(item, {
        connectionId: 'conn-1',
        driver: 'postgres',
        isMultiDatabase: false,
      });

      expect(descriptor).toMatchObject({
        type: 'routine',
        routineType: 'FUNCTION',
        identityArgs: 'a text',
      });
    });

    it('keeps the BARE name on the descriptor, not the display label (#893)', () => {
      // DatabaseObject.name is an identifier, not a label: it reaches
      // get_routine_definition as routineName and the catalog filters
      // p.proname on it, and Copy name puts it on the clipboard. Carrying the
      // label through broke every PostgreSQL routine opened from the palette,
      // overloaded or not, because `f()` is a label too.
      const item = {
        name: 'f(a text)',
        type: 'routine' as const,
        schema: 'default_db',
        detail: 'FUNCTION',
        item: { name: 'f', routine_type: 'FUNCTION', identity_args: 'a text' },
      };

      const descriptor = toDatabaseObject(item, {
        connectionId: 'conn-1',
        driver: 'postgres',
        isMultiDatabase: false,
      });

      expect(descriptor.name).toBe('f');
      expect(descriptor.name).not.toContain('(');
    });

    it('labels a routine with no signature by its bare name (#893)', () => {
      // A dialect that cannot overload reports no signature. The host skips the
      // field when it is None, so it arrives absent; `null` is covered too,
      // because the type still admits it and the label must not read (null).
      const params: NavigatorItemParams = {
        activeConnectionId: 'conn-1',
        hasSchemas: false,
        isMultiDb: false,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: [],
        databaseDataMap: {},
        tables: [],
        views: [],
        routines: [
          { name: 'do_thing', routine_type: 'PROCEDURE', identity_args: null },
          { name: 'do_other', routine_type: 'PROCEDURE' },
        ],
        triggers: [],
        activeSchema: 'default_db',
      };

      expect(getNavigatorItems(params).map((i) => i.name)).toEqual(['do_thing', 'do_other']);
    });

    it("should extract items in schema mode", () => {
      const mockSchemaData: SchemaData = {
        tables: [{ name: "orders" }],
        views: [{ name: "order_summary" }],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: true,
      };

      const params: NavigatorItemParams = {
        activeConnectionId: "conn-1",
        hasSchemas: true,
        isMultiDb: false,
        schemas: ["public", "auth"],
        schemaDataMap: {
          public: mockSchemaData,
        },
        selectedDatabases: [],
        databaseDataMap: {},
        tables: [],
        views: [],
        routines: [],
        triggers: [],
        activeSchema: "public",
      };

      const result = getNavigatorItems(params);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: "orders", type: "table", schema: "public", item: mockSchemaData.tables[0] });
      expect(result[1]).toEqual({ name: "order_summary", type: "view", schema: "public", item: mockSchemaData.views[0] });
    });

    it("should extract items in multi-db mode", () => {
      const mockDbData: SchemaData = {
        tables: [{ name: "products" }],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: true,
      };

      const params: NavigatorItemParams = {
        activeConnectionId: "conn-1",
        hasSchemas: false,
        isMultiDb: true,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: ["sales_db", "inventory_db"],
        databaseDataMap: {
          sales_db: mockDbData,
        },
        tables: [],
        views: [],
        routines: [],
        triggers: [],
        activeSchema: null,
      };

      const result = getNavigatorItems(params);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: "products", type: "table", schema: "sales_db", item: mockDbData.tables[0] });
    });

    it("should use the live selected database list in multi-db mode", () => {
      const currentDbData: SchemaData = {
        tables: [{ name: "current_table" }],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: true,
      };
      const staleDbData: SchemaData = {
        tables: [{ name: "stale_table" }],
        views: [],
        routines: [],
        triggers: [],
        isLoading: false,
        isLoaded: true,
      };

      const params: NavigatorItemParams = {
        activeConnectionId: "conn-1",
        hasSchemas: false,
        isMultiDb: true,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: ["current_db"],
        databaseDataMap: {
          current_db: currentDbData,
          stale_db: staleDbData,
        },
        tables: [],
        views: [],
        routines: [],
        triggers: [],
        activeSchema: null,
      };

      const result = getNavigatorItems(params);

      expect(result).toEqual([
        { name: "current_table", type: "table", schema: "current_db", item: currentDbData.tables[0] },
      ]);
    });

    it("should normalize every layout through the same object shape", () => {
      const data: SchemaData = {
        tables: [{ name: "users" }],
        views: [{ name: "active_users" }],
        routines: [{ name: "find_user", routine_type: "FUNCTION" }],
        triggers: [{
          name: "audit_user",
          table_name: "users",
          event: "UPDATE",
          timing: "AFTER",
        }],
        isLoading: false,
        isLoaded: true,
      };
      const base: NavigatorItemParams = {
        activeConnectionId: "conn-1",
        hasSchemas: false,
        isMultiDb: false,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: [],
        databaseDataMap: {},
        ...data,
        activeSchema: "public",
      };
      const schemaItems = getNavigatorItems({
        ...base,
        hasSchemas: true,
        schemas: ["public"],
        schemaDataMap: { public: data },
      });
      const databaseItems = getNavigatorItems({
        ...base,
        isMultiDb: true,
        selectedDatabases: ["public"],
        databaseDataMap: { public: data },
      });

      expect(schemaItems).toEqual(getNavigatorItems(base));
      expect(databaseItems).toEqual(getNavigatorItems(base));
    });

    it("should convert a navigator item to the canonical database object", () => {
      const [item] = getNavigatorItems({
        activeConnectionId: "conn-1",
        hasSchemas: false,
        isMultiDb: true,
        schemas: [],
        schemaDataMap: {},
        selectedDatabases: ["main"],
        databaseDataMap: {
          main: {
            tables: [{ name: "users" }],
            views: [],
            routines: [],
            triggers: [],
            isLoading: false,
            isLoaded: true,
          },
        },
        tables: [],
        views: [],
        routines: [],
        triggers: [],
        activeSchema: "main",
      });

      expect(
        toDatabaseObject(item, {
          connectionId: "conn-1",
          driver: "sqlite",
          isMultiDatabase: true,
        }),
      ).toEqual({
        type: "table",
        connectionId: "conn-1",
        driver: "sqlite",
        name: "users",
        qualifySchema: false,
        schema: "main",
        title: "users (main)",
      });
    });
  });
});
