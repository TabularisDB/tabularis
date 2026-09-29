import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateSQLModal } from "../../../src/components/modals/GenerateSQLModal";
import type { TableQueryTemplateRequest } from "../../../src/utils/tableQueryTemplates";

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  showAlert: vi.fn(),
  connections: {
    legacy: { driver: "postgres" },
    opted: { capabilities: { table_query_templates: true, identifier_quote: '"', sql_dialect: "mssql" } },
    other: { capabilities: { table_query_templates: true, identifier_quote: '"', sql_dialect: "mssql" } },
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("lucide-react", () => {
  const Icon = () => null;
  return { X: Icon, Loader2: Icon, Copy: Icon, Check: Icon, FileCode: Icon, List: Icon, Table2: Icon, PenLine: Icon, Trash2: Icon, Play: Icon };
});
vi.mock("../../../src/hooks/useDatabase", () => ({ useDatabase: () => ({ connectionDataMap: mocks.connections }) }));
vi.mock("../../../src/hooks/useAlert", () => ({ useAlert: () => ({ showAlert: mocks.showAlert }) }));
vi.mock("../../../src/components/ui/SqlPreview", () => ({ SqlPreview: ({ sql }: { sql: string }) => <pre data-testid="preview">{sql}</pre> }));

const invokeMock = vi.mocked(invoke);
const columns = [{ name: "order id", data_type: "INT", is_pk: true, is_nullable: false, is_auto_increment: false, default_value: null }];

function modal(connectionId = "opted", openEditor = vi.fn()) {
  return <MemoryRouter><GenerateSQLModal isOpen target={{ connectionId, tableName: "orders", schema: "sales" }} onClose={vi.fn()} openEditor={openEditor} /></MemoryRouter>;
}

function selectFields() {
  fireEvent.click(screen.getByRole("button", { name: "generateSQL.tabSelectFields" }));
}

describe("optional driver-owned SQL templates", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mocks.showAlert.mockReset();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_columns") return columns;
      if (command === "get_table_query_template") {
        const { request } = args as { request: TableQueryTemplateRequest };
        if (request.kind === "select") return `SELECT${request.limit ? ` TOP (${request.limit})` : ""} [order id] FROM [sales].[orders];`;
        return `${request.kind.toUpperCase()} driver template`;
      }
      return [];
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("preserves legacy SQL and makes no optional calls without the capability", async () => {
    render(modal("legacy"));
    await screen.findByTestId("preview");
    selectFields();
    expect(screen.getByTestId("preview")).toHaveTextContent("LIMIT 100;");
    expect(invokeMock.mock.calls.some(([command]) => command === "get_table_query_template")).toBe(false);
  });

  it("uses driver SQL with the target connection/schema and only opens an editor", async () => {
    const openEditor = vi.fn();
    render(modal("opted", openEditor));
    await screen.findByTestId("preview");
    selectFields();
    expect(screen.getByTestId("preview")).toHaveTextContent("SELECT TOP (100) [order id] FROM [sales].[orders];");
    expect(invokeMock).toHaveBeenCalledWith("get_table_query_template", {
      connectionId: "opted",
      request: { table: "orders", schema: "sales", kind: "select", columns: ["order id"], limit: 100 },
    });
    expect(invokeMock).toHaveBeenCalledWith("get_table_query_template", {
      connectionId: "opted",
      request: { table: "orders", schema: "sales", kind: "select", columns: [], limit: null },
    });
    fireEvent.click(screen.getByRole("button", { name: "generateSQL.runInConsole" }));
    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ initialQuery: "SELECT TOP (100) [order id] FROM [sales].[orders];", targetConnectionId: "opted", preventAutoRun: true }));
    expect(invokeMock.mock.calls.some(([command]) => command === "execute_query")).toBe(false);
  });

  it("falls back for a null command response (remote method not found)", async () => {
    invokeMock.mockImplementation(async (command) => command === "get_columns" ? columns : command === "get_table_query_template" ? null : []);
    render(modal());
    await screen.findByTestId("preview");
    selectFields();
    expect(screen.getByTestId("preview")).toHaveTextContent("LIMIT 100;");
    expect(mocks.showAlert).not.toHaveBeenCalled();
  });

  it("surfaces real errors instead of offering the legacy template", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_table_query_template") throw new Error("driver failure");
      return command === "get_columns" ? columns : [];
    });
    render(modal());
    expect(await screen.findByRole("alert")).toHaveTextContent("driver failure");
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "generateSQL.runInConsole" })).not.toBeInTheDocument();
  });

  it("ignores a late response for a previous target", async () => {
    let resolveOld!: (sql: string) => void;
    const pending = new Promise<string>((resolve) => { resolveOld = resolve; });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_columns") return columns;
      if (command === "get_table_query_template") {
        const { connectionId } = args as { connectionId: string };
        return connectionId === "opted" ? pending : "SELECT TOP (100) new_target";
      }
      return [];
    });
    const { rerender } = render(modal());
    selectFields();
    await waitFor(() => expect(invokeMock.mock.calls.filter(([command]) => command === "get_table_query_template")).toHaveLength(4));
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    rerender(modal("other"));
    expect(await screen.findByTestId("preview")).toHaveTextContent("new_target");
    await act(async () => { resolveOld("SELECT stale_target"); });
    expect(screen.getByTestId("preview")).toHaveTextContent("new_target");
  });
});
