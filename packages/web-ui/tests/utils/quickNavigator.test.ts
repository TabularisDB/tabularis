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
