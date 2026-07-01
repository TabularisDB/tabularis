import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tab, TableSchema, SchemaCache } from "../../src/types/editor";
import {
  generateTabId,
  createInitialTabState,
  generateTabTitle,
  findExistingTableTab,
  getConnectionTabs,
  getActiveTab,
  closeTabWithState,
  closeAllTabsForConnection,
  closeOtherTabsForConnection,
  closeTabsToLeft,
  closeTabsToRight,
  updateTabInList,
  shouldUseCachedSchema,
  createSchemaCacheEntry,
  reconstructTableQuery,
  formatExportFileName,
  validatePageNumber,
  calculateTotalPages,
} from "../../src/utils/editor";

describe("editor", () => {
  describe("generateTabId", () => {
    it("should generate a string of 7 characters", () => {
      const id = generateTabId();
      expect(id).toHaveLength(7);
      expect(typeof id).toBe("string");
    });

    it("should generate unique ids", () => {
      const id1 = generateTabId();
      const id2 = generateTabId();
      expect(id1).not.toBe(id2);
    });

    it("should only contain alphanumeric characters", () => {
      const id = generateTabId();
      expect(id).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe("createInitialTabState", () => {
    it("should create a console tab with default values", () => {
      const tab = createInitialTabState("conn-1");

      expect(tab).toMatchObject({
        title: "Console",
        type: "console",
        query: "",
        result: null,
        error: "",
        executionTime: null,
        page: 1,
        activeTable: null,
        pkColumns: null,
        isLoading: false,
        connectionId: "conn-1",
        isEditorOpen: true,
      });
      expect(tab.id).toHaveLength(7);
    });

    it("should use partial values when provided", () => {
      const partial = {
        title: "Custom Tab",
        type: "table" as const,
        query: "SELECT * FROM users",
        activeTable: "users",
      };

      const tab = createInitialTabState("conn-1", partial);

      expect(tab.title).toBe("Custom Tab");
      expect(tab.type).toBe("table");
      expect(tab.query).toBe("SELECT * FROM users");
      expect(tab.activeTable).toBe("users");
      expect(tab.isEditorOpen).toBe(false);
    });

    it("should handle null connectionId", () => {
      const tab = createInitialTabState(null);

      expect(tab.connectionId).toBe("");
    });

    it("should allow overriding isEditorOpen", () => {
      const tab = createInitialTabState("conn-1", {
        type: "table",
        isEditorOpen: true,
      });

      expect(tab.isEditorOpen).toBe(true);
    });
  });

  describe("generateTabTitle", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should return provided title", () => {
      const tabs: Tab[] = [];
      const title = generateTabTitle(tabs, "conn-1", { title: "Custom Title" });
      expect(title).toBe("Custom Title");
    });

    it("should return table name for table tabs", () => {
      const tabs: Tab[] = [];
      const title = generateTabTitle(tabs, "conn-1", {
        type: "table",
        activeTable: "users",
      });
      expect(title).toBe("users");
    });

    it('should generate "Console" for first console tab', () => {
      const tabs: Tab[] = [];
      const title = generateTabTitle(tabs, "conn-1", { type: "console" });
      expect(title).toBe("Console");
    });

    it('should generate "Console N" for additional console tabs', () => {
      const tabs: Tab[] = [
        createMockTab({ type: "console", connectionId: "conn-1" }),
        createMockTab({ type: "console", connectionId: "conn-1" }),
      ];
      const title = generateTabTitle(tabs, "conn-1", { type: "console" });
      expect(title).toBe("Console 3");
    });

    it('should generate "Visual Query" for first query builder tab', () => {
      const tabs: Tab[] = [];
      const title = generateTabTitle(tabs, "conn-1", { type: "query_builder" });
      expect(title).toBe("Visual Query");
    });

    it('should generate "Visual Query N" for additional query builder tabs', () => {
      const tabs: Tab[] = [
        createMockTab({ type: "query_builder", connectionId: "conn-1" }),
      ];
      const title = generateTabTitle(tabs, "conn-1", { type: "query_builder" });
      expect(title).toBe("Visual Query 2");
    });

    it("should only count tabs for the specified connection", () => {
      const tabs: Tab[] = [
        createMockTab({ type: "console", connectionId: "conn-1" }),
        createMockTab({ type: "console", connectionId: "conn-2" }),
      ];
      const title = generateTabTitle(tabs, "conn-1", { type: "console" });
      expect(title).toBe("Console 2");
    });
  });

  describe("findExistingTableTab", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should find existing table tab", () => {
      const tabs: Tab[] = [
        createMockTab({
          id: "tab-1",
          type: "table",
          connectionId: "conn-1",
          activeTable: "users",
        }),
      ];

      const result = findExistingTableTab(tabs, "conn-1", "users");

      expect(result).toBeDefined();
      expect(result?.id).toBe("tab-1");
    });

    it("should return undefined when no matching tab exists", () => {
      const tabs: Tab[] = [
        createMockTab({
          type: "table",
          connectionId: "conn-1",
          activeTable: "posts",
        }),
      ];

      const result = findExistingTableTab(tabs, "conn-1", "users");

      expect(result).toBeUndefined();
    });

    it("should return undefined when tableName is undefined", () => {
      const tabs: Tab[] = [
        createMockTab({
          type: "table",
          connectionId: "conn-1",
          activeTable: "users",
        }),
      ];

      const result = findExistingTableTab(tabs, "conn-1", undefined);

      expect(result).toBeUndefined();
    });

    it("should not match tabs from different connections", () => {
      const tabs: Tab[] = [
        createMockTab({
          type: "table",
          connectionId: "conn-2",
          activeTable: "users",
        }),
      ];

      const result = findExistingTableTab(tabs, "conn-1", "users");

      expect(result).toBeUndefined();
    });
  });

  describe("getConnectionTabs", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should return tabs for specific connection", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-2" }),
      ];

      const result = getConnectionTabs(tabs, "conn-1");

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
    });

    it("should return empty array when connectionId is null", () => {
      const tabs: Tab[] = [createMockTab()];

      const result = getConnectionTabs(tabs, null);

      expect(result).toEqual([]);
    });

    it("should return empty array when no tabs match", () => {
      const tabs: Tab[] = [createMockTab({ connectionId: "conn-2" })];

      const result = getConnectionTabs(tabs, "conn-1");

      expect(result).toEqual([]);
    });
  });

  describe("getActiveTab", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should return active tab", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1" }),
        createMockTab({ id: "tab-2" }),
      ];

      const result = getActiveTab(tabs, "conn-1", "tab-1");

      expect(result?.id).toBe("tab-1");
    });

    it("should return null when connectionId is null", () => {
      const tabs: Tab[] = [createMockTab()];

      const result = getActiveTab(tabs, null, "tab-1");

      expect(result).toBeNull();
    });

    it("should return null when activeTabId is null", () => {
      const tabs: Tab[] = [createMockTab()];

      const result = getActiveTab(tabs, "conn-1", null);

      expect(result).toBeNull();
    });

    it("should return null when tab belongs to different connection", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-2" }),
      ];

      const result = getActiveTab(tabs, "conn-1", "tab-1");

      expect(result).toBeNull();
    });

    it("should return null when tab does not exist", () => {
      const tabs: Tab[] = [createMockTab({ id: "tab-1" })];

      const result = getActiveTab(tabs, "conn-1", "non-existent");

      expect(result).toBeNull();
    });
  });

  describe("closeTabWithState", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should close tab and update state", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1" }),
        createMockTab({ id: "tab-2" }),
      ];

      const result = closeTabWithState(
        tabs,
        "conn-1",
        "tab-1",
        "tab-2",
      );

      expect(result.newTabs).toHaveLength(1);
      expect(result.newTabs[0].id).toBe("tab-1");
      expect(result.newActiveTabId).toBe("tab-1");
    });

    it("should return empty tabs when closing last tab for connection", () => {
      const tabs: Tab[] = [createMockTab({ id: "tab-1" })];

      const result = closeTabWithState(
        tabs,
        "conn-1",
        "tab-1",
        "tab-1",
      );

      expect(result.newTabs).toHaveLength(0);
      expect(result.newActiveTabId).toBeNull();
    });

    it("should handle closing active tab", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1" }),
        createMockTab({ id: "tab-2" }),
        createMockTab({ id: "tab-3" }),
      ];

      const result = closeTabWithState(
        tabs,
        "conn-1",
        "tab-2",
        "tab-2",
      );

      expect(result.newTabs).toHaveLength(2);
      // When closing active tab at index 1, should select previous tab (tab-1)
      expect(result.newActiveTabId).toBe("tab-1");
    });

    it("should select first tab when closing the first tab", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1" }),
        createMockTab({ id: "tab-2" }),
        createMockTab({ id: "tab-3" }),
      ];

      const result = closeTabWithState(
        tabs,
        "conn-1",
        "tab-1",
        "tab-1",
      );

      expect(result.newTabs).toHaveLength(2);
      // When closing first tab, should select the new first tab (tab-2)
      expect(result.newActiveTabId).toBe("tab-2");
    });

    it("should keep other connection tabs when closing last tab for a connection", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-2" }),
      ];

      const result = closeTabWithState(
        tabs,
        "conn-1",
        "tab-1",
        "tab-1",
      );

      expect(result.newTabs).toHaveLength(1);
      expect(result.newTabs[0].id).toBe("tab-2");
    });
  });

  describe("closeAllTabsForConnection", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should close all tabs for connection and keep other connections", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-2" }),
      ];

      const result = closeAllTabsForConnection(tabs, "conn-1");

      expect(result.newTabs).toHaveLength(1);
      expect(result.newTabs[0].id).toBe("tab-3");
      expect(result.newActiveTabId).toBeNull();
    });

    it("should work with empty tabs array", () => {
      const tabs: Tab[] = [];

      const result = closeAllTabsForConnection(tabs, "conn-1");

      expect(result.newTabs).toHaveLength(0);
      expect(result.newActiveTabId).toBeNull();
    });
  });

  describe("closeOtherTabsForConnection", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should keep only specified tab for connection", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-1" }),
        createMockTab({ id: "tab-4", connectionId: "conn-2" }),
      ];

      const result = closeOtherTabsForConnection(tabs, "conn-1", "tab-2");

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(["tab-2", "tab-4"]);
    });
  });

  describe("closeTabsToLeft", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should close tabs to the left of target", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-1" }),
      ];

      const result = closeTabsToLeft(tabs, "conn-1", "tab-2", "tab-3");

      expect(result.newTabs).toHaveLength(2);
      expect(result.newTabs.map((t) => t.id)).toEqual(["tab-2", "tab-3"]);
      expect(result.newActiveTabId).toBe("tab-3");
    });

    it("should update active tab if it was closed", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-1" }),
      ];

      const result = closeTabsToLeft(tabs, "conn-1", "tab-2", "tab-1");

      expect(result.newActiveTabId).toBe("tab-2");
    });

    it("should keep tabs from other connections", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-2" }),
        createMockTab({ id: "tab-3", connectionId: "conn-1" }),
      ];

      const result = closeTabsToLeft(tabs, "conn-1", "tab-3", "tab-1");

      expect(result.newTabs).toHaveLength(2);
      expect(result.newTabs.map((t) => t.id)).toEqual(["tab-2", "tab-3"]);
    });

    it("should return original tabs when target not found", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
      ];

      const result = closeTabsToLeft(tabs, "conn-1", "non-existent", "tab-1");

      expect(result.newTabs).toEqual(tabs);
      expect(result.newActiveTabId).toBe("tab-1");
    });
  });

  describe("closeTabsToRight", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should close tabs to the right of target", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-1" }),
      ];

      const result = closeTabsToRight(tabs, "conn-1", "tab-2", "tab-1");

      expect(result.newTabs).toHaveLength(2);
      expect(result.newTabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
      expect(result.newActiveTabId).toBe("tab-1");
    });

    it("should update active tab if it was closed", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
        createMockTab({ id: "tab-2", connectionId: "conn-1" }),
        createMockTab({ id: "tab-3", connectionId: "conn-1" }),
      ];

      const result = closeTabsToRight(tabs, "conn-1", "tab-2", "tab-3");

      expect(result.newActiveTabId).toBe("tab-2");
    });

    it("should return original tabs when target not found", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", connectionId: "conn-1" }),
      ];

      const result = closeTabsToRight(tabs, "conn-1", "non-existent", "tab-1");

      expect(result.newTabs).toEqual(tabs);
      expect(result.newActiveTabId).toBe("tab-1");
    });
  });

  describe("updateTabInList", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "console",
      query: "",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: null,
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should update tab properties", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1", title: "Old Title" }),
        createMockTab({ id: "tab-2", title: "Other" }),
      ];

      const result = updateTabInList(tabs, "tab-1", { title: "New Title" });

      expect(result[0].title).toBe("New Title");
      expect(result[1].title).toBe("Other");
    });

    it("should not modify other tabs", () => {
      const tabs: Tab[] = [
        createMockTab({ id: "tab-1" }),
        createMockTab({ id: "tab-2" }),
      ];

      const result = updateTabInList(tabs, "tab-1", { query: "SELECT *" });

      expect(result[1]).toEqual(tabs[1]);
    });

    it("should return new array without mutating original", () => {
      const tabs: Tab[] = [createMockTab({ id: "tab-1" })];

      const result = updateTabInList(tabs, "tab-1", { title: "New" });

      expect(result).not.toBe(tabs);
      expect(tabs[0].title).toBe("Test");
    });
  });

  describe("shouldUseCachedSchema", () => {
    const createMockSchemaCache = (
      overrides: Partial<SchemaCache> = {},
    ): SchemaCache => ({
      data: [],
      version: 1,
      timestamp: Date.now(),
      ...overrides,
    });

    it("should return false when no cache exists", () => {
      const result = shouldUseCachedSchema(undefined);
      expect(result).toBe(false);
    });

    it("should return true for fresh cache without version check", () => {
      const cache = createMockSchemaCache({ timestamp: Date.now() - 1000 });
      const result = shouldUseCachedSchema(cache);
      expect(result).toBe(true);
    });

    it("should return false for stale cache (older than 5 minutes)", () => {
      const cache = createMockSchemaCache({ timestamp: Date.now() - 301000 });
      const result = shouldUseCachedSchema(cache);
      expect(result).toBe(false);
    });

    it("should check version when provided", () => {
      const cache = createMockSchemaCache({
        version: 1,
        timestamp: Date.now(),
      });
      const result = shouldUseCachedSchema(cache, 2);
      expect(result).toBe(false);
    });

    it("should return true when version matches", () => {
      const cache = createMockSchemaCache({
        version: 2,
        timestamp: Date.now(),
      });
      const result = shouldUseCachedSchema(cache, 2);
      expect(result).toBe(true);
    });

    it("should return true for fresh cache with undefined version", () => {
      const cache = createMockSchemaCache({ timestamp: Date.now() });
      const result = shouldUseCachedSchema(cache, undefined);
      expect(result).toBe(true);
    });
  });

  describe("createSchemaCacheEntry", () => {
    it("should create cache entry with current timestamp", () => {
      const data: TableSchema[] = [
        { name: "users", columns: [], foreign_keys: [] },
      ];
      const version = 5;

      const before = Date.now();
      const result = createSchemaCacheEntry(data, version);
      const after = Date.now();

      expect(result.data).toBe(data);
      expect(result.version).toBe(version);
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("reconstructTableQuery", () => {
    const createMockTab = (overrides: Partial<Tab> = {}): Tab => ({
      id: "tab-1",
      title: "Test",
      type: "table",
      query: "SELECT * FROM users",
      result: null,
      error: "",
      executionTime: null,
      page: 1,
      activeTable: "users",
      pkColumns: null,
      connectionId: "conn-1",
      ...overrides,
    });

    it("should reconstruct basic table query", () => {
      const tab = createMockTab();
      const result = reconstructTableQuery(tab);
      expect(result).toBe('SELECT * FROM "users"');
    });

    it("should include WHERE clause when filter is present", () => {
      const tab = createMockTab({ filterClause: "age > 18" });
      const result = reconstructTableQuery(tab);
      expect(result).toBe('SELECT * FROM "users" WHERE age > 18');
    });

    it("should include ORDER BY clause when sort is present", () => {
      const tab = createMockTab({ sortClause: "created_at DESC" });
      const result = reconstructTableQuery(tab);
      expect(result).toBe('SELECT * FROM "users" ORDER BY created_at DESC');
    });

    it("should include LIMIT clause when limit is present", () => {
      const tab = createMockTab({ limitClause: 100 });
      const result = reconstructTableQuery(tab);
      expect(result).toBe('SELECT * FROM "users" LIMIT 100');
    });

    it("should combine filter, sort, and limit", () => {
      const tab = createMockTab({
        filterClause: 'status = "active"',
        sortClause: "name ASC",
        limitClause: 50,
      });
      const result = reconstructTableQuery(tab);
      expect(result).toBe(
        'SELECT * FROM "users" WHERE status = "active" ORDER BY name ASC LIMIT 50',
      );
    });

    it("should ignore zero or negative limit", () => {
      const tab1 = createMockTab({ limitClause: 0 });
      const result1 = reconstructTableQuery(tab1);
      expect(result1).toBe('SELECT * FROM "users"');

      const tab2 = createMockTab({ limitClause: -10 });
      const result2 = reconstructTableQuery(tab2);
      expect(result2).toBe('SELECT * FROM "users"');
    });

    it("should return original query when activeTable is null", () => {
      const tab = createMockTab({
        activeTable: null,
        query: "SELECT * FROM posts",
      });
      const result = reconstructTableQuery(tab);
      expect(result).toBe("SELECT * FROM posts");
    });

    it("should normalize whitespace", () => {
      const tab = createMockTab({
        filterClause: "id    >   10",
        sortClause: "created_at    DESC",
      });
      const result = reconstructTableQuery(tab);
      // Should collapse multiple spaces into single spaces
      expect(result).toContain("WHERE");
      expect(result).toContain("ORDER BY");
      expect(result).not.toMatch(/\s{2,}/);
    });
  });

  describe("formatExportFileName", () => {
    it("should format filename with table name and timestamp", () => {
      const result = formatExportFileName("users", "csv");
      expect(result).toMatch(
        /^users_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/,
      );
    });

    it("should handle different file formats", () => {
      const csvResult = formatExportFileName("orders", "csv");
      const jsonResult = formatExportFileName("orders", "json");

      expect(csvResult).toMatch(/\.csv$/);
      expect(jsonResult).toMatch(/\.json$/);
    });

    it("should sanitize table names with special characters", () => {
      const result = formatExportFileName("user-accounts!@#$", "csv");
      expect(result).toMatch(/^user-accounts____/);
      expect(result).not.toContain("!");
      expect(result).not.toContain("@");
      expect(result).not.toContain("#");
      expect(result).not.toContain("$");
    });

    it("should replace spaces with underscores", () => {
      const result = formatExportFileName("user accounts", "csv");
      expect(result).toMatch(/^user_accounts/);
    });

    it("should handle table names with dots", () => {
      const result = formatExportFileName("schema.users", "csv");
      expect(result).toMatch(/^schema_users/);
    });

    it("should preserve alphanumeric and hyphens/underscores", () => {
      const result = formatExportFileName("user_accounts-2024", "json");
      expect(result).toContain("user_accounts-2024");
    });
  });

  describe("validatePageNumber", () => {
    it("should validate correct page numbers", () => {
      expect(validatePageNumber("1", 10)).toBe(true);
      expect(validatePageNumber("5", 10)).toBe(true);
      expect(validatePageNumber("10", 10)).toBe(true);
    });

    it("should reject page numbers less than 1", () => {
      expect(validatePageNumber("0", 10)).toBe(false);
      expect(validatePageNumber("-1", 10)).toBe(false);
      expect(validatePageNumber("-100", 10)).toBe(false);
    });

    it("should reject page numbers greater than totalPages", () => {
      expect(validatePageNumber("11", 10)).toBe(false);
      expect(validatePageNumber("100", 10)).toBe(false);
    });

    it("should reject non-numeric input", () => {
      expect(validatePageNumber("abc", 10)).toBe(false);
      expect(validatePageNumber("", 10)).toBe(false);
      // parseInt('1.5') returns 1, so this would pass validation
      // We only validate integer inputs, decimals are truncated
      expect(validatePageNumber("1.5", 10)).toBe(true); // parseInt truncates to 1
    });

    it("should reject NaN input", () => {
      expect(validatePageNumber("NaN", 10)).toBe(false);
      expect(validatePageNumber("Infinity", 10)).toBe(false);
    });

    it("should handle single page", () => {
      expect(validatePageNumber("1", 1)).toBe(true);
      expect(validatePageNumber("2", 1)).toBe(false);
    });

    it("should handle whitespace in input", () => {
      // parseInt handles leading whitespace
      expect(validatePageNumber(" 5 ", 10)).toBe(true);
    });
  });

  describe("calculateTotalPages", () => {
    it("should calculate correct number of pages", () => {
      expect(calculateTotalPages(100, 10)).toBe(10);
      expect(calculateTotalPages(105, 10)).toBe(11);
      expect(calculateTotalPages(99, 10)).toBe(10);
    });

    it("should return 1 for zero rows", () => {
      expect(calculateTotalPages(0, 10)).toBe(1);
    });

    it("should return 1 for null rows", () => {
      expect(calculateTotalPages(null, 10)).toBe(1);
    });

    it("should handle single row", () => {
      expect(calculateTotalPages(1, 10)).toBe(1);
      expect(calculateTotalPages(1, 100)).toBe(1);
    });

    it("should handle exact multiples", () => {
      expect(calculateTotalPages(50, 10)).toBe(5);
      expect(calculateTotalPages(1000, 100)).toBe(10);
    });

    it("should round up for partial pages", () => {
      expect(calculateTotalPages(51, 10)).toBe(6);
      expect(calculateTotalPages(1001, 100)).toBe(11);
      expect(calculateTotalPages(99, 100)).toBe(1);
    });

    it("should handle large datasets", () => {
      expect(calculateTotalPages(1000000, 500)).toBe(2000);
      expect(calculateTotalPages(999999, 1000)).toBe(1000);
    });

    it("should handle small page sizes", () => {
      expect(calculateTotalPages(100, 1)).toBe(100);
      expect(calculateTotalPages(10, 3)).toBe(4);
    });
  });
});
