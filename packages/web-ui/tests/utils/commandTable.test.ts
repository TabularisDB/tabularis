import { describe, expect, it } from "vitest";

import { resolveCommandTable } from "../../src/utils/commandTable";

const tableTab = {
  id: "table-tab",
  type: "table" as const,
  connectionId: "connection-1",
  activeTable: "users",
  schema: "public",
};

describe("resolveCommandTable", () => {
  it("should expose the table target while viewing a table tab", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: "connection-1",
        activeSchema: "public",
        activeTab: tableTab,
      }),
    ).toEqual({
      connectionId: "connection-1",
      tableName: "users",
      schema: "public",
    });
  });

  it("should not leak the last editor table onto settings", () => {
    expect(
      resolveCommandTable({
        pathname: "/settings",
        activeConnectionId: "connection-1",
        activeSchema: "public",
        activeTab: tableTab,
      }),
    ).toBeNull();
  });

  it("should offer no table target without an active connection", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: null,
        activeSchema: "public",
        activeTab: tableTab,
      }),
    ).toBeNull();
  });

  it("should offer no table target from a console tab", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: "connection-1",
        activeSchema: "public",
        activeTab: { ...tableTab, type: "console" },
      }),
    ).toBeNull();
  });

  it("should offer no table target while a table tab has no table", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: "connection-1",
        activeSchema: "public",
        activeTab: { ...tableTab, activeTable: null },
      }),
    ).toBeNull();
  });

  it("should offer no table target without a tab", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: "connection-1",
        activeSchema: "public",
        activeTab: null,
      }),
    ).toBeNull();
  });

  it("should fall back to the active schema when the tab carries none", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: "connection-1",
        activeSchema: "analytics",
        activeTab: { ...tableTab, schema: undefined },
      }),
    ).toEqual({
      connectionId: "connection-1",
      tableName: "users",
      schema: "analytics",
    });
  });

  it("should leave the schema undefined when neither source has one", () => {
    expect(
      resolveCommandTable({
        pathname: "/editor",
        activeConnectionId: "connection-1",
        activeSchema: null,
        activeTab: { ...tableTab, schema: undefined },
      }),
    ).toEqual({
      connectionId: "connection-1",
      tableName: "users",
      schema: undefined,
    });
  });
});
