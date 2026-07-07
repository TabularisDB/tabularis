import { describe, it, expect } from "vitest";
import { getNavigatorItems, filterNavigatorItems, type NavigatorItemParams } from "../../src/utils/quickNavigator";
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
        configuredDatabases: [],
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
        configuredDatabases: [],
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
        configuredDatabases: [],
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
        configuredDatabases: ["sales_db", "inventory_db"],
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
  });

  describe("filterNavigatorItems", () => {
    const mockItems = [
      { name: "users", type: "table" as const, schema: "public", item: {} },
      { name: "user_sessions", type: "table" as const, schema: "auth", item: {} },
      { name: "active_sessions", type: "view" as const, schema: "public", item: {} },
    ];

    it("should return all items if search query is empty", () => {
      expect(filterNavigatorItems(mockItems, "")).toEqual(mockItems);
    });

    it("should filter items by name case-insensitively", () => {
      const result = filterNavigatorItems(mockItems, "SESSION");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("user_sessions");
      expect(result[1].name).toBe("active_sessions");
    });

    it("should filter items by schema name case-insensitively", () => {
      const result = filterNavigatorItems(mockItems, "auth");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("user_sessions");
    });

    it("should tolerate typos", () => {
      const result = filterNavigatorItems(mockItems, "sesion").map((i) => i.name);
      expect(result).toContain("user_sessions");
      expect(result).toContain("active_sessions");
    });
  });
});
